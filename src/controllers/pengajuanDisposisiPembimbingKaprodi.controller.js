const db = require("../db");
const { insertNotification } = require("../utils/notify");
const { parsePagination, listResponse } = require("../utils/pagination");
const dosenBimbingProdiService = require("../services/dosenBimbingProdi.service");
const path = require("path");
const {
  generateFormulirPengajuanDisposisiPembimbingSkripsiFTI,
} = require("../services/generateFormulirPengajuanDisposisiPembimbingSkripsiFTI.js");
const { assertSignatures, getStaffSignature } = require("../utils/signature");
const { getStaffUsrId, getKaprodiProgramStudiIds } = require("../utils/identity");
const { BULAN_ID } = require("../utils/dates");

const toBit = (v, fallback = 0) => (v === undefined ? fallback : v ? 1 : 0);

function formatDateId(date) {
  const d = date instanceof Date ? date : new Date(date);
  return `${d.getDate()} ${BULAN_ID[d.getMonth()]} ${d.getFullYear()}`;
}

function buildFormulirFileName(npm, namaMahasiswa) {
  const safeNpm = String(npm ?? "")
    .trim()
    .replace(/[^\w.-]+/g, "_");
  const safeNama = String(namaMahasiswa ?? "")
    .trim()
    .replace(/[^\w\s.-]+/g, "")
    .replace(/\s+/g, " ");
  return `${safeNpm} - ${safeNama} - Formulir Pengajuan Disposisi Pembimbing.pdf`;
}

async function generateFormulirDoc(data) {
  const dataPengajuanDisposisiPembimbingSkripsi = {
    mahasiswa: {
      npm: data.npm,
      nama: data.namaMahasiswa,
      programStudi: data.programStudiNama,
      nomorHp: data.noHp,
      sksDiperoleh: data.sks,
      judulDiajukan: data.judulSkripsi,
      dosenPembimbingPertama: data.pembimbing1DiajukanNama,
      dosenPembimbingKedua: data.pembimbing2DiajukanNama,
    },
    pengajuan: {
      perluSuratPengantar: {
        ya: data.perluSuratPengantar,
        tidak: !data.perluSuratPengantar,
      },
      namaPerusahaan: data.namaPerusahaan,
      alamatPerusahaan: data.alamatPerusahaan,
      syaratAdministratif: {
        salinanTranskripNilai: data.syaratTranskrip,
      },
      tanggal: formatDateId(data.submittedAt),
      namaPemohon: data.namaMahasiswa,
      signatureBase64: data.studentSignature,
    },
    disposisi: {
      programStudi: data.programStudiNama,
      tanggal: formatDateId(data.disposisiDate),
      keputusan: data.keputusan,
      dosenPembimbingPertama: data.dosenPembimbing1,
      dosenPembimbingKedua: data.dosenPembimbing2,
      catatan: data.catatan,
      namaKetuaProgramStudi: data.namaKaprodi,
      signatureBase64: data.kaprodiSignature,
    },
  };

  const outputBuffer =
    await generateFormulirPengajuanDisposisiPembimbingSkripsiFTI(
      dataPengajuanDisposisiPembimbingSkripsi,
    );

  return Buffer.from(outputBuffer).toString("base64");
}

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

// Generates the approved Formulir Pengajuan Disposisi Pembimbing (Keputusan: Diterima, with the
// final pembimbing) and stores it; blocking on the student and Kaprodi signatures.
async function generateAndStoreFormulir(conn, id, catatan) {
  const [reviewDocRows] = await conn.query(
    `SELECT
       pj.npm, pj.no_hp, pj.perlu_surat_pengantar, pj.nama_perusahaan,
       pj.alamat_perusahaan,
       pj.submitted_at,
       pj.syarat_transkrip,
       m.nama AS nama_mahasiswa, m.sks AS mahasiswa_sks,
       ps.nama AS program_studi_nama, ps.kaprodi_staff_usr_id,
       o.judul AS judul_skripsi,
       d1.nama AS pembimbing1_diajukan_nama,
       d2.nama AS pembimbing2_diajukan_nama,
       d3.nama AS pembimbing1_ditetapkan_nama,
       d4.nama AS pembimbing2_ditetapkan_nama,
       u_student.signature_image AS student_signature,
       staf.nama AS kaprodi_nama
     FROM pengajuan_disposisi_pembimbing pj
     JOIN mahasiswa m ON m.npm = pj.npm
     JOIN program_studi ps ON ps.id = pj.program_studi_id
     JOIN outline o ON o.id = pj.outline_id
     LEFT JOIN dosen d1 ON d1.nidn = pj.pembimbing1_diajukan_nidn
     LEFT JOIN dosen d2 ON d2.nidn = pj.pembimbing2_diajukan_nidn
     LEFT JOIN dosen d3 ON d3.nidn = pj.pembimbing1_ditetapkan_nidn
     LEFT JOIN dosen d4 ON d4.nidn = pj.pembimbing2_ditetapkan_nidn
     LEFT JOIN users u_student ON u_student.npm = pj.npm AND u_student.is_active = 1
     LEFT JOIN staf ON staf.usr_id = ps.kaprodi_staff_usr_id
     WHERE pj.id = ?
     LIMIT 1`,
    [id],
  );
  const rd = reviewDocRows[0] ?? {};
  const kaprodiSignature = await getStaffSignature(conn, rd.kaprodi_staff_usr_id);

  assertSignatures([
    { role: "Mahasiswa", nama: rd.nama_mahasiswa, signatureImage: rd.student_signature },
    { role: "Kaprodi", nama: rd.kaprodi_nama, signatureImage: kaprodiSignature },
  ]);

  const formulirBase64 = await generateFormulirDoc({
    npm: rd.npm,
    namaMahasiswa: rd.nama_mahasiswa,
    programStudiNama: rd.program_studi_nama,
    noHp: rd.no_hp,
    sks: rd.mahasiswa_sks,
    judulSkripsi: rd.judul_skripsi,
    pembimbing1DiajukanNama: rd.pembimbing1_diajukan_nama ?? "",
    pembimbing2DiajukanNama: rd.pembimbing2_diajukan_nama ?? "",
    perluSuratPengantar: Boolean(rd.perlu_surat_pengantar),
    namaPerusahaan: rd.nama_perusahaan ?? null,
    alamatPerusahaan: rd.alamat_perusahaan ?? null,
    studentSignature: rd.student_signature,
    submittedAt: rd.submitted_at ? new Date(rd.submitted_at) : new Date(),
    programStudiNamaUpper: rd.program_studi_nama
      ? String(rd.program_studi_nama).toUpperCase()
      : "",
    disposisiDate: new Date(),
    keputusan: "Diterima",
    dosenPembimbing1: rd.pembimbing1_ditetapkan_nama ?? "",
    dosenPembimbing2: rd.pembimbing2_ditetapkan_nama ?? "",
    catatan,
    syaratTranskrip: Boolean(rd.syarat_transkrip),
    namaKaprodi: rd.kaprodi_nama ?? "",
    kaprodiSignature,
  });

  await upsertFileByType(
    conn,
    id,
    "PENGAJUAN_DISPOSISI_PEMBIMBING",
    formulirBase64,
    buildFormulirFileName(rd.npm, rd.nama_mahasiswa),
  );
}

// Program studi the caller heads as Kaprodi (staff account); empty for anyone else.
async function getCallerKaprodiProgramStudiIds(req) {
  if (!req.user.hasRole("KAPRODI")) return [];
  return getKaprodiProgramStudiIds(await getStaffUsrId(req.user.id));
}

exports.listForKaprodi = async (req, res, next) => {
  try {
    const programStudiIds = await getCallerKaprodiProgramStudiIds(req);
    if (programStudiIds.length === 0) {
      return res.status(403).json({ ok: false, message: "Hanya Kaprodi yang dapat mengakses fitur ini" });
    }

    const tahunAkademik = req.query.tahunAkademik
      ? String(req.query.tahunAkademik)
      : null;
    const pagination = parsePagination(req.query);
    const periodeAkademik = req.query.periodeAkademik
      ? String(req.query.periodeAkademik)
      : null;
    const q = String(req.query.q ?? "").trim();
    const status = String(req.query.status ?? "").trim();

    const where = ["ps.id IN (?)"];
    const params = [programStudiIds];

    if (tahunAkademik) {
      where.push("osp.tahun_akademik = ?");
      params.push(tahunAkademik);
    }

    if (periodeAkademik) {
      where.push("osp.periode_akademik = ?");
      params.push(periodeAkademik);
    }
    if (q) {
      const searchValue = `%${q}%`;
      where.push("(m.nama LIKE ? OR m.npm LIKE ? OR o.judul LIKE ?)");
      params.push(searchValue, searchValue, searchValue);
    }
    if (status) {
      where.push("pj.status = ?");
      params.push(status);
    }

    const listFrom = `FROM pengajuan_disposisi_pembimbing pj
      INNER JOIN outline o ON o.id = pj.outline_id
      INNER JOIN mahasiswa m ON m.npm = pj.npm
      INNER JOIN program_studi ps ON ps.id = m.program_studi_id
      LEFT JOIN outline_submission_period osp ON osp.id = o.submission_period_id`;
    const [[countRow]] = await db.query(
      `SELECT COUNT(*) AS total ${listFrom} WHERE ${where.join(" AND ")}`,
      params,
    );

    const [rows] = await db.query(
      `
      SELECT
        pj.id,
        pj.status,
        pj.submitted_at,
        pj.created_at,
        o.judul AS outline_judul,
        m.npm,
        m.nama AS nama_mahasiswa,
        m.sks AS mahasiswa_sks,
        ps.nama AS program_studi,
        o.submission_period_id,
        osp.tahun_akademik AS period_tahun_akademik,
        osp.periode_akademik AS period_periode_akademik
      FROM pengajuan_disposisi_pembimbing pj
      INNER JOIN outline o ON o.id = pj.outline_id
      INNER JOIN mahasiswa m ON m.npm = pj.npm
      INNER JOIN program_studi ps ON ps.id = m.program_studi_id
      LEFT JOIN outline_submission_period osp ON osp.id = o.submission_period_id
      WHERE ${where.join(" AND ")}
      ORDER BY pj.submitted_at DESC${pagination.enabled ? " LIMIT ? OFFSET ?" : ""}
      `,
      pagination.enabled
        ? [...params, pagination.limit, pagination.offset]
        : params,
    );

    if (rows.length > 0) {
      const ids = rows.map((row) => row.id);
      // Only presence + name: the PDF itself is fetched on download via GET /:id,
      // so a list page doesn't ship every row's base64 file.
      const [fileRows] = await db.query(
        `SELECT pengajuan_disposisi_pembimbing_id, file_name
         FROM pengajuan_disposisi_pembimbing_file
         WHERE file_type = 'PENGAJUAN_DISPOSISI_PEMBIMBING'
           AND file_content IS NOT NULL
           AND pengajuan_disposisi_pembimbing_id IN (?)`,
        [ids],
      );
      const fileNames = new Map(
        fileRows.map((fr) => [fr.pengajuan_disposisi_pembimbing_id, fr.file_name]),
      );
      for (const row of rows) {
        row.has_file_pengajuan_disposisi_pembimbing = fileNames.has(row.id);
        row.file_pengajuan_disposisi_pembimbing_name = fileNames.get(row.id) ?? null;
      }
    }

    pagination.totalItems = Number(countRow.total);
    return listResponse(res, { rows, pagination });
  } catch (err) {
    next(err);
  }
};

exports.review = async (req, res, next) => {
  let conn;
  let txStarted = false;
  try {

    const programStudiIds = await getCallerKaprodiProgramStudiIds(req);
    if (programStudiIds.length === 0) {
      return res.status(403).json({ ok: false, message: "Hanya Kaprodi yang dapat mengakses fitur ini" });
    }

    const id = Number(req.params.id);
    if (!Number.isFinite(id)) {
      return res.status(400).json({ ok: false, message: "ID pengajuan tidak valid" });
    }

    const {
      status,
      pembimbing1DitapkanNidn,
      pembimbing2DitapkanNidn,
      catatanKaprodi,
      syaratTranskrip,
    } = req.body || {};

    const pembimbing1Val =
      pembimbing1DitapkanNidn != null
        ? String(pembimbing1DitapkanNidn).trim()
        : "";
    const pembimbing2Val =
      pembimbing2DitapkanNidn != null
        ? String(pembimbing2DitapkanNidn).trim()
        : "";


    if (!["APPROVED", "NEED_REVISION"].includes(status)) {
      return res.status(400).json({ ok: false, message: "Keputusan review tidak valid" });
    }

    if (status === "APPROVED" && (!pembimbing1Val || !pembimbing2Val)) {
      return res.status(400).json({
        ok: false,
        message: "Pembimbing 1 dan Pembimbing 2 wajib dipilih untuk menyetujui pengajuan",
      });
    }

    if (status === "APPROVED" && pembimbing1Val === pembimbing2Val) {
      return res.status(400).json({
        ok: false,
        message: "Pembimbing 1 dan Pembimbing 2 tidak boleh dosen yang sama",
      });
    }

    if (
      status === "NEED_REVISION" &&
      (!catatanKaprodi || String(catatanKaprodi).trim().length === 0)
    ) {
      return res.status(400).json({
        ok: false,
        message: "Catatan Kaprodi wajib diisi untuk keputusan Perlu Revisi",
      });
    }

    // Pastikan pengajuan ini memang milik prodinya Kaprodi
    const [check] = await db.query(
      `
      SELECT pj.id, pj.program_studi_id, pj.syarat_transkrip
      FROM pengajuan_disposisi_pembimbing pj
      INNER JOIN mahasiswa m ON m.npm = pj.npm
      WHERE pj.id = ?
        AND m.program_studi_id IN (?)
        AND pj.status = 'SUBMITTED'
      LIMIT 1
      `,
      [id, programStudiIds],
    );

    if (check.length === 0) {
      return res.status(404).json({
        ok: false,
        message: "Pengajuan tidak ditemukan / bukan wewenang Anda",
      });
    }

    // Approving means the transkrip was checked and needs no revision.
    const effectiveSyaratTranskrip = toBit(syaratTranskrip, check[0].syarat_transkrip ?? 0);
    if (status === "APPROVED" && !effectiveSyaratTranskrip) {
      return res.status(400).json({
        ok: false,
        message: "Transkrip nilai harus dicentang (valid) sebelum pengajuan disetujui",
      });
    }

    if (
      status === "APPROVED" &&
      !(await dosenBimbingProdiService.areEligible(check[0].program_studi_id, [
        pembimbing1Val,
        pembimbing2Val,
      ]))
    ) {
      return res.status(400).json({
        ok: false,
        message:
          "Dosen pembimbing yang dipilih tidak tersedia untuk program studi ini",
      });
    }

    conn = await db.getConnection();
    await conn.beginTransaction();
    txStarted = true;

    // The check above ran outside the transaction; re-check under a row lock so a double-clicked
    // or concurrent review can't decide the same submission twice (duplicate PDF + notifications).
    const [[locked]] = await conn.query(
      `SELECT status FROM pengajuan_disposisi_pembimbing WHERE id = ? FOR UPDATE`,
      [id],
    );
    if (locked?.status !== "SUBMITTED") {
      await conn.rollback();
      txStarted = false;
      return res.status(409).json({
        ok: false,
        message: "Pengajuan ini sudah direview",
      });
    }

    let consultationInitialized = false;

    await conn.query(
      `
      UPDATE pengajuan_disposisi_pembimbing
      SET
        status = ?,
        pembimbing1_ditetapkan_nidn = ?,
        pembimbing2_ditetapkan_nidn = ?,
        catatan_kaprodi = ?,
        disposisi_at = CURRENT_TIMESTAMP,
        decided_by_user_id = ?
      WHERE id = ?
      `,
      [
        status,
        pembimbing1Val || null,
        pembimbing2Val || null,
        catatanKaprodi ?? null,
        req.user.id,
        id,
      ],
    );

    if (status === "APPROVED") {
      const [snapshotRows] = await conn.query(
        `SELECT
           pj.id AS pengajuan_disposisi_pembimbing_id,
           pj.outline_id,
           pj.npm,
           pj.program_studi_id,
           pj.pembimbing1_ditetapkan_nidn,
           pj.pembimbing2_ditetapkan_nidn,
           o.judul AS judul_skripsi,
           m.nama AS nama_mahasiswa,
           ps.nama AS program_studi_nama,
           d1.nama AS pembimbing1_nama,
           d2.nama AS pembimbing2_nama
         FROM pengajuan_disposisi_pembimbing pj
         INNER JOIN outline o ON o.id = pj.outline_id
         INNER JOIN mahasiswa m ON m.npm = pj.npm
         LEFT JOIN program_studi ps ON ps.id = pj.program_studi_id
         LEFT JOIN dosen d1 ON d1.nidn = pj.pembimbing1_ditetapkan_nidn
         LEFT JOIN dosen d2 ON d2.nidn = pj.pembimbing2_ditetapkan_nidn
         WHERE pj.id = ?
         LIMIT 1`,
        [id],
      );
      const snap = snapshotRows[0] || null;

      if (!snap) {
        await conn.rollback();
        txStarted = false;
        return res.status(409).json({
          ok: false,
          message: "Data pengajuan tidak ditemukan untuk memulai konsultasi outline",
        });
      }
      if (!snap.program_studi_id) {
        await conn.rollback();
        txStarted = false;
        return res.status(409).json({
          ok: false,
          message: "Data pengajuan belum lengkap: program studi",
        });
      }
      if (
        !snap.program_studi_nama ||
        String(snap.program_studi_nama).trim().length === 0
      ) {
        await conn.rollback();
        txStarted = false;
        return res.status(409).json({
          ok: false,
          message: "Data pengajuan belum lengkap: nama program studi",
        });
      }
      if (
        !snap.judul_skripsi ||
        String(snap.judul_skripsi).trim().length === 0
      ) {
        await conn.rollback();
        txStarted = false;
        return res.status(409).json({
          ok: false,
          message: "Data pengajuan belum lengkap: judul skripsi",
        });
      }
      if (
        !snap.nama_mahasiswa ||
        String(snap.nama_mahasiswa).trim().length === 0
      ) {
        await conn.rollback();
        txStarted = false;
        return res.status(409).json({
          ok: false,
          message: "Data pengajuan belum lengkap: nama mahasiswa",
        });
      }
      if (
        !snap.pembimbing2_ditetapkan_nidn ||
        String(snap.pembimbing2_ditetapkan_nidn).trim().length === 0
      ) {
        await conn.rollback();
        txStarted = false;
        return res.status(409).json({
          ok: false,
          message: "Data pengajuan belum lengkap: Pembimbing 2",
        });
      }

      await conn.query(
        `UPDATE outline SET
           pembimbing1_nidn = ?,
           pembimbing2_nidn = ?,
           approved_at      = CURRENT_TIMESTAMP
         WHERE id = ?`,
        [
          snap.pembimbing1_ditetapkan_nidn ?? null,
          String(snap.pembimbing2_ditetapkan_nidn).trim(),
          snap.outline_id,
        ],
      );

      const [kartuRows] = await conn.query(
        `SELECT id FROM kartu_konsultasi_outline WHERE outline_id = ? LIMIT 1 FOR UPDATE`,
        [snap.outline_id],
      );

      if (kartuRows.length === 0) {
        const [insKartu] = await conn.query(
          `INSERT INTO kartu_konsultasi_outline (outline_id, is_completed) VALUES (?, 0)`,
          [snap.outline_id],
        );

        await conn.query(
          `INSERT INTO konsultasi_outline_stage (
             kartu_konsultasi_outline_id,
             stage,
             pembimbing_nidn,
             current_status,
             current_submission_no,
             started_at
           ) VALUES (?, 'PEMBIMBING_2', ?, 'WAITING_SUBMISSION', 0, CURRENT_TIMESTAMP)`,
          [insKartu.insertId, String(snap.pembimbing2_ditetapkan_nidn).trim()],
        );

        consultationInitialized = true;
      }
    }

    if (syaratTranskrip !== undefined) {
      const currentRow = check[0];
      await conn.query(
        `UPDATE pengajuan_disposisi_pembimbing
         SET syarat_transkrip = ?
         WHERE id = ?`,
        [toBit(syaratTranskrip, currentRow.syarat_transkrip ?? 0), id],
      );
    }

    // The formulir records a final decision (its Keputusan field is Diterima/Ditolak), so it's only
    // made on approval; Perlu Revisi just returns the note to the student.
    if (status === "APPROVED") {
      await generateAndStoreFormulir(conn, id, catatanKaprodi ?? null);
    }

    const [reviewedRows] = await conn.query(
      `SELECT pj.npm, m.nama AS nama_mahasiswa,
              pj.pembimbing1_ditetapkan_nidn, pj.pembimbing2_ditetapkan_nidn
       FROM pengajuan_disposisi_pembimbing pj
       JOIN mahasiswa m ON m.npm = pj.npm
       WHERE pj.id = ? LIMIT 1`,
      [id],
    );
    const reviewed = reviewedRows[0];
    if (reviewed) {
      const [studentUserRows] = await conn.query(
        `SELECT id FROM users WHERE npm = ? LIMIT 1`,
        [reviewed.npm],
      );
      const studentUserId = studentUserRows[0]?.id ?? null;
      if (studentUserId) {
        const typeMap = {
          NEED_REVISION: "TITLE_NEED_REVISION",
          APPROVED: "TITLE_APPROVED",
        };
        const msgMap = {
          NEED_REVISION:
            "Pengajuan disposisi pembimbing Anda memerlukan revisi",
          APPROVED: "Pengajuan disposisi pembimbing Anda disetujui",
        };
        await insertNotification(
          conn,
          studentUserId,
          typeMap[status],
          msgMap[status],
          "/student/pengajuan-outline",
        );
      }

      if (status === "APPROVED") {
        const assignMsg = `Anda ditugaskan sebagai pembimbing skripsi untuk ${reviewed.nama_mahasiswa}`;
        for (const nidn of [
          reviewed.pembimbing1_ditetapkan_nidn,
          reviewed.pembimbing2_ditetapkan_nidn,
        ]) {
          if (!nidn) continue;
          const [pUserRows] = await conn.query(
            `SELECT u.id FROM users u
             JOIN user_roles ur ON ur.user_id = u.id
             JOIN roles r ON r.id = ur.role_id
             WHERE u.nidn = ? AND r.code = 'PEMBIMBING'
             LIMIT 1`,
            [nidn],
          );
          if (pUserRows[0]?.id) {
            await insertNotification(
              conn,
              pUserRows[0].id,
              "ASSIGNED_AS_PEMBIMBING",
              assignMsg,
              "/pembimbing/outline-consultations",
            );
          }
        }
      }
    }

    await conn.commit();
    txStarted = false;

    return res.json({
      ok: true,
      message: consultationInitialized
        ? "Review tersimpan dan konsultasi outline dimulai"
        : "Review tersimpan",
    });
  } catch (err) {
    console.error("[review] ERROR:", err.message, err.stack);
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
