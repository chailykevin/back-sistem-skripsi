const db = require("../db");
const path = require("path");
const { readFile } = require("fs/promises");
const { patchDocument, PatchType, TextRun, ImageRun } = require("docx");
const { insertNotification } = require("../utils/notify");

const MIME_DOCX =
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document";

const BULAN_ID = [
  "Januari",
  "Februari",
  "Maret",
  "April",
  "Mei",
  "Juni",
  "Juli",
  "Agustus",
  "September",
  "Oktober",
  "November",
  "Desember",
];
const HARI_ID = [
  "Minggu",
  "Senin",
  "Selasa",
  "Rabu",
  "Kamis",
  "Jumat",
  "Sabtu",
];

function formatTanggal(date) {
  return `${date.getDate()} ${BULAN_ID[date.getMonth()]} ${date.getFullYear()}`;
}

function formatHari(date) {
  return HARI_ID[date.getDay()];
}

function textPatch(value) {
  return {
    type: PatchType.PARAGRAPH,
    children: [new TextRun(String(value ?? ""))],
  };
}

function decodeSignatureToBuffer(signatureValue) {
  if (!signatureValue) return null;
  const base64 = signatureValue.includes(",")
    ? signatureValue.split(",")[1]
    : signatureValue;
  try {
    return Buffer.from(base64, "base64");
  } catch {
    return null;
  }
}

function signaturePatch(signatureValue) {
  const buf = decodeSignatureToBuffer(signatureValue);
  if (!buf) return textPatch("");
  return {
    type: PatchType.PARAGRAPH,
    children: [
      new ImageRun({ data: buf, transformation: { width: 100, height: 50 } }),
    ],
  };
}

async function resolveUserId(conn, nidn) {
  if (!nidn) return null;
  const [[row]] = await conn.query(
    `SELECT id FROM users WHERE nidn = ? AND is_active = 1 ORDER BY id ASC LIMIT 1`,
    [nidn],
  );
  return row?.id ?? null;
}

async function getLecturerNidn(userId) {
  const [rows] = await db.query(
    `SELECT nidn FROM users WHERE id = ? AND is_active = 1 LIMIT 1`,
    [userId],
  );
  return rows[0]?.nidn ?? null;
}

async function getStudentNpm(userId) {
  const [rows] = await db.query(
    `SELECT npm FROM users WHERE id = ? AND is_active = 1 LIMIT 1`,
    [userId],
  );
  return rows[0]?.npm ?? null;
}

function resolveSidangRole(sidangRow, nidn) {
  if (sidangRow.pembimbing1_nidn === nidn) return "PEMBIMBING_1";
  if (sidangRow.pembimbing2_nidn === nidn) return "PEMBIMBING_2";
  if (sidangRow.penguji1_nidn === nidn) return "PENGUJI_1";
  if (sidangRow.penguji2_nidn === nidn) return "PENGUJI_2";
  return null;
}

function computeGrade(rata) {
  if (rata >= 80) return "A";
  if (rata >= 70) return "B";
  if (rata >= 60) return "C";
  return "D";
}

const ROLE_LABEL = {
  PEMBIMBING_1: "Pembimbing Pertama",
  PEMBIMBING_2: "Pembimbing Kedua",
  PENGUJI_1: "Penguji Pertama",
  PENGUJI_2: "Penguji Kedua",
};

const BOBOT = {
  isi: 0.3,
  bahasa: 0.15,
  tsp: 0.05,
  penguasaan: 0.4,
  penunjang: 0.1,
};

const NOTULEN_ROLE_LABEL = {
  PENGUJI_1: "Penguji Utama",
  PENGUJI_2: "Anggota Penguji",
};

async function getSidangBySkripsiId(conn, skripsiId) {
  const [[sidang]] = await conn.query(
    `SELECT
       s.id, s.skripsi_id, s.pengajuan_sidang_id, s.nomor_surat,
       m.nama AS nama_mahasiswa, psk_k.tanggal_sidang, psk_k.waktu_sidang, psk_k.tempat_sidang,
       psk_k.tanggal_disposisi, s.status, s.hasil_sidang, s.catatan_penguji,
       s.created_at, s.updated_at, s.completed_at,
       ps.ujian_ke,
       m.npm,
       prog.id   AS program_studi_id,
       prog.nama AS program_studi_nama,
       sk.judul  AS judul_skripsi,
       sk.pembimbing1_nidn, d1.nama   AS pembimbing1_nama,
       sk.pembimbing2_nidn, d2.nama   AS pembimbing2_nama,
       psk_k.penguji1_nidn, d_pg1.nama AS penguji1_nama,
       psk_k.penguji2_nidn, d_pg2.nama AS penguji2_nama
     FROM sidang s
     LEFT JOIN pengajuan_sidang ps ON ps.id = s.pengajuan_sidang_id
     JOIN skripsi sk ON sk.id = s.skripsi_id
     JOIN mahasiswa m ON m.npm = sk.npm
     JOIN program_studi prog ON prog.id = sk.program_studi_id
     LEFT JOIN dosen d1 ON d1.nidn = sk.pembimbing1_nidn
     LEFT JOIN dosen d2 ON d2.nidn = sk.pembimbing2_nidn
     LEFT JOIN pengajuan_sidang_kaprodi psk_k
            ON psk_k.pengajuan_sidang_id = s.pengajuan_sidang_id
     LEFT JOIN dosen d_pg1 ON d_pg1.nidn = psk_k.penguji1_nidn
     LEFT JOIN dosen d_pg2 ON d_pg2.nidn = psk_k.penguji2_nidn
     WHERE s.skripsi_id = ? ORDER BY s.id DESC LIMIT 1`,
    [skripsiId],
  );
  return sidang ?? null;
}

// GET /sidang/:skripsiId
exports.getSidang = async (req, res, next) => {
  try {
    const skripsiId = Number(req.params.skripsiId);
    if (!Number.isFinite(skripsiId) || skripsiId <= 0) {
      return res
        .status(400)
        .json({ ok: false, message: "Invalid skripsiId" });
    }

    const [[sidang]] = await db.query(
      `SELECT
         s.id, s.skripsi_id, s.pengajuan_sidang_id, s.nomor_surat,
         m.nama AS nama_mahasiswa, psk_k.tanggal_sidang, psk_k.waktu_sidang, psk_k.tempat_sidang,
         psk_k.tanggal_disposisi, s.status, s.hasil_sidang, s.catatan_penguji,
         s.created_at, s.updated_at, s.completed_at,
         ps.ujian_ke,
         m.npm,
         prog.id   AS program_studi_id,
         prog.nama AS program_studi_nama,
         sk.judul  AS judul_skripsi,
         sk.pembimbing1_nidn, d1.nama   AS pembimbing1_nama,
         sk.pembimbing2_nidn, d2.nama   AS pembimbing2_nama,
         psk_k.penguji1_nidn, d_pg1.nama AS penguji1_nama,
         psk_k.penguji2_nidn, d_pg2.nama AS penguji2_nama
       FROM sidang s
       LEFT JOIN pengajuan_sidang ps ON ps.id = s.pengajuan_sidang_id
       JOIN skripsi sk ON sk.id = s.skripsi_id
       JOIN mahasiswa m ON m.npm = sk.npm
       JOIN program_studi prog ON prog.id = sk.program_studi_id
       LEFT JOIN dosen d1 ON d1.nidn = sk.pembimbing1_nidn
       LEFT JOIN dosen d2 ON d2.nidn = sk.pembimbing2_nidn
       LEFT JOIN pengajuan_sidang_kaprodi psk_k
              ON psk_k.pengajuan_sidang_id = s.pengajuan_sidang_id
       LEFT JOIN dosen d_pg1 ON d_pg1.nidn = psk_k.penguji1_nidn
       LEFT JOIN dosen d_pg2 ON d_pg2.nidn = psk_k.penguji2_nidn
       WHERE s.skripsi_id = ? ORDER BY s.id DESC LIMIT 1`,
      [skripsiId],
    );
    if (!sidang) {
      return res
        .status(404)
        .json({ ok: false, message: "Sidang tidak ditemukan" });
    }

    // Authorization: student must own this pengajuan_disposisi_pembimbing; dosen must be one of the 4 participants
    const isStudent = req.user.hasRole("STUDENT");
    const isSekretatariat = req.user.hasRole("SEKRETARIAT");
    const isKaprodi = req.user.hasRole("KAPRODI");
    if (isStudent) {
      const npm = await getStudentNpm(req.user.id);
      if (npm !== sidang.npm) {
        return res.status(403).json({ ok: false, message: "Forbidden" });
      }
    } else if (!isSekretatariat && !isKaprodi) {
      const nidn = await getLecturerNidn(req.user.id);
      const role = resolveSidangRole(sidang, nidn);
      if (!role) {
        return res
          .status(403)
          .json({ ok: false, message: "Anda bukan peserta sidang ini" });
      }
    }

    const [penilaianRows] = await db.query(
      `SELECT * FROM sidang_penilaian WHERE sidang_id = ? ORDER BY FIELD(role,'PEMBIMBING_1','PEMBIMBING_2','PENGUJI_1','PENGUJI_2')`,
      [sidang.id],
    );

    const [notulenRows] = await db.query(
      `SELECT * FROM sidang_notulen WHERE sidang_id = ? ORDER BY FIELD(role,'PENGUJI_1','PENGUJI_2')`,
      [sidang.id],
    );

    const [[hasilPenilaian]] = await db.query(
      `SELECT * FROM sidang_hasil_penilaian WHERE sidang_id = ? LIMIT 1`,
      [sidang.id],
    );

    const [files] = await db.query(
      `SELECT id, file_name, created_at FROM sidang_files WHERE sidang_id = ?`,
      [sidang.id],
    );

    // Determine caller's role for visibility
    let callerRole = null;
    if (!isStudent && !isSekretatariat && !isKaprodi) {
      const nidn = await getLecturerNidn(req.user.id);
      callerRole = resolveSidangRole(sidang, nidn);
    }

    const isOngoing = sidang.status !== "COMPLETED";

    // For mahasiswa during ONGOING: hide score details
    const sanitizePenilaian = (row) => {
      if (!isStudent || !isOngoing) return row;
      const {
        nilai_isi,
        keterangan_isi,
        nilai_bahasa,
        keterangan_bahasa,
        nilai_tsp,
        keterangan_tsp,
        nilai_penguasaan,
        keterangan_penguasaan,
        nilai_penunjang,
        keterangan_penunjang,
        total_nilai,
        file_content,
        file_name,
        submitted_at,
        ...safe
      } = row;
      return safe;
    };

    // For lecturers during ONGOING: hide other participants' scores and file_content but keep submitted_at
    // Pembimbing 1 sees all scores (needed to submit hasil penilaian akhir)
    const sanitizePenilaianForLecturer = (row) => {
      if (!isOngoing || !callerRole || callerRole === "PEMBIMBING_1") return row;
      if (row.role === callerRole) {
        const { file_content, ...safe } = row;
        return safe;
      }
      const {
        nilai_isi,
        keterangan_isi,
        nilai_bahasa,
        keterangan_bahasa,
        nilai_tsp,
        keterangan_tsp,
        nilai_penguasaan,
        keterangan_penguasaan,
        nilai_penunjang,
        keterangan_penunjang,
        total_nilai,
        file_content,
        file_name,
        ...safe
      } = row;
      return safe;
    };

    const sanitizedPenilaian = penilaianRows.map(
      isStudent ? sanitizePenilaian : sanitizePenilaianForLecturer,
    );

    // Notulen: hide note + file_content from non-owners during ONGOING
    const sanitizedNotulen = notulenRows.map((row) => {
      if (!isOngoing) return row;
      if (isStudent) {
        const {
          note,
          hasil_sidang,
          file_content,
          file_name,
          submitted_at,
          ...safe
        } = row;
        return safe;
      }
      if (callerRole && row.role !== callerRole) {
        const { note, hasil_sidang, file_content, file_name, submitted_at, ...safe } = row;
        return { ...safe, has_submitted: row.submitted_at !== null };
      }
      const { file_content, ...safe } = row;
      return safe;
    });

    return res.json({
      ok: true,
      data: {
        sidang,
        penilaian: sanitizedPenilaian,
        notulen: sanitizedNotulen,
        hasilPenilaian: hasilPenilaian ?? null,
        files,
      },
    });
  } catch (err) {
    next(err);
  }
};

// PATCH /sidang/:pengajuanDisposisiPembimbingId/start
exports.startSidang = async (req, res, next) => {
  try {
    const skripsiId = Number(req.params.skripsiId);
    if (!Number.isFinite(skripsiId) || skripsiId <= 0) {
      return res
        .status(400)
        .json({ ok: false, message: "Invalid skripsiId" });
    }

    const nidn = await getLecturerNidn(req.user.id);
    if (!nidn) {
      return res
        .status(403)
        .json({ ok: false, message: "Hanya dosen yang dapat memulai sidang" });
    }

    const [[sidang]] = await db.query(
      `SELECT s.*, ps.ujian_ke FROM sidang s LEFT JOIN pengajuan_sidang ps ON ps.id = s.pengajuan_sidang_id WHERE s.skripsi_id = ? ORDER BY s.id DESC LIMIT 1`,
      [skripsiId],
    );
    if (!sidang) {
      return res
        .status(404)
        .json({ ok: false, message: "Sidang tidak ditemukan" });
    }

    if (resolveSidangRole(sidang, nidn) !== "PEMBIMBING_1") {
      return res
        .status(403)
        .json({
          ok: false,
          message: "Hanya Pembimbing 1 yang dapat memulai sidang",
        });
    }

    if (sidang.status === "ONGOING") {
      return res
        .status(409)
        .json({ ok: false, message: "Sidang sudah dimulai" });
    }
    if (sidang.status === "COMPLETED") {
      return res
        .status(409)
        .json({ ok: false, message: "Sidang sudah selesai" });
    }

    await db.query(
      `UPDATE sidang SET status = 'ONGOING', updated_at = NOW() WHERE id = ?`,
      [sidang.id],
    );

    return res.json({ ok: true, message: "Sidang berhasil dimulai" });
  } catch (err) {
    next(err);
  }
};

// POST /sidang/:skripsiId/notulen
exports.submitNotulen = async (req, res, next) => {
  const conn = await db.getConnection();
  let txStarted = false;
  try {
    const skripsiId = Number(req.params.skripsiId);
    if (!Number.isFinite(skripsiId) || skripsiId <= 0) {
      return res
        .status(400)
        .json({ ok: false, message: "Invalid skripsiId" });
    }

    const nidn = await getLecturerNidn(req.user.id);
    if (!nidn) {
      return res
        .status(403)
        .json({ ok: false, message: "Hanya dosen yang dapat mengisi notulen" });
    }

    const { note } = req.body;
    if (!note) {
      return res
        .status(400)
        .json({ ok: false, message: "note wajib diisi" });
    }

    await conn.beginTransaction();
    txStarted = true;

    const sidang = await getSidangBySkripsiId(conn, skripsiId);
    if (!sidang) {
      await conn.rollback();
      txStarted = false;
      return res
        .status(404)
        .json({ ok: false, message: "Sidang tidak ditemukan" });
    }
    if (sidang.status === "SCHEDULED") {
      await conn.rollback();
      txStarted = false;
      return res
        .status(409)
        .json({ ok: false, message: "Sidang belum dimulai" });
    }
    if (sidang.status === "COMPLETED") {
      await conn.rollback();
      txStarted = false;
      return res
        .status(409)
        .json({ ok: false, message: "Sidang sudah selesai" });
    }

    const role = resolveSidangRole(sidang, nidn);
    if (!role || !["PENGUJI_1", "PENGUJI_2"].includes(role)) {
      await conn.rollback();
      txStarted = false;
      return res.status(403).json({
        ok: false,
        message: "Hanya penguji yang dapat mengisi notulen",
      });
    }

    await conn.query(
      `UPDATE sidang_notulen
       SET note = ?, submitted_at = NOW(), updated_at = NOW()
       WHERE sidang_id = ? AND role = ?`,
      [note, sidang.id, role],
    );

    await conn.commit();
    txStarted = false;

    return res.json({ ok: true, message: "Notulen berhasil disimpan" });
  } catch (err) {
    try {
      if (txStarted) await conn.rollback();
    } catch (_) {}
    next(err);
  } finally {
    conn.release();
  }
};

// POST /sidang/:skripsiId/penilaian
exports.submitPenilaian = async (req, res, next) => {
  const conn = await db.getConnection();
  let txStarted = false;
  try {
    const skripsiId = Number(req.params.skripsiId);
    if (!Number.isFinite(skripsiId) || skripsiId <= 0) {
      return res
        .status(400)
        .json({ ok: false, message: "Invalid skripsiId" });
    }

    const nidn = await getLecturerNidn(req.user.id);
    if (!nidn) {
      return res.status(403).json({
        ok: false,
        message: "Hanya dosen yang dapat mengisi penilaian",
      });
    }

    const {
      nilaiIsi,
      keteranganIsi,
      nilaiBahasa,
      keteranganBahasa,
      nilaiTsp,
      keteranganTsp,
      nilaiPenguasaan,
      keteranganPenguasaan,
      nilaiPenunjang,
      keteranganPenunjang,
    } = req.body;

    const requiredNilai = [
      nilaiIsi,
      nilaiBahasa,
      nilaiTsp,
      nilaiPenguasaan,
      nilaiPenunjang,
    ];
    if (requiredNilai.some((v) => v === undefined || v === null)) {
      return res
        .status(400)
        .json({ ok: false, message: "Semua nilai wajib diisi" });
    }
    const parsedNilai = requiredNilai.map(Number);
    if (parsedNilai.some((v) => !Number.isFinite(v))) {
      return res
        .status(400)
        .json({ ok: false, message: "Nilai harus berupa angka" });
    }
    if (parsedNilai.some((v) => v < 0 || v > 100)) {
      return res
        .status(400)
        .json({ ok: false, message: "Nilai harus antara 0 dan 100" });
    }

    await conn.beginTransaction();
    txStarted = true;

    const sidang = await getSidangBySkripsiId(conn, skripsiId);
    if (!sidang) {
      await conn.rollback();
      txStarted = false;
      return res
        .status(404)
        .json({ ok: false, message: "Sidang tidak ditemukan" });
    }
    if (sidang.status === "SCHEDULED") {
      await conn.rollback();
      txStarted = false;
      return res
        .status(409)
        .json({ ok: false, message: "Sidang belum dimulai" });
    }
    if (sidang.status === "COMPLETED") {
      await conn.rollback();
      txStarted = false;
      return res
        .status(409)
        .json({ ok: false, message: "Sidang sudah selesai" });
    }

    const role = resolveSidangRole(sidang, nidn);
    if (!role) {
      await conn.rollback();
      txStarted = false;
      return res
        .status(403)
        .json({ ok: false, message: "Anda bukan peserta sidang ini" });
    }

    const [[sigRow]] = await conn.query(
      `SELECT signature_image FROM users WHERE id = ? LIMIT 1`,
      [req.user.id],
    );

    const [nIsi, nBahasa, nTsp, nPenguasaan, nPenunjang] = parsedNilai;
    const totalNilai =
      nIsi * BOBOT.isi +
      nBahasa * BOBOT.bahasa +
      nTsp * BOBOT.tsp +
      nPenguasaan * BOBOT.penguasaan +
      nPenunjang * BOBOT.penunjang;

    const tanggalFormatted = sidang.tanggal_sidang
      ? formatTanggal(new Date(sidang.tanggal_sidang))
      : "";

    const ujianKeNum = sidang.ujian_ke ?? 1;
    const UJIAN_KE_LABEL = [
      "",
      "Pertama",
      "Kedua",
      "Ketiga",
      "Keempat",
      "Kelima",
    ];
    const ujianKeStr = `${ujianKeNum} (${UJIAN_KE_LABEL[ujianKeNum] ?? ujianKeNum})`;

    const participantNama =
      role === "PEMBIMBING_1"
        ? sidang.pembimbing1_nama
        : role === "PEMBIMBING_2"
          ? sidang.pembimbing2_nama
          : role === "PENGUJI_1"
            ? sidang.penguji1_nama
            : sidang.penguji2_nama;

    const templatePath = path.join(
      __dirname,
      "../templates/template_komponen_penilaian.docx",
    );
    const templateBuffer = await readFile(templatePath);
    const outputBuffer = await patchDocument({
      outputType: "nodebuffer",
      data: templateBuffer,
      patches: {
        nama_mahasiswa: textPatch(sidang.nama_mahasiswa),
        npm: textPatch(sidang.npm),
        prodi: textPatch(sidang.program_studi_nama),
        ujian_ke: textPatch(ujianKeStr),
        tanggal_sidang: textPatch(tanggalFormatted),
        judul_skripsi: textPatch(sidang.judul_skripsi),
        bobot_isi: textPatch(`${BOBOT.isi * 100}%`),
        bobot_bahasa: textPatch(`${BOBOT.bahasa * 100}%`),
        bobot_tsp: textPatch(`${BOBOT.tsp * 100}%`),
        bobot_penguasaan: textPatch(`${BOBOT.penguasaan * 100}%`),
        bobot_penunjang: textPatch(`${BOBOT.penunjang * 100}%`),
        nilai_isi: textPatch(nIsi),
        keterangan_isi: textPatch(keteranganIsi ?? ""),
        nilai_bahasa: textPatch(nBahasa),
        keterangan_bahasa: textPatch(keteranganBahasa ?? ""),
        nilai_tsp: textPatch(nTsp),
        keterangan_tsp: textPatch(keteranganTsp ?? ""),
        nilai_penguasaan: textPatch(nPenguasaan),
        keterangan_penguasaan: textPatch(keteranganPenguasaan ?? ""),
        nilai_penunjang: textPatch(nPenunjang),
        keterangan_penunjang: textPatch(keteranganPenunjang ?? ""),
        total_nilai: textPatch(totalNilai.toFixed(2)),
        role: textPatch(ROLE_LABEL[role]),
        ttd_penguji_or_pembimbing: signaturePatch(sigRow?.signature_image),
        nama_penguji_or_pembimbing: textPatch(participantNama),
      },
    });
    const fileBase64 = outputBuffer.toString("base64");
    const fileName = `Penilaian_${role}_${sidang.npm}.docx`;

    await conn.query(
      `UPDATE sidang_penilaian
       SET nilai_isi = ?, keterangan_isi = ?,
           nilai_bahasa = ?, keterangan_bahasa = ?,
           nilai_tsp = ?, keterangan_tsp = ?,
           nilai_penguasaan = ?, keterangan_penguasaan = ?,
           nilai_penunjang = ?, keterangan_penunjang = ?,
           total_nilai = ?,
           file_content = ?, file_name = ?, submitted_at = NOW(), updated_at = NOW()
       WHERE sidang_id = ? AND role = ?`,
      [
        nIsi,
        keteranganIsi ?? null,
        nBahasa,
        keteranganBahasa ?? null,
        nTsp,
        keteranganTsp ?? null,
        nPenguasaan,
        keteranganPenguasaan ?? null,
        nPenunjang,
        keteranganPenunjang ?? null,
        totalNilai,
        fileBase64,
        fileName,
        sidang.id,
        role,
      ],
    );

    await conn.commit();
    txStarted = false;

    return res.json({ ok: true, message: "Penilaian berhasil disimpan" });
  } catch (err) {
    try {
      if (txStarted) await conn.rollback();
    } catch (_) {}
    next(err);
  } finally {
    conn.release();
  }
};

// POST /sidang/:skripsiId/hasil-penilaian
exports.submitHasilPenilaian = async (req, res, next) => {
  const conn = await db.getConnection();
  let txStarted = false;
  try {
    const skripsiId = Number(req.params.skripsiId);
    if (!Number.isFinite(skripsiId) || skripsiId <= 0) {
      return res
        .status(400)
        .json({ ok: false, message: "Invalid skripsiId" });
    }

    const nidn = await getLecturerNidn(req.user.id);
    if (!nidn) {
      return res.status(403).json({
        ok: false,
        message: "Hanya dosen yang dapat mengisi hasil penilaian",
      });
    }

    const { hasilSidang, catatanPenguji } = req.body;
    if (!hasilSidang) {
      return res
        .status(400)
        .json({ ok: false, message: "hasilSidang wajib diisi" });
    }
    if (!["LULUS", "TIDAK_LULUS", "GAGAL"].includes(hasilSidang)) {
      return res.status(400).json({
        ok: false,
        message: "hasilSidang harus LULUS, TIDAK_LULUS, atau GAGAL",
      });
    }

    await conn.beginTransaction();
    txStarted = true;

    const sidang = await getSidangBySkripsiId(conn, skripsiId);
    if (!sidang) {
      await conn.rollback();
      txStarted = false;
      return res
        .status(404)
        .json({ ok: false, message: "Sidang tidak ditemukan" });
    }
    if (sidang.status === "SCHEDULED") {
      await conn.rollback();
      txStarted = false;
      return res
        .status(409)
        .json({ ok: false, message: "Sidang belum dimulai" });
    }
    if (sidang.status === "COMPLETED") {
      await conn.rollback();
      txStarted = false;
      return res
        .status(409)
        .json({ ok: false, message: "Sidang sudah selesai" });
    }

    const role = resolveSidangRole(sidang, nidn);
    if (role !== "PEMBIMBING_1") {
      await conn.rollback();
      txStarted = false;
      return res.status(403).json({
        ok: false,
        message: "Hanya Pembimbing 1 yang dapat mengisi hasil penilaian akhir",
      });
    }

    // Gate: all 4 penilaian must be submitted
    const [penilaianRows] = await conn.query(
      `SELECT role, total_nilai, submitted_at FROM sidang_penilaian WHERE sidang_id = ?`,
      [sidang.id],
    );
    const unsubmitted = penilaianRows.filter((r) => !r.submitted_at);
    if (unsubmitted.length > 0) {
      await conn.rollback();
      txStarted = false;
      return res.status(400).json({
        ok: false,
        message: `Penilaian belum lengkap. Belum disubmit: ${unsubmitted.map((r) => r.role).join(", ")}`,
      });
    }

    const byRole = {};
    for (const row of penilaianRows)
      byRole[row.role] = Number(row.total_nilai ?? 0);

    const nilaiP1 = byRole["PEMBIMBING_1"] ?? 0;
    const nilaiP2 = byRole["PEMBIMBING_2"] ?? 0;
    const nilaiPg1 = byRole["PENGUJI_1"] ?? 0;
    const nilaiPg2 = byRole["PENGUJI_2"] ?? 0;
    const totalNilai = nilaiP1 + nilaiP2 + nilaiPg1 + nilaiPg2;
    const rata = totalNilai / 4;
    const grade = computeGrade(rata);

    // Signature for Pembimbing 1
    const [[sigRow]] = await conn.query(
      `SELECT signature_image FROM users WHERE id = ? LIMIT 1`,
      [req.user.id],
    );

    const tanggalFormatted = sidang.tanggal_sidang
      ? formatTanggal(new Date(sidang.tanggal_sidang))
      : "";

    const ujianKeNum = sidang.ujian_ke ?? 1;
    const UJIAN_KE_LABEL = [
      "",
      "Pertama",
      "Kedua",
      "Ketiga",
      "Keempat",
      "Kelima",
    ];
    const ujianKeStr = `${ujianKeNum} (${UJIAN_KE_LABEL[ujianKeNum] ?? ujianKeNum})`;

    // Generate Hasil Penilaian Akhir DOCX
    const hasilTemplatePath = path.join(
      __dirname,
      "../templates/template_hasil_penilaian_akhir_ujian_skripsi.docx",
    );
    const hasilTemplateBuffer = await readFile(hasilTemplatePath);
    const hasilBuffer = await patchDocument({
      outputType: "nodebuffer",
      data: hasilTemplateBuffer,
      patches: {
        nama_mahasiswa: textPatch(sidang.nama_mahasiswa),
        npm: textPatch(sidang.npm),
        prodi: textPatch(sidang.program_studi_nama),
        judul_skripsi: textPatch(sidang.judul_skripsi),
        ujian_ke: textPatch(ujianKeStr),
        nama_pembimbing1: textPatch(sidang.pembimbing1_nama),
        nama_pembimbing2: textPatch(sidang.pembimbing2_nama),
        nama_penguji1: textPatch(sidang.penguji1_nama),
        nama_penguji2: textPatch(sidang.penguji2_nama),
        nilai_pembimbing1: textPatch(nilaiP1.toFixed(2)),
        nilai_pembimbing2: textPatch(nilaiP2.toFixed(2)),
        nilai_penguji1: textPatch(nilaiPg1.toFixed(2)),
        nilai_penguji2: textPatch(nilaiPg2.toFixed(2)),
        total_nilai: textPatch(totalNilai.toFixed(2)),
        rata: textPatch(rata.toFixed(2)),
        grade: textPatch(grade),
        tanggal: textPatch(tanggalFormatted),
        ttd_pembimbing1: signaturePatch(sigRow?.signature_image),
      },
    });
    const hasilBase64 = hasilBuffer.toString("base64");

    // Upsert sidang_hasil_penilaian
    await conn.query(
      `UPDATE sidang_hasil_penilaian
       SET nilai_pembimbing1 = ?, nilai_pembimbing2 = ?, nilai_penguji1 = ?, nilai_penguji2 = ?,
           total_nilai = ?, rata = ?, grade = ?, hasil_sidang = ?, catatan_penguji = ?,
           file_content = ?, file_name = ?, submitted_at = NOW(), updated_at = NOW()
       WHERE sidang_id = ?`,
      [
        nilaiP1,
        nilaiP2,
        nilaiPg1,
        nilaiPg2,
        totalNilai,
        rata,
        grade,
        hasilSidang,
        catatanPenguji ?? null,
        hasilBase64,
        `Hasil_Penilaian_Akhir_${sidang.npm}.docx`,
        sidang.id,
      ],
    );

    // sync'd copy of sidang_hasil_penilaian.hasil_sidang — written together in one transaction
    await conn.query(
      `UPDATE sidang SET hasil_sidang = ?, catatan_penguji = ?, updated_at = NOW() WHERE id = ?`,
      [hasilSidang, catatanPenguji ?? null, sidang.id],
    );

    // Generate notulen DOCXs now that hasil_sidang is authoritative
    await generateAndStoreNotulen(conn, sidang, hasilSidang);

    // Generate Berita Acara
    await generateAndStoreBeritaAcara(conn, sidang, {
      hasilSidang,
      catatanPenguji: catatanPenguji ?? "",
      nilaiUjian: rata,
      penilaianRows,
    });

    // Mark sidang as COMPLETED
    await conn.query(
      `UPDATE sidang SET status = 'COMPLETED', completed_at = NOW(), updated_at = NOW() WHERE id = ?`,
      [sidang.id],
    );

    // GAGAL: plagiarism detected — invalidate skripsi, no revision phase
    if (hasilSidang === "GAGAL") {
      await conn.query(
        `UPDATE skripsi SET status = 'GAGAL', updated_at = NOW() WHERE id = (SELECT skripsi_id FROM sidang WHERE id = ?)`,
        [sidang.id],
      );
      const [[studentUserRow]] = await conn.query(
        `SELECT u.id FROM users u WHERE u.npm = ? AND u.is_active = 1 LIMIT 1`,
        [sidang.npm],
      );
      if (studentUserRow) {
        await insertNotification(
          conn,
          studentUserRow.id,
          "SIDANG_GAGAL",
          "Skripsi Anda dinyatakan GAGAL karena terindikasi plagiat. Anda dapat mengulang dari awal pada semester berikutnya.",
          `/sidang/${skripsiId}`,
        );
      }
      await conn.commit();
      txStarted = false;
      return res.json({
        ok: true,
        message: "Hasil penilaian akhir berhasil disimpan. Sidang selesai.",
      });
    }

    // Detect re-exam: a prior sidang exists for this student (ujian_ke >= 2)
    const [[priorSidang]] = await conn.query(
      `SELECT id FROM sidang WHERE skripsi_id = ? AND id != ? LIMIT 1`,
      [skripsiId, sidang.id],
    );
    const isUjianUlang = !!priorSidang;

    if (isUjianUlang && hasilSidang === "LULUS") {
      // Re-exam passed: reset revisi_pasca_sidang so student goes through revisi again
      const [[existingRevisi]] = await conn.query(
        `SELECT id FROM revisi_pasca_sidang WHERE sidang_id = ? LIMIT 1`,
        [sidang.id],
      );
      if (existingRevisi) {
        const [stageRows] = await conn.query(
          `SELECT id FROM revisi_pasca_sidang_stages WHERE revisi_id = ?`,
          [existingRevisi.id],
        );
        const stageIds = stageRows.map((r) => r.id);
        if (stageIds.length > 0) {
          await conn.query(
            `DELETE FROM revisi_pasca_sidang_reviews WHERE stage_id IN (?)`,
            [stageIds],
          );
          await conn.query(
            `DELETE FROM revisi_pasca_sidang_submissions WHERE stage_id IN (?)`,
            [stageIds],
          );
          await conn.query(
            `DELETE FROM revisi_pasca_sidang_stages WHERE revisi_id = ?`,
            [existingRevisi.id],
          );
        }
        await conn.query(
          `DELETE FROM revisi_pasca_sidang_files WHERE revisi_id = ?`,
          [existingRevisi.id],
        );
        await conn.query(
          `UPDATE revisi_pasca_sidang SET sidang_id = ?, is_completed = 0, updated_at = NOW() WHERE id = ?`,
          [sidang.id, existingRevisi.id],
        );
        const pg2UserId = await resolveUserId(conn, sidang.penguji2_nidn);
        await conn.query(
          `INSERT INTO revisi_pasca_sidang_stages (revisi_id, signer_role, user_id)
           VALUES (?, 'PENGUJI_2', ?)`,
          [existingRevisi.id, pg2UserId],
        );
      }
    }

    // Auto-init revisi pasca sidang for original sidang (existence-guarded; re-exam resets above handle it)
    if (!isUjianUlang) {
      const [[existingRevisi]] = await conn.query(
        `SELECT id FROM revisi_pasca_sidang WHERE sidang_id = ? LIMIT 1`,
        [sidang.id],
      );
      if (!existingRevisi) {
        await conn.query(
          `INSERT INTO revisi_pasca_sidang (sidang_id) VALUES (?)`,
          [sidang.id],
        );
      }
    }

    await conn.commit();
    txStarted = false;

    return res.json({
      ok: true,
      message: "Hasil penilaian akhir berhasil disimpan. Sidang selesai.",
    });
  } catch (err) {
    try {
      if (txStarted) await conn.rollback();
    } catch (_) {}
    next(err);
  } finally {
    conn.release();
  }
};

async function generateAndStoreNotulen(conn, sidang, hasilSidang) {
  try {
    const [notulenRows] = await conn.query(
      `SELECT role, note FROM sidang_notulen WHERE sidang_id = ? AND submitted_at IS NOT NULL`,
      [sidang.id],
    );
    if (notulenRows.length === 0) return;

    const templatePath = path.join(
      __dirname,
      "../templates/template_notulen_penguji.docx",
    );
    const templateBuffer = await readFile(templatePath);
    const tanggalFormatted = sidang.tanggal_sidang
      ? formatTanggal(new Date(sidang.tanggal_sidang))
      : "";

    for (const row of notulenRows) {
      const role = row.role;
      const outputBuffer = await patchDocument({
        outputType: "nodebuffer",
        data: templateBuffer,
        patches: {
          npm: textPatch(sidang.npm),
          nama_mahasiswa: textPatch(sidang.nama_mahasiswa),
          prodi: textPatch(sidang.program_studi_nama),
          judul_skripsi: textPatch(sidang.judul_skripsi),
          nama_pembimbing1: textPatch(sidang.pembimbing1_nama),
          nama_pembimbing2: textPatch(sidang.pembimbing2_nama),
          tanggal_sidang: textPatch(tanggalFormatted),
          hasil_sidang: textPatch(hasilSidang),
          role: textPatch(NOTULEN_ROLE_LABEL[role]),
          note: textPatch(row.note),
          nama_penguji: textPatch(
            role === "PENGUJI_1" ? sidang.penguji1_nama : sidang.penguji2_nama,
          ),
          ttd_penguji: signaturePatch(null),
        },
      });
      const fileBase64 = outputBuffer.toString("base64");
      await conn.query(
        `UPDATE sidang_notulen
         SET hasil_sidang = ?, file_content = ?, file_name = ?, updated_at = NOW()
         WHERE sidang_id = ? AND role = ?`,
        [hasilSidang, fileBase64, `Notulen_${role}_${sidang.npm}.docx`, sidang.id, role],
      );
    }
  } catch (err) {
    console.error("generateAndStoreNotulen error (non-fatal):", err);
  }
}

async function generateAndStoreBeritaAcara(
  conn,
  sidang,
  { hasilSidang, catatanPenguji, nilaiUjian },
) {
  const tanggalSidangDate = sidang.tanggal_sidang
    ? new Date(sidang.tanggal_sidang)
    : new Date();
  const hariStr = formatHari(tanggalSidangDate);
  const tanggalStr = formatTanggal(tanggalSidangDate);
  const waktuStr = sidang.waktu_sidang
    ? String(sidang.waktu_sidang).substring(0, 5)
    : "";

  const ujianKeNum = sidang.ujian_ke ?? 1;
  const UJIAN_KE_LABEL = [
    "",
    "Pertama",
    "Kedua",
    "Ketiga",
    "Keempat",
    "Kelima",
  ];
  const ujianKeStr = `${ujianKeNum} (${UJIAN_KE_LABEL[ujianKeNum] ?? ujianKeNum})`;

  // Get signatures for all 4 participants via nidn lookup
  async function getSig(nidn) {
    if (!nidn) return null;
    const [[row]] = await conn.query(
      `SELECT signature_image FROM users WHERE nidn = ? AND is_active = 1 ORDER BY id ASC LIMIT 1`,
      [nidn],
    );
    return row?.signature_image ?? null;
  }

  const [sig1, sig2, sigPg1, sigPg2] = await Promise.all([
    getSig(sidang.pembimbing1_nidn),
    getSig(sidang.pembimbing2_nidn),
    getSig(sidang.penguji1_nidn),
    getSig(sidang.penguji2_nidn),
  ]);

  const templatePath = path.join(
    __dirname,
    "../templates/template_berita_acara_hasil_ujian.docx",
  );
  const templateBuffer = await readFile(templatePath);
  const outputBuffer = await patchDocument({
    outputType: "nodebuffer",
    data: templateBuffer,
    patches: {
      hari: textPatch(hariStr),
      tanggal: textPatch(tanggalStr),
      waktu: textPatch(waktuStr),
      nama_mahasiswa: textPatch(sidang.nama_mahasiswa),
      npm: textPatch(sidang.npm),
      prodi: textPatch(sidang.program_studi_nama),
      judul_skripsi: textPatch(sidang.judul_skripsi),
      ujian_ke: textPatch(ujianKeStr),
      nilai_ujian: textPatch(Number(nilaiUjian).toFixed(2)),
      status_sidang: textPatch(hasilSidang),
      catatan_penguji: textPatch(catatanPenguji ?? ""),
      nama_pembimbing1: textPatch(sidang.pembimbing1_nama),
      nama_pembimbing2: textPatch(sidang.pembimbing2_nama),
      nama_penguji1: textPatch(sidang.penguji1_nama),
      nama_penguji2: textPatch(sidang.penguji2_nama),
      ttd_pembimbing1: signaturePatch(sig1),
      ttd_pembimbing2: signaturePatch(sig2),
      ttd_penguji1: signaturePatch(sigPg1),
      ttd_penguji2: signaturePatch(sigPg2),
    },
  });
  const fileBase64 = outputBuffer.toString("base64");
  const fileName = `Berita_Acara_${sidang.npm}.docx`;

  await conn.query(
    `DELETE FROM sidang_files WHERE sidang_id = ?`,
    [sidang.id],
  );
  await conn.query(
    `INSERT INTO sidang_files (sidang_id, file_name, file_content) VALUES (?, ?, ?)`,
    [sidang.id, fileName, fileBase64],
  );
}

const VALID_SIDANG_STATUSES = ["SCHEDULED", "ONGOING", "COMPLETED"];

// GET /lecturer/sidang
exports.getLecturerSidang = async (req, res, next) => {
  try {
    if (req.user.userType !== "LECTURER") {
      return res.status(403).json({
        ok: false,
        message: "Only lecturers can access this endpoint",
      });
    }
    const nidn = await getLecturerNidn(req.user.id);
    if (!nidn)
      return res.status(400).json({ ok: false, message: "Dosen tidak valid" });

    const { status } = req.query;
    if (status !== undefined && !VALID_SIDANG_STATUSES.includes(status)) {
      return res.status(400).json({
        ok: false,
        message: `status harus salah satu dari: ${VALID_SIDANG_STATUSES.join(", ")}`,
      });
    }

    const whereStatus = status ? `AND s.status = ?` : "";
    const params = [nidn, nidn, nidn, nidn, nidn, nidn, nidn, nidn, nidn, nidn];
    if (status) params.push(status);

    const [rows] = await db.query(
      `SELECT
        s.id,
        s.skripsi_id,
        m.npm,
        m.nama AS nama_mahasiswa,
        sk.judul AS judul_skripsi,
        s.status,
        psk_k.tanggal_sidang,
        psk_k.waktu_sidang,
        psk_k.tempat_sidang,
        s.hasil_sidang,
        shp.rata,
        shp.grade,
        CASE
          WHEN sk.pembimbing1_nidn = ? THEN 'PEMBIMBING_1'
          WHEN sk.pembimbing2_nidn = ? THEN 'PEMBIMBING_2'
          WHEN psk_k.penguji1_nidn = ? THEN 'PENGUJI_1'
          WHEN psk_k.penguji2_nidn = ? THEN 'PENGUJI_2'
        END AS caller_role,
        (sp.submitted_at IS NOT NULL) AS has_submitted_penilaian,
        (sn.submitted_at IS NOT NULL) AS has_submitted_notulen
      FROM sidang s
      JOIN skripsi sk ON sk.id = s.skripsi_id
      JOIN mahasiswa m ON m.npm = sk.npm
      LEFT JOIN pengajuan_sidang_kaprodi psk_k
             ON psk_k.pengajuan_sidang_id = s.pengajuan_sidang_id
      LEFT JOIN sidang_hasil_penilaian shp ON shp.sidang_id = s.id
      LEFT JOIN sidang_penilaian sp
        ON sp.sidang_id = s.id
        AND sp.role = CASE
          WHEN sk.pembimbing1_nidn = ? THEN 'PEMBIMBING_1'
          WHEN sk.pembimbing2_nidn = ? THEN 'PEMBIMBING_2'
          WHEN psk_k.penguji1_nidn = ? THEN 'PENGUJI_1'
          WHEN psk_k.penguji2_nidn = ? THEN 'PENGUJI_2'
        END
      LEFT JOIN sidang_notulen sn
        ON sn.sidang_id = s.id
        AND sn.role = CASE
          WHEN psk_k.penguji1_nidn = ? THEN 'PENGUJI_1'
          WHEN psk_k.penguji2_nidn = ? THEN 'PENGUJI_2'
          ELSE NULL
        END
      WHERE (
        sk.pembimbing1_nidn = ? OR sk.pembimbing2_nidn = ? OR
        psk_k.penguji1_nidn = ? OR psk_k.penguji2_nidn = ?
      )
      ${whereStatus}
      ORDER BY s.created_at DESC`,
      [...params, nidn, nidn, nidn, nidn],
    );

    return res.json({ ok: true, data: rows });
  } catch (err) {
    next(err);
  }
};

async function resolveSidangFileAccess(req, sidang) {
  if (req.user.hasRole("SEKRETARIAT") || req.user.hasRole("KAPRODI")) return true;
  if (req.user.hasRole("STUDENT")) {
    const npm = await getStudentNpm(req.user.id);
    return npm === sidang.npm;
  }
  const nidn = await getLecturerNidn(req.user.id);
  return nidn ? resolveSidangRole(sidang, nidn) !== null : false;
}

function sendDocx(res, fileRow) {
  const buffer = Buffer.from(fileRow.file_content, "base64");
  res.setHeader("Content-Type", MIME_DOCX);
  res.setHeader("Content-Disposition", `attachment; filename="${fileRow.file_name}"`);
  return res.send(buffer);
}

// GET /sidang/:skripsiId/files/berita-acara
exports.getBeritaAcara = async (req, res, next) => {
  try {
    const skripsiId = Number(req.params.skripsiId);
    if (!Number.isFinite(skripsiId) || skripsiId <= 0) {
      return res.status(400).json({ ok: false, message: "Invalid skripsiId" });
    }

    const [[sidang]] = await db.query(
      `SELECT s.id, s.skripsi_id, s.pengajuan_sidang_id, s.status,
              m.npm, sk.pembimbing1_nidn, sk.pembimbing2_nidn,
              psk_k.penguji1_nidn, psk_k.penguji2_nidn
       FROM sidang s
       JOIN skripsi sk ON sk.id = s.skripsi_id
       JOIN mahasiswa m ON m.npm = sk.npm
       LEFT JOIN pengajuan_sidang_kaprodi psk_k
              ON psk_k.pengajuan_sidang_id = s.pengajuan_sidang_id
       WHERE s.skripsi_id = ? ORDER BY s.id DESC LIMIT 1`,
      [skripsiId],
    );
    if (!sidang) {
      return res.status(404).json({ ok: false, message: "Sidang tidak ditemukan" });
    }

    if (req.user.hasRole("STUDENT")) {
      return res.status(403).json({ ok: false, message: "Forbidden" });
    }

    if (!await resolveSidangFileAccess(req, sidang)) {
      return res.status(403).json({ ok: false, message: "Forbidden" });
    }

    const [[fileRow]] = await db.query(
      `SELECT file_name, file_content FROM sidang_files WHERE sidang_id = ? LIMIT 1`,
      [sidang.id],
    );
    if (!fileRow) {
      return res.status(404).json({ ok: false, message: "Berita acara belum tersedia" });
    }

    return sendDocx(res, fileRow);
  } catch (err) {
    next(err);
  }
};

// GET /sidang/:skripsiId/files/hasil-penilaian
exports.getHasilPenilaianFile = async (req, res, next) => {
  try {
    const skripsiId = Number(req.params.skripsiId);
    if (!Number.isFinite(skripsiId) || skripsiId <= 0) {
      return res.status(400).json({ ok: false, message: "Invalid skripsiId" });
    }

    const [[sidang]] = await db.query(
      `SELECT s.id, s.skripsi_id, s.pengajuan_sidang_id, s.status,
              m.npm, sk.pembimbing1_nidn, sk.pembimbing2_nidn,
              psk_k.penguji1_nidn, psk_k.penguji2_nidn
       FROM sidang s
       JOIN skripsi sk ON sk.id = s.skripsi_id
       JOIN mahasiswa m ON m.npm = sk.npm
       LEFT JOIN pengajuan_sidang_kaprodi psk_k
              ON psk_k.pengajuan_sidang_id = s.pengajuan_sidang_id
       WHERE s.skripsi_id = ? ORDER BY s.id DESC LIMIT 1`,
      [skripsiId],
    );
    if (!sidang) {
      return res.status(404).json({ ok: false, message: "Sidang tidak ditemukan" });
    }

    if (req.user.hasRole("STUDENT")) {
      return res.status(403).json({ ok: false, message: "Forbidden" });
    }

    if (!await resolveSidangFileAccess(req, sidang)) {
      return res.status(403).json({ ok: false, message: "Forbidden" });
    }

    const [[fileRow]] = await db.query(
      `SELECT file_name, file_content FROM sidang_hasil_penilaian WHERE sidang_id = ? AND submitted_at IS NOT NULL LIMIT 1`,
      [sidang.id],
    );
    if (!fileRow) {
      return res.status(404).json({ ok: false, message: "Hasil penilaian belum tersedia" });
    }

    return sendDocx(res, fileRow);
  } catch (err) {
    next(err);
  }
};

const VALID_PENILAIAN_ROLES = ["PEMBIMBING_1", "PEMBIMBING_2", "PENGUJI_1", "PENGUJI_2"];
const VALID_NOTULEN_ROLES = ["PENGUJI_1", "PENGUJI_2"];

// GET /sidang/:skripsiId/files/penilaian/:role
exports.getPenilaianFile = async (req, res, next) => {
  try {
    const skripsiId = Number(req.params.skripsiId);
    if (!Number.isFinite(skripsiId) || skripsiId <= 0) {
      return res.status(400).json({ ok: false, message: "Invalid skripsiId" });
    }

    const role = req.params.role;
    if (!VALID_PENILAIAN_ROLES.includes(role)) {
      return res.status(400).json({
        ok: false,
        message: `role harus salah satu dari: ${VALID_PENILAIAN_ROLES.join(", ")}`,
      });
    }

    const [[sidang]] = await db.query(
      `SELECT s.id, s.skripsi_id, s.pengajuan_sidang_id, s.status,
              m.npm, sk.pembimbing1_nidn, sk.pembimbing2_nidn,
              psk_k.penguji1_nidn, psk_k.penguji2_nidn
       FROM sidang s
       JOIN skripsi sk ON sk.id = s.skripsi_id
       JOIN mahasiswa m ON m.npm = sk.npm
       LEFT JOIN pengajuan_sidang_kaprodi psk_k
              ON psk_k.pengajuan_sidang_id = s.pengajuan_sidang_id
       WHERE s.skripsi_id = ? ORDER BY s.id DESC LIMIT 1`,
      [skripsiId],
    );
    if (!sidang) {
      return res.status(404).json({ ok: false, message: "Sidang tidak ditemukan" });
    }

    if (req.user.hasRole("STUDENT")) {
      return res.status(403).json({ ok: false, message: "Forbidden" });
    }

    if (!await resolveSidangFileAccess(req, sidang)) {
      return res.status(403).json({ ok: false, message: "Forbidden" });
    }

    const [[fileRow]] = await db.query(
      `SELECT file_name, file_content FROM sidang_penilaian WHERE sidang_id = ? AND role = ? AND submitted_at IS NOT NULL LIMIT 1`,
      [sidang.id, role],
    );
    if (!fileRow) {
      return res.status(404).json({ ok: false, message: "Formulir penilaian belum tersedia" });
    }

    return sendDocx(res, fileRow);
  } catch (err) {
    next(err);
  }
};

// GET /sidang/:skripsiId/files/notulen/:role
exports.getNotulenFile = async (req, res, next) => {
  try {
    const skripsiId = Number(req.params.skripsiId);
    if (!Number.isFinite(skripsiId) || skripsiId <= 0) {
      return res.status(400).json({ ok: false, message: "Invalid skripsiId" });
    }

    const role = req.params.role;
    if (!VALID_NOTULEN_ROLES.includes(role)) {
      return res.status(400).json({
        ok: false,
        message: `role harus salah satu dari: ${VALID_NOTULEN_ROLES.join(", ")}`,
      });
    }

    const [[sidang]] = await db.query(
      `SELECT s.id, s.skripsi_id, s.pengajuan_sidang_id, s.status,
              m.npm, sk.pembimbing1_nidn, sk.pembimbing2_nidn,
              psk_k.penguji1_nidn, psk_k.penguji2_nidn
       FROM sidang s
       JOIN skripsi sk ON sk.id = s.skripsi_id
       JOIN mahasiswa m ON m.npm = sk.npm
       LEFT JOIN pengajuan_sidang_kaprodi psk_k
              ON psk_k.pengajuan_sidang_id = s.pengajuan_sidang_id
       WHERE s.skripsi_id = ? ORDER BY s.id DESC LIMIT 1`,
      [skripsiId],
    );
    if (!sidang) {
      return res.status(404).json({ ok: false, message: "Sidang tidak ditemukan" });
    }

    if (!await resolveSidangFileAccess(req, sidang)) {
      return res.status(403).json({ ok: false, message: "Forbidden" });
    }

    const [[fileRow]] = await db.query(
      `SELECT file_name, file_content FROM sidang_notulen WHERE sidang_id = ? AND role = ? AND submitted_at IS NOT NULL LIMIT 1`,
      [sidang.id, role],
    );
    if (!fileRow) {
      return res.status(404).json({ ok: false, message: "Notulen belum tersedia" });
    }

    return sendDocx(res, fileRow);
  } catch (err) {
    next(err);
  }
};

// GET /sekretariat/sidang
exports.getSekretariatSidang = async (req, res, next) => {
  try {
    if (!req.user.hasRole("SEKRETARIAT")) {
      return res.status(403).json({ ok: false, message: "Forbidden" });
    }

    const { status, programStudiId } = req.query;
    if (status !== undefined && !VALID_SIDANG_STATUSES.includes(status)) {
      return res.status(400).json({
        ok: false,
        message: `status harus salah satu dari: ${VALID_SIDANG_STATUSES.join(", ")}`,
      });
    }

    const parsedProgramStudiId = programStudiId ? Number(programStudiId) : null;
    if (programStudiId !== undefined && (!Number.isFinite(parsedProgramStudiId) || parsedProgramStudiId <= 0)) {
      return res.status(400).json({ ok: false, message: "Invalid programStudiId" });
    }

    const [rows] = await db.query(
      `SELECT
         s.id, s.skripsi_id, s.nomor_surat,
         m.npm, m.nama AS nama_mahasiswa,
         prog.id   AS program_studi_id,
         prog.nama AS program_studi_nama,
         sk.judul  AS judul_skripsi,
         ps.ujian_ke,
         s.status, psk_k.tanggal_sidang, psk_k.waktu_sidang, psk_k.tempat_sidang,
         sk.pembimbing1_nidn, d1.nama   AS pembimbing1_nama,
         sk.pembimbing2_nidn, d2.nama   AS pembimbing2_nama,
         psk_k.penguji1_nidn, d_pg1.nama AS penguji1_nama,
         psk_k.penguji2_nidn, d_pg2.nama AS penguji2_nama,
         s.hasil_sidang, s.created_at,
         shp.rata, shp.grade
       FROM sidang s
       JOIN skripsi sk ON sk.id = s.skripsi_id
       JOIN mahasiswa m ON m.npm = sk.npm
       JOIN program_studi prog ON prog.id = sk.program_studi_id
       LEFT JOIN dosen d1 ON d1.nidn = sk.pembimbing1_nidn
       LEFT JOIN dosen d2 ON d2.nidn = sk.pembimbing2_nidn
       LEFT JOIN pengajuan_sidang_kaprodi psk_k
              ON psk_k.pengajuan_sidang_id = s.pengajuan_sidang_id
       LEFT JOIN dosen d_pg1 ON d_pg1.nidn = psk_k.penguji1_nidn
       LEFT JOIN dosen d_pg2 ON d_pg2.nidn = psk_k.penguji2_nidn
       LEFT JOIN pengajuan_sidang ps ON ps.id = s.pengajuan_sidang_id
       LEFT JOIN sidang_hasil_penilaian shp ON shp.sidang_id = s.id
       WHERE (? IS NULL OR s.status = ?)
         AND (? IS NULL OR prog.id = ?)
       ORDER BY s.created_at DESC`,
      [status ?? null, status ?? null, parsedProgramStudiId, parsedProgramStudiId],
    );

    return res.json({ ok: true, data: rows });
  } catch (err) {
    next(err);
  }
};
