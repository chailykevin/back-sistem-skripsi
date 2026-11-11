const db = require("../db");
const { insertNotification } = require("../utils/notify");
const dosenBimbingProdiService = require("../services/dosenBimbingProdi.service");
const path = require("path");
const {
  getStudentNpm,
  getStaffUsrId,
  getKaprodiProgramStudiIds,
  getKaprodiUserIds,
} = require("../utils/identity");
const { getCurrentOutlineId } = require("../services/outline.service");
const { assertSignatures } = require("../utils/signature");
const { BULAN_ROMAWI } = require("../utils/dates");
const { mimeFromFileName } = require("../utils/mime");
const { UPLOAD_RULES, validateUpload } = require("../utils/upload");

// Next sequence is MAX of the existing numbers for this prodi/month/year rather than a
// COUNT by submitted_at: resubmit resets submitted_at, and toggling perlu_surat_pengantar
// off clears a number, both of which made COUNT-based sequences collide.
// Must run inside the caller's transaction: the prodi row lock (held until commit) serializes
// concurrent submissions, and the MAX is a locking read so it sees numbers committed while we
// waited — the same pattern as skNumber.service.js.
async function generateNomorSkSuratPengantar(conn, programStudiId) {
  const now = new Date();
  const year = now.getFullYear();
  const month = now.getMonth() + 1;
  const [[programStudi]] = await conn.query(
    `SELECT ps.kode AS ps_kode, f.kode AS f_kode
     FROM program_studi ps
     JOIN fakultas f ON f.id = ps.fakultas_id
     WHERE ps.id = ?
     LIMIT 1
     FOR UPDATE OF ps`,
    [programStudiId],
  );
  if (!programStudi?.ps_kode || !programStudi?.f_kode) {
    throw Object.assign(
      new Error("Kode program studi atau fakultas belum dikonfigurasi"),
      { statusCode: 400 },
    );
  }

  const suffix = `/${programStudi.f_kode}/${programStudi.ps_kode}/SIM/${BULAN_ROMAWI[month - 1]}/${year}`;
  const [[{ maxSeq }]] = await conn.query(
    `SELECT COALESCE(MAX(CAST(SUBSTRING_INDEX(nomor_sk_surat_pengantar, '/', 1) AS UNSIGNED)), 0) AS maxSeq
     FROM pengajuan_disposisi_pembimbing
     WHERE program_studi_id = ?
       AND nomor_sk_surat_pengantar LIKE ?
     FOR SHARE`,
    [programStudiId, `%${suffix}`],
  );
  return `${String(Number(maxSeq) + 1).padStart(3, "0")}${suffix}`;
}

const toBit = (v, fallback = 0) => (v === undefined ? fallback : v ? 1 : 0);


async function upsertFileByType(
  conn,
  pengajuanDisposisiPembimbingId,
  fileType,
  fileContent,
  fileName,
) {
  await conn.query(
    `DELETE FROM pengajuan_disposisi_pembimbing_file
     WHERE pengajuan_disposisi_pembimbing_id = ? AND file_type = ?`,
    [pengajuanDisposisiPembimbingId, fileType],
  );

  await conn.query(
    `INSERT INTO pengajuan_disposisi_pembimbing_file (
       pengajuan_disposisi_pembimbing_id, file_type, file_content, file_name
     ) VALUES (?, ?, ?, ?)`,
    [pengajuanDisposisiPembimbingId, fileType, fileContent, fileName],
  );
}

// Adds has_file_* flags and file names, never the content: pages download a file on click through
// GET /:id/files/:fileType, so a read doesn't ship every file as base64.
async function hydratePengajuanDisposisiPembimbingReadData(baseRow) {
  if (!baseRow?.id) return baseRow;

  const [fileRows] = await db.query(
    `SELECT file_type, file_name
     FROM pengajuan_disposisi_pembimbing_file
     WHERE pengajuan_disposisi_pembimbing_id = ? AND file_content IS NOT NULL`,
    [baseRow.id],
  );
  const byType = new Map(fileRows.map((row) => [row.file_type, row.file_name]));

  return {
    ...baseRow,
    has_file_pengajuan_disposisi_pembimbing: byType.has("PENGAJUAN_DISPOSISI_PEMBIMBING"),
    file_pengajuan_disposisi_pembimbing_name: byType.get("PENGAJUAN_DISPOSISI_PEMBIMBING") ?? null,
    has_file_transkrip: byType.has("TRANSKRIP"),
    file_transkrip_name: byType.get("TRANSKRIP") ?? null,
  };
}

// Create Formulir Pengajuan Disposisi Pembimbing Skripsi
exports.createPengajuanDisposisiPembimbing = async (req, res, next) => {
  let conn;
  let txStarted = false;
  try {
    if (!req.user.hasRole("STUDENT")) {
      return res.status(403).json({ ok: false, message: "Hanya mahasiswa yang dapat mengakses fitur ini" });
    }

    const npm = await getStudentNpm(req.user.id);
    if (!npm) {
      return res
        .status(400)
        .json({ ok: false, message: "Mahasiswa tidak valid" });
    }

    const outlineId = Number(req.body.outlineId);
    if (!Number.isFinite(outlineId) || outlineId <= 0) {
      return res.status(400).json({ ok: false, message: "ID outline tidak valid" });
    }

    // Pastikan outline milik mahasiswa dan sudah ACCEPTED (sesuai workflow kamu)
    const [orows] = await db.query(
      `SELECT id
       FROM outline
       WHERE id = ? AND npm = ? AND status = 'ACCEPTED'
       LIMIT 1`,
      [outlineId, npm],
    );
    if (orows.length === 0) {
      return res.status(400).json({
        ok: false,
        message: "Outline tidak ditemukan atau belum diterima Kaprodi",
      });
    }

    const programStudiId = req.user?.programStudiId ?? null;
    if (!programStudiId) {
      return res
        .status(400)
        .json({ ok: false, message: "Program studi tidak valid" });
    }

    // Cegah duplikasi pengajuan untuk outline yang sama
    const [existing] = await db.query(
      `SELECT id, status
       FROM pengajuan_disposisi_pembimbing
       WHERE outline_id = ? AND npm = ?
       LIMIT 1`,
      [outlineId, npm],
    );
    if (existing.length > 0) {
      return res.status(409).json({
        ok: false,
        message: "Pengajuan disposisi pembimbing untuk outline ini sudah ada",
        data: existing[0],
      });
    }

    const {
      noHp,
      pembimbing1DiajukanNidn,
      pembimbing2DiajukanNidn,
      perluSuratPengantar,
      namaPerusahaan,
      alamatPerusahaan,
      syaratTranskrip,
      fileTranskrip,
      fileTranskripName,
    } = req.body || {};

    // Required: SK Penelitian later pulls it as TRANSKRIP_NILAI and refuses to submit without it.
    if (fileTranskrip == null || String(fileTranskrip).trim().length === 0) {
      return res.status(400).json({
        ok: false,
        message: "File transkrip nilai wajib diunggah",
      });
    }
    const transkripError = validateUpload(
      fileTranskrip,
      fileTranskripName,
      UPLOAD_RULES.SCAN,
      "File transkrip nilai",
    );
    if (transkripError) {
      return res.status(400).json({ ok: false, message: transkripError });
    }

    const noHpVal = noHp != null ? String(noHp).trim() : "";
    if (!noHpVal || !/^08[0-9]{7,13}$/.test(noHpVal)) {
      return res.status(400).json({
        ok: false,
        message: "No. HP tidak valid (harus diawali 08, 9-15 digit angka)",
      });
    }

    const pembimbing1Val =
      pembimbing1DiajukanNidn != null
        ? String(pembimbing1DiajukanNidn).trim()
        : "";
    const pembimbing2Val =
      pembimbing2DiajukanNidn != null
        ? String(pembimbing2DiajukanNidn).trim()
        : "";

    if (!pembimbing1Val || !pembimbing2Val) {
      return res.status(400).json({
        ok: false,
        message: "Dosen pembimbing 1 dan 2 wajib diisi",
      });
    }

    if (pembimbing1Val === pembimbing2Val) {
      return res.status(400).json({
        ok: false,
        message: "Pembimbing 1 dan Pembimbing 2 tidak boleh dosen yang sama",
      });
    }

    const [dosenRows] = await db.query(
      `SELECT nidn FROM dosen WHERE nidn IN (?, ?)`,
      [pembimbing1Val, pembimbing2Val],
    );
    const foundNidns = new Set(dosenRows.map((row) => row.nidn));
    if (!foundNidns.has(pembimbing1Val) || !foundNidns.has(pembimbing2Val)) {
      return res.status(400).json({
        ok: false,
        message: "Dosen pembimbing yang dipilih tidak valid",
      });
    }

    if (
      !(await dosenBimbingProdiService.areEligible(programStudiId, [
        pembimbing1Val,
        pembimbing2Val,
      ]))
    ) {
      return res.status(400).json({
        ok: false,
        message:
          "Dosen pembimbing yang dipilih tidak tersedia untuk program studi Anda",
      });
    }

    const namaPerusahaanVal =
      namaPerusahaan != null ? String(namaPerusahaan).trim() : "";
    if (perluSuratPengantar && !namaPerusahaanVal) {
      return res.status(400).json({
        ok: false,
        message: "Nama perusahaan wajib diisi jika memerlukan surat pengantar",
      });
    }

    if (perluSuratPengantar && namaPerusahaanVal.length < 2) {
      return res.status(400).json({
        ok: false,
        message: "Nama perusahaan minimal 2 karakter",
      });
    }

    const alamatPerusahaanVal =
      alamatPerusahaan != null ? String(alamatPerusahaan).trim() : "";
    if (perluSuratPengantar && !alamatPerusahaanVal) {
      return res.status(400).json({
        ok: false,
        message: "Alamat perusahaan wajib diisi jika memerlukan surat pengantar",
      });
    }

    if (perluSuratPengantar && alamatPerusahaanVal.length < 2) {
      return res.status(400).json({
        ok: false,
        message: "Alamat perusahaan minimal 2 karakter",
      });
    }

    conn = await db.getConnection();
    await conn.beginTransaction();
    txStarted = true;

    const nomorSkSuratPengantar = perluSuratPengantar
      ? await generateNomorSkSuratPengantar(conn, programStudiId)
      : null;

    const [result] = await conn.query(
      `INSERT INTO pengajuan_disposisi_pembimbing (
         outline_id, npm, program_studi_id,
         no_hp,
         pembimbing1_diajukan_nidn, pembimbing2_diajukan_nidn,
         perlu_surat_pengantar, nomor_sk_surat_pengantar, nama_perusahaan, alamat_perusahaan,
         syarat_transkrip,
         status, submitted_at
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'SUBMITTED', CURRENT_TIMESTAMP)`,
      [
        outlineId,
        npm,
        programStudiId,
        noHpVal,
        pembimbing1Val,
        pembimbing2Val,
        perluSuratPengantar ? 1 : 0,
        nomorSkSuratPengantar,
        namaPerusahaanVal || null,
        alamatPerusahaanVal || null,
        toBit(syaratTranskrip, 0),
      ],
    );

    const pengajuanDisposisiPembimbingId = result.insertId;

    const [docDataRows] = await conn.query(
      `SELECT
         m.nama AS nama_mahasiswa, m.sks,
         ps.nama AS program_studi_nama,
         o.judul AS judul_skripsi,
         d1.nama AS pembimbing1_nama,
         d2.nama AS pembimbing2_nama,
         u.signature_image
       FROM pengajuan_disposisi_pembimbing pj
       JOIN mahasiswa m ON m.npm = pj.npm
       JOIN program_studi ps ON ps.id = pj.program_studi_id
       JOIN outline o ON o.id = pj.outline_id
       LEFT JOIN dosen d1 ON d1.nidn = pj.pembimbing1_diajukan_nidn
       LEFT JOIN dosen d2 ON d2.nidn = pj.pembimbing2_diajukan_nidn
       LEFT JOIN users u ON u.npm = pj.npm AND u.is_active = 1
       WHERE pj.id = ?
       LIMIT 1`,
      [pengajuanDisposisiPembimbingId],
    );
    const docData = docDataRows[0] ?? {};

    assertSignatures([
      {
        role: "Mahasiswa",
        nama: docData.nama_mahasiswa,
        signatureImage: docData.signature_image,
      },
    ]);

    await upsertFileByType(
      conn,
      pengajuanDisposisiPembimbingId,
      "TRANSKRIP",
      String(fileTranskrip),
      fileTranskripName !== undefined && fileTranskripName !== null
        ? String(fileTranskripName).trim()
        : null,
    );

    const [mahasiswaRows] = await conn.query(
      `SELECT m.nama FROM mahasiswa m WHERE m.npm = ? LIMIT 1`,
      [npm],
    );
    const namaMahasiswa = mahasiswaRows[0]?.nama ?? npm;

    for (const kaprodiUserId of await getKaprodiUserIds(conn, programStudiId)) {
      await insertNotification(
        conn,
        kaprodiUserId,
        "TITLE_SUBMITTED",
        `Mahasiswa ${namaMahasiswa} mengajukan judul skripsi`,
        "/kaprodi/pengajuan-outline/pengajuan-disposisi-pembimbing",
      );
    }

    await conn.commit();
    txStarted = false;

    return res.status(201).json({
      ok: true,
      message: "Pengajuan disposisi pembimbing berhasil diajukan",
      data: { id: pengajuanDisposisiPembimbingId },
    });
  } catch (err) {
    try {
      if (conn && txStarted) {
        await conn.rollback();
      }
    } catch (_) {}
    // A double submit races past the existence check; uq_pengajuan_outline_npm stops the second.
    if (err?.code === "ER_DUP_ENTRY") {
      return res.status(409).json({
        ok: false,
        message: "Pengajuan disposisi pembimbing untuk outline ini sudah ada",
      });
    }
    next(err);
  } finally {
    if (conn) {
      conn.release();
    }
  }
};

exports.listMine = async (req, res, next) => {
  try {
    if (!req.user.hasRole("STUDENT")) {
      return res.status(403).json({ ok: false, message: "Hanya mahasiswa yang dapat mengakses fitur ini" });
    }

    const npm = await getStudentNpm(req.user.id);
    if (!npm) {
      return res
        .status(400)
        .json({ ok: false, message: "Mahasiswa tidak valid" });
    }

    // Join outline untuk ambil judul (karena judul ada di outline)
    const [rows] = await db.query(
      `SELECT
         pj.id,
         pj.outline_id,
         pj.status,
         pj.submitted_at,
         pj.created_at,
         pj.updated_at,
         o.judul AS outline_judul
       FROM pengajuan_disposisi_pembimbing pj
       INNER JOIN outline o ON o.id = pj.outline_id
       WHERE pj.npm = ?
       ORDER BY pj.created_at DESC`,
      [npm],
    );

    return res.json({ ok: true, data: rows });
  } catch (err) {
    next(err);
  }
};

exports.getLatestMine = async (req, res, next) => {
  try {
    if (!req.user.hasRole("STUDENT")) {
      return res.status(403).json({
        ok: false,
        message: "Hanya mahasiswa yang dapat melihat pengajuan disposisi pembimbing terbarunya",
      });
    }

    const npm = await getStudentNpm(req.user.id);
    if (!npm) {
      return res
        .status(400)
        .json({ ok: false, message: "Mahasiswa tidak valid" });
    }

    const currentOutlineId = await getCurrentOutlineId(npm);
    const [rows] = await db.query(
      `SELECT
         pj.*,
         o.judul AS outline_judul,
         m.nama AS mahasiswa_nama,
         m.sks AS sks_diperoleh,
         ps.id AS program_studi_id,
         ps.nama AS program_studi_nama,
         d1.nama AS pembimbing1_diajukan_nama,
         d2.nama AS pembimbing2_diajukan_nama,
         d3.nama AS pembimbing1_ditetapkan_nama,
         d4.nama AS pembimbing2_ditetapkan_nama
       FROM pengajuan_disposisi_pembimbing pj
       INNER JOIN outline o ON o.id = pj.outline_id
       INNER JOIN mahasiswa m ON m.npm = pj.npm
       INNER JOIN program_studi ps ON ps.id = m.program_studi_id
       LEFT JOIN dosen d1 ON d1.nidn = pj.pembimbing1_diajukan_nidn
       LEFT JOIN dosen d2 ON d2.nidn = pj.pembimbing2_diajukan_nidn
       LEFT JOIN dosen d3 ON d3.nidn = pj.pembimbing1_ditetapkan_nidn
       LEFT JOIN dosen d4 ON d4.nidn = pj.pembimbing2_ditetapkan_nidn
       WHERE pj.npm = ? AND pj.outline_id = ?
       ORDER BY pj.updated_at DESC, pj.id DESC
       LIMIT 1`,
      [npm, currentOutlineId],
    );

    if (!rows || rows.length === 0) {
      return res.json({
        ok: true,
        data: null,
        message: "Pengajuan disposisi pembimbing tidak ditemukan",
      });
    }

    const hydrated = await hydratePengajuanDisposisiPembimbingReadData(rows[0]);
    return res.json({ ok: true, data: hydrated });
  } catch (err) {
    next(err);
  }
};

exports.getById = async (req, res, next) => {
  try {
    const id = Number(req.params.id);
    if (!Number.isFinite(id) || id <= 0) {
      return res.status(400).json({ ok: false, message: "ID pengajuan tidak valid" });
    }

    // STUDENT: hanya boleh lihat miliknya
    if (req.user.hasRole("STUDENT")) {
      const [urows] = await db.query(
        `SELECT npm FROM users WHERE id = ? AND is_active = 1 LIMIT 1`,
        [req.user.id],
      );
      const npm = urows[0]?.npm;
      if (!npm) {
        return res
          .status(400)
          .json({ ok: false, message: "Mahasiswa tidak valid" });
      }

      const [rows] = await db.query(
        `
        SELECT
          pj.id,
          pj.outline_id,
          pj.npm,
          pj.no_hp,
          pj.pembimbing1_diajukan_nidn,
          pj.pembimbing2_diajukan_nidn,
          pj.perlu_surat_pengantar,
          pj.nama_perusahaan,
          pj.alamat_perusahaan,
          pj.status,
          pj.submitted_at,
          pj.pembimbing1_ditetapkan_nidn,
          pj.pembimbing2_ditetapkan_nidn,
          pj.catatan_kaprodi,
          pj.disposisi_at,
          pj.decided_by_user_id,
          pj.created_at,
          pj.updated_at,

          o.judul AS outline_judul,

          m.nama AS mahasiswa_nama,
          m.sks AS sks_diperoleh,
          ps.id AS program_studi_id,
          ps.nama AS program_studi_nama,
          dkap.nama AS kaprodi_nama,

          d1.nama AS pembimbing1_diajukan_nama,
          d2.nama AS pembimbing2_diajukan_nama,
          d3.nama AS pembimbing1_ditetapkan_nama,
          d4.nama AS pembimbing2_ditetapkan_nama

        FROM pengajuan_disposisi_pembimbing pj
        INNER JOIN outline o ON o.id = pj.outline_id
        INNER JOIN mahasiswa m ON m.npm = pj.npm
        INNER JOIN program_studi ps ON ps.id = m.program_studi_id
        LEFT JOIN staf dkap ON dkap.usr_id = ps.kaprodi_staff_usr_id

        LEFT JOIN dosen d1 ON d1.nidn = pj.pembimbing1_diajukan_nidn
        LEFT JOIN dosen d2 ON d2.nidn = pj.pembimbing2_diajukan_nidn
        LEFT JOIN dosen d3 ON d3.nidn = pj.pembimbing1_ditetapkan_nidn
        LEFT JOIN dosen d4 ON d4.nidn = pj.pembimbing2_ditetapkan_nidn

        WHERE pj.id = ? AND pj.npm = ?
        LIMIT 1
        `,
        [id, npm],
      );

      if (rows.length === 0) {
        return res.status(404).json({ ok: false, message: "Pengajuan disposisi pembimbing tidak ditemukan" });
      }

      const hydrated = await hydratePengajuanDisposisiPembimbingReadData(
        rows[0],
      );
      return res.json({ ok: true, data: hydrated });
    }

    // Kaprodi: hanya boleh pengajuan dari prodinya
    if (req.user.hasRole("KAPRODI")) {
      const programStudiIds = await getKaprodiProgramStudiIds(
        await getStaffUsrId(req.user.id),
      );
      if (programStudiIds.length === 0) {
        return res
          .status(403)
          .json({ ok: false, message: "Anda tidak terdaftar sebagai Kaprodi" });
      }

      const [rows] = await db.query(
        `
        SELECT
          pj.id,
          pj.outline_id,
          pj.npm,
          pj.no_hp,
          pj.pembimbing1_diajukan_nidn,
          pj.pembimbing2_diajukan_nidn,
          pj.perlu_surat_pengantar,
          pj.nama_perusahaan,
          pj.alamat_perusahaan,
          pj.syarat_transkrip,
          pj.status,
          pj.submitted_at,
          pj.pembimbing1_ditetapkan_nidn,
          pj.pembimbing2_ditetapkan_nidn,
          pj.catatan_kaprodi,
          pj.disposisi_at,
          pj.decided_by_user_id,
          pj.created_at,
          pj.updated_at,

          o.judul AS outline_judul,

          m.nama AS mahasiswa_nama,
          m.sks AS sks_diperoleh,
          ps.id AS program_studi_id,
          ps.nama AS program_studi_nama,
          dkap.nama AS kaprodi_nama,

          d1.nama AS pembimbing1_diajukan_nama,
          d2.nama AS pembimbing2_diajukan_nama,
          d3.nama AS pembimbing1_ditetapkan_nama,
          d4.nama AS pembimbing2_ditetapkan_nama

        FROM pengajuan_disposisi_pembimbing pj
        INNER JOIN outline o ON o.id = pj.outline_id
        INNER JOIN mahasiswa m ON m.npm = pj.npm
        INNER JOIN program_studi ps ON ps.id = m.program_studi_id
        LEFT JOIN staf dkap ON dkap.usr_id = ps.kaprodi_staff_usr_id

        LEFT JOIN dosen d1 ON d1.nidn = pj.pembimbing1_diajukan_nidn
        LEFT JOIN dosen d2 ON d2.nidn = pj.pembimbing2_diajukan_nidn
        LEFT JOIN dosen d3 ON d3.nidn = pj.pembimbing1_ditetapkan_nidn
        LEFT JOIN dosen d4 ON d4.nidn = pj.pembimbing2_ditetapkan_nidn

        WHERE pj.id = ?
          AND ps.id IN (?)
        LIMIT 1
        `,
        [id, programStudiIds],
      );

      if (rows.length === 0) {
        return res.status(404).json({ ok: false, message: "Pengajuan disposisi pembimbing tidak ditemukan" });
      }

      const hydrated = await hydratePengajuanDisposisiPembimbingReadData(
        rows[0],
      );
      return res.json({ ok: true, data: hydrated });
    }

    return res.status(403).json({ ok: false, message: "Anda tidak memiliki akses" });
  } catch (err) {
    next(err);
  }
};

const DOWNLOADABLE_FILE_TYPES = new Set(["PENGAJUAN_DISPOSISI_PEMBIMBING", "TRANSKRIP"]);

// GET /:id/files/:fileType — one file instead of getById's every file, for download buttons.
// Same visibility as getById: the student who owns it, or the Kaprodi of its prodi.
exports.getFile = async (req, res, next) => {
  try {
    const id = Number(req.params.id);
    if (!Number.isFinite(id) || id <= 0) {
      return res.status(400).json({ ok: false, message: "ID pengajuan tidak valid" });
    }
    const fileType = String(req.params.fileType ?? "").toUpperCase();
    if (!DOWNLOADABLE_FILE_TYPES.has(fileType)) {
      return res.status(400).json({ ok: false, message: "Jenis file tidak valid" });
    }

    let scopeSql;
    let scopeParam;
    if (req.user.hasRole("STUDENT")) {
      scopeParam = await getStudentNpm(req.user.id);
      if (!scopeParam) {
        return res.status(400).json({ ok: false, message: "Mahasiswa tidak valid" });
      }
      scopeSql = "pj.npm = ?";
    } else if (req.user.hasRole("KAPRODI")) {
      scopeParam = await getKaprodiProgramStudiIds(await getStaffUsrId(req.user.id));
      if (scopeParam.length === 0) {
        return res.status(403).json({ ok: false, message: "Anda tidak terdaftar sebagai Kaprodi" });
      }
      scopeSql = "ps.id IN (?)";
    } else {
      return res.status(403).json({ ok: false, message: "Anda tidak memiliki akses" });
    }

    const [rows] = await db.query(
      `SELECT f.file_content, f.file_name
       FROM pengajuan_disposisi_pembimbing pj
       INNER JOIN mahasiswa m ON m.npm = pj.npm
       INNER JOIN program_studi ps ON ps.id = m.program_studi_id
       INNER JOIN pengajuan_disposisi_pembimbing_file f
         ON f.pengajuan_disposisi_pembimbing_id = pj.id AND f.file_type = ?
       WHERE pj.id = ? AND ${scopeSql}
       LIMIT 1`,
      [fileType, id, scopeParam],
    );
    const file = rows[0];
    if (!file?.file_content) {
      return res.status(404).json({ ok: false, message: "File tidak ditemukan" });
    }

    return res.json({
      ok: true,
      data: {
        file_name: file.file_name,
        mime_type: mimeFromFileName(file.file_name),
        file_content: file.file_content,
      },
    });
  } catch (err) {
    next(err);
  }
};

exports.resubmit = async (req, res, next) => {
  let conn;
  let txStarted = false;
  try {
    if (!req.user || !req.user.hasRole("STUDENT")) {
      return res.status(403).json({
        ok: false,
        message: "Hanya mahasiswa yang dapat mengajukan ulang disposisi pembimbing",
      });
    }

    const id = Number(req.params.id);
    if (!Number.isFinite(id) || id <= 0) {
      return res.status(400).json({
        ok: false,
        message: "ID pengajuan tidak valid",
      });
    }

    const {
      noHp,
      pembimbing1DiajukanNidn,
      pembimbing2DiajukanNidn,
      perluSuratPengantar,
      namaPerusahaan,
      alamatPerusahaan,
      syaratTranskrip,
      fileTranskrip,
      fileTranskripName,
    } = req.body || {};

    const noHpVal =
      noHp !== undefined && noHp !== null ? String(noHp).trim() : null;
    if (
      noHpVal !== null &&
      noHpVal.length > 0 &&
      !/^08[0-9]{7,13}$/.test(noHpVal)
    ) {
      return res.status(400).json({
        ok: false,
        message: "No. HP tidak valid (harus diawali 08, 9-15 digit angka)",
      });
    }
    const pembimbing1Val =
      pembimbing1DiajukanNidn !== undefined && pembimbing1DiajukanNidn !== null
        ? String(pembimbing1DiajukanNidn).trim()
        : null;
    const pembimbing2Val =
      pembimbing2DiajukanNidn !== undefined && pembimbing2DiajukanNidn !== null
        ? String(pembimbing2DiajukanNidn).trim()
        : null;
    const perluSuratProvided = perluSuratPengantar !== undefined;
    const namaPerusahaanVal =
      namaPerusahaan !== undefined && namaPerusahaan !== null
        ? String(namaPerusahaan).trim()
        : null;
    const alamatPerusahaanVal =
      alamatPerusahaan !== undefined && alamatPerusahaan !== null
        ? String(alamatPerusahaan).trim()
        : null;
    const fileTranskripVal =
      fileTranskrip !== undefined && fileTranskrip !== null
        ? String(fileTranskrip)
        : null;
    const fileTranskripNameVal =
      fileTranskripName !== undefined && fileTranskripName !== null
        ? String(fileTranskripName).trim()
        : null;

    const hasMeaningfulUpdate =
      (noHpVal !== null && noHpVal.length > 0) ||
      (pembimbing1Val !== null && pembimbing1Val.length > 0) ||
      (pembimbing2Val !== null && pembimbing2Val.length > 0) ||
      perluSuratProvided ||
      (namaPerusahaanVal !== null && namaPerusahaanVal.length > 0) ||
      (alamatPerusahaanVal !== null && alamatPerusahaanVal.length > 0) ||
      syaratTranskrip !== undefined ||
      (fileTranskripVal !== null && fileTranskripVal.length > 0);

    if (!hasMeaningfulUpdate) {
      return res.status(400).json({
        ok: false,
        message: "Tidak ada perubahan yang diajukan",
      });
    }

    if (fileTranskripVal !== null && fileTranskripVal.length > 0) {
      const transkripError = validateUpload(
        fileTranskripVal,
        fileTranskripNameVal,
        UPLOAD_RULES.SCAN,
        "File transkrip nilai",
      );
      if (transkripError) {
        return res.status(400).json({ ok: false, message: transkripError });
      }
    }

    if (
      perluSuratProvided &&
      Boolean(perluSuratPengantar) &&
      (!namaPerusahaanVal || namaPerusahaanVal.length === 0)
    ) {
      return res.status(400).json({
        ok: false,
        message: "Nama perusahaan wajib diisi jika memerlukan surat pengantar",
      });
    }

    if (
      perluSuratProvided &&
      Boolean(perluSuratPengantar) &&
      namaPerusahaanVal &&
      namaPerusahaanVal.length < 2
    ) {
      return res.status(400).json({
        ok: false,
        message: "Nama perusahaan minimal 2 karakter",
      });
    }

    if (
      perluSuratProvided &&
      Boolean(perluSuratPengantar) &&
      (!alamatPerusahaanVal || alamatPerusahaanVal.length === 0)
    ) {
      return res.status(400).json({
        ok: false,
        message: "Alamat perusahaan wajib diisi jika memerlukan surat pengantar",
      });
    }

    if (
      perluSuratProvided &&
      Boolean(perluSuratPengantar) &&
      alamatPerusahaanVal &&
      alamatPerusahaanVal.length < 2
    ) {
      return res.status(400).json({
        ok: false,
        message: "Alamat perusahaan minimal 2 karakter",
      });
    }

    const nidnsToCheck = [pembimbing1Val, pembimbing2Val].filter(
      (val) => val && val.length > 0,
    );
    if (nidnsToCheck.length > 0) {
      const [dosenRows] = await db.query(
        `SELECT nidn FROM dosen WHERE nidn IN (${nidnsToCheck.map(() => "?").join(",")})`,
        nidnsToCheck,
      );
      const foundNidns = new Set(dosenRows.map((row) => row.nidn));
      if (nidnsToCheck.some((val) => !foundNidns.has(val))) {
        return res.status(400).json({
          ok: false,
          message: "Dosen pembimbing yang dipilih tidak valid",
        });
      }
    }

    const npm = await getStudentNpm(req.user.id);
    if (!npm) {
      return res
        .status(400)
        .json({ ok: false, message: "Mahasiswa tidak valid" });
    }

    conn = await db.getConnection();
    await conn.beginTransaction();
    txStarted = true;

    const [rows] = await conn.query(
      `SELECT id, status, program_studi_id, pembimbing1_diajukan_nidn, pembimbing2_diajukan_nidn,
              syarat_transkrip, nomor_sk_surat_pengantar
       FROM pengajuan_disposisi_pembimbing
       WHERE id = ? AND npm = ?
       LIMIT 1
       FOR UPDATE`,
      [id, npm],
    );

    if (rows.length === 0) {
      await conn.rollback();
      txStarted = false;
      return res.status(404).json({
        ok: false,
        message: "Pengajuan disposisi pembimbing tidak ditemukan",
      });
    }

    const currentStatus = String(rows[0].status || "").toUpperCase();
    if (currentStatus !== "NEED_REVISION") {
      await conn.rollback();
      txStarted = false;
      return res.status(409).json({
        ok: false,
        message: "Pengajuan hanya dapat diajukan ulang saat berstatus Perlu Revisi",
      });
    }

    const effectivePembimbing1 =
      pembimbing1Val && pembimbing1Val.length > 0
        ? pembimbing1Val
        : rows[0].pembimbing1_diajukan_nidn;
    const effectivePembimbing2 =
      pembimbing2Val && pembimbing2Val.length > 0
        ? pembimbing2Val
        : rows[0].pembimbing2_diajukan_nidn;
    // Compared after the update, so changing only one of them can't make both the same dosen.
    if (effectivePembimbing1 === effectivePembimbing2) {
      await conn.rollback();
      txStarted = false;
      return res.status(400).json({
        ok: false,
        message: "Pembimbing 1 dan Pembimbing 2 tidak boleh dosen yang sama",
      });
    }
    if (
      !(await dosenBimbingProdiService.areEligible(rows[0].program_studi_id, [
        effectivePembimbing1,
        effectivePembimbing2,
      ]))
    ) {
      await conn.rollback();
      txStarted = false;
      return res.status(400).json({
        ok: false,
        message:
          "Dosen pembimbing yang dipilih tidak tersedia untuk program studi Anda",
      });
    }

    const sets = [];
    const params = [];

    if (noHpVal !== null && noHpVal.length > 0) {
      sets.push("no_hp = ?");
      params.push(noHpVal);
    }
    if (pembimbing1Val !== null && pembimbing1Val.length > 0) {
      sets.push("pembimbing1_diajukan_nidn = ?");
      params.push(pembimbing1Val);
    }
    if (pembimbing2Val !== null && pembimbing2Val.length > 0) {
      sets.push("pembimbing2_diajukan_nidn = ?");
      params.push(pembimbing2Val);
    }
    if (perluSuratProvided) {
      sets.push("perlu_surat_pengantar = ?");
      params.push(Boolean(perluSuratPengantar) ? 1 : 0);
      if (!Boolean(perluSuratPengantar)) {
        sets.push("nama_perusahaan = NULL");
        sets.push("alamat_perusahaan = NULL");
        sets.push("nomor_sk_surat_pengantar = NULL");
      } else if (!rows[0].nomor_sk_surat_pengantar) {
        sets.push("nomor_sk_surat_pengantar = ?");
        params.push(
          await generateNomorSkSuratPengantar(conn, rows[0].program_studi_id),
        );
      }
    }
    if (
      namaPerusahaanVal !== null &&
      namaPerusahaanVal.length > 0 &&
      (!perluSuratProvided || Boolean(perluSuratPengantar))
    ) {
      sets.push("nama_perusahaan = ?");
      params.push(namaPerusahaanVal);
    }
    if (
      alamatPerusahaanVal !== null &&
      alamatPerusahaanVal.length > 0 &&
      (!perluSuratProvided || Boolean(perluSuratPengantar))
    ) {
      sets.push("alamat_perusahaan = ?");
      params.push(alamatPerusahaanVal);
    }
    const currentRow = rows[0];
    sets.push("syarat_transkrip = ?");
    params.push(toBit(syaratTranskrip, currentRow.syarat_transkrip ?? 0));
    sets.push("status = 'SUBMITTED'");
    sets.push("submitted_at = CURRENT_TIMESTAMP");
    sets.push("disposisi_at = NULL");
    sets.push("catatan_kaprodi = NULL");
    sets.push("decided_by_user_id = NULL");
    sets.push("pembimbing1_ditetapkan_nidn = NULL");
    sets.push("pembimbing2_ditetapkan_nidn = NULL");
    sets.push("updated_at = CURRENT_TIMESTAMP");

    const sql = `UPDATE pengajuan_disposisi_pembimbing SET ${sets.join(", ")} WHERE id = ?`;
    params.push(id);
    await conn.query(sql, params);

    const [resubDocDataRows] = await conn.query(
      `SELECT
         m.nama AS nama_mahasiswa, m.sks,
         ps.nama AS program_studi_nama,
         o.judul AS judul_skripsi,
         pj.no_hp, pj.perlu_surat_pengantar, pj.nama_perusahaan,
         pj.pembimbing1_diajukan_nidn, pj.pembimbing2_diajukan_nidn,
         d1.nama AS pembimbing1_nama,
         d2.nama AS pembimbing2_nama,
         u.signature_image
       FROM pengajuan_disposisi_pembimbing pj
       JOIN mahasiswa m ON m.npm = pj.npm
       JOIN program_studi ps ON ps.id = pj.program_studi_id
       JOIN outline o ON o.id = pj.outline_id
       LEFT JOIN dosen d1 ON d1.nidn = pj.pembimbing1_diajukan_nidn
       LEFT JOIN dosen d2 ON d2.nidn = pj.pembimbing2_diajukan_nidn
       LEFT JOIN users u ON u.npm = pj.npm AND u.is_active = 1
       WHERE pj.id = ?
       LIMIT 1`,
      [id],
    );
    const resubDocData = resubDocDataRows[0] ?? {};

    assertSignatures([
      {
        role: "Mahasiswa",
        nama: resubDocData.nama_mahasiswa,
        signatureImage: resubDocData.signature_image,
      },
    ]);

    if (fileTranskripVal !== null && fileTranskripVal.length > 0) {
      await upsertFileByType(
        conn,
        id,
        "TRANSKRIP",
        fileTranskripVal,
        fileTranskripNameVal !== null && fileTranskripNameVal.length > 0
          ? fileTranskripNameVal
          : null,
      );
    }

    const [resubMahasiswaRows] = await conn.query(
      `SELECT m.nama, m.program_studi_id FROM mahasiswa m WHERE m.npm = ? LIMIT 1`,
      [npm],
    );
    const resubNama = resubMahasiswaRows[0]?.nama ?? npm;
    const resubProgramStudiId = resubMahasiswaRows[0]?.program_studi_id ?? null;
    if (resubProgramStudiId) {
      for (const kaprodiUserId of await getKaprodiUserIds(conn, resubProgramStudiId)) {
        await insertNotification(
          conn,
          kaprodiUserId,
          "TITLE_RESUBMITTED",
          `Mahasiswa ${resubNama} mengajukan ulang judul skripsi`,
          "/kaprodi/pengajuan-outline/pengajuan-disposisi-pembimbing",
        );
      }
    }

    await conn.commit();
    txStarted = false;

    return res.json({
      ok: true,
      message: "Pengajuan disposisi pembimbing berhasil diajukan ulang",
    });
  } catch (err) {
    try {
      if (conn && txStarted) {
        await conn.rollback();
      }
    } catch (_) {}
    next(err);
  } finally {
    if (conn) {
      conn.release();
    }
  }
};
