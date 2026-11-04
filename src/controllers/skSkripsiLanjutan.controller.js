const db = require("../db");
const { insertNotification } = require("../utils/notify");
const {
  getStudentNpm,
  getLecturerNidn,
  getStaffUsrId,
  getKaprodiProgramStudiIds,
  isKaprodiOfProgramStudi,
} = require("../utils/identity");
const { assertSignatures, getStaffSignature } = require("../utils/signature");
const { formatTanggal } = require("../utils/dates");
const { JENIS } = require("../services/sidangScope.service");
const { nextNomorSk } = require("../services/skNumber.service");
const {
  generateSuratKeputusanSkripsiFTI,
} = require("../services/generateSuratKeputusanSkripsiFTI.js");

// Seminar Bisnis Digital → Skripsi bridge (pengajuan_sk_skripsi_lanjutan):
// WAITING_KAPRODI → (Kaprodi forwards) → WAITING_SEKRETARIAT → (Sekretariat issues SK Skripsi) → COMPLETED.
// Neither step can reject or send back.

const VALID_STATUSES = ["WAITING_KAPRODI", "WAITING_SEKRETARIAT", "COMPLETED"];

const LIST_SELECT = `
  SELECT
    l.id, l.skripsi_id, l.status, l.judul_seminar, l.judul_skripsi, l.nomor_surat,
    l.forwarded_at, l.completed_at, l.created_at,
    sk.npm, m.nama AS nama_mahasiswa, sk.program_studi_id, ps.nama AS program_studi_nama,
    d1.nama AS pembimbing1_nama, d2.nama AS pembimbing2_nama,
    sd.hasil_sidang AS hasil_seminar, shp.rata AS rata_seminar, shp.grade AS grade_seminar
  FROM pengajuan_sk_skripsi_lanjutan l
  JOIN skripsi sk ON sk.id = l.skripsi_id
  JOIN mahasiswa m ON m.npm = sk.npm
  JOIN program_studi ps ON ps.id = sk.program_studi_id
  JOIN sidang sd ON sd.id = l.seminar_sidang_id
  LEFT JOIN sidang_hasil_penilaian shp ON shp.sidang_id = sd.id
  LEFT JOIN dosen d1 ON d1.nidn = sk.pembimbing1_nidn
  LEFT JOIN dosen d2 ON d2.nidn = sk.pembimbing2_nidn`;

function parseStatus(raw) {
  if (raw === undefined || raw === "") return null;
  return VALID_STATUSES.includes(raw) ? raw : undefined;
}

function parseSkripsiId(req) {
  const id = Number(req.params.skripsiId);
  return Number.isFinite(id) && id > 0 ? id : null;
}

async function getKaprodiUserProdiIds(userId) {
  const staffUsrId = await getStaffUsrId(userId);
  return staffUsrId ? getKaprodiProgramStudiIds(staffUsrId) : [];
}

// Owner student, the Kaprodi of the prodi, Sekretariat; for the SK file also the Dekan and both pembimbing.
async function canRead(req, row, { includeSkReaders = false } = {}) {
  if (req.user.hasRole("SEKRETARIAT")) return true;
  if (req.user.hasRole("STUDENT")) {
    return (await getStudentNpm(req.user.id)) === row.npm;
  }
  if (
    req.user.hasRole("KAPRODI") &&
    (await isKaprodiOfProgramStudi(req.user.id, row.program_studi_id))
  ) {
    return true;
  }
  if (!includeSkReaders) return false;
  if (req.user.hasRole("DEKAN")) return true;
  const nidn = await getLecturerNidn(req.user.id);
  return (
    !!nidn && (nidn === row.pembimbing1_nidn || nidn === row.pembimbing2_nidn)
  );
}

// GET /kaprodi/sk-skripsi-lanjutan?status=
exports.listForKaprodi = async (req, res, next) => {
  try {
    if (!req.user.hasRole("KAPRODI")) {
      return res.status(403).json({ ok: false, message: "Forbidden" });
    }
    const status = parseStatus(req.query?.status);
    if (status === undefined) {
      return res.status(400).json({
        ok: false,
        message: `status harus salah satu dari: ${VALID_STATUSES.join(", ")}`,
      });
    }
    const prodiIds = await getKaprodiUserProdiIds(req.user.id);
    if (!prodiIds.length) {
      return res.status(403).json({
        ok: false,
        message: "Anda tidak terdaftar sebagai Kaprodi program studi mana pun",
      });
    }
    const [rows] = await db.query(
      `${LIST_SELECT}
       WHERE sk.program_studi_id IN (?) ${status ? "AND l.status = ?" : ""}
       ORDER BY l.created_at DESC`,
      status ? [prodiIds, status] : [prodiIds],
    );
    return res.json({ ok: true, data: rows });
  } catch (err) {
    next(err);
  }
};

// GET /sekretariat/sk-skripsi-lanjutan?status=
exports.listForSekretariat = async (req, res, next) => {
  try {
    if (!req.user.hasRole("SEKRETARIAT")) {
      return res.status(403).json({ ok: false, message: "Forbidden" });
    }
    const status = parseStatus(req.query?.status);
    if (status === undefined) {
      return res.status(400).json({
        ok: false,
        message: `status harus salah satu dari: ${VALID_STATUSES.join(", ")}`,
      });
    }
    // Requests still with Kaprodi are not Sekretariat's to act on.
    const [rows] = await db.query(
      `${LIST_SELECT}
       WHERE ${status ? "l.status = ?" : "l.status <> 'WAITING_KAPRODI'"}
       ORDER BY COALESCE(l.forwarded_at, l.created_at) DESC`,
      status ? [status] : [],
    );
    return res.json({ ok: true, data: rows });
  } catch (err) {
    next(err);
  }
};

// GET /sk-skripsi-lanjutan/:skripsiId — read-only detail. The Halaman Pengesahan Seminar and the final
// revisi file are downloaded through the revisi endpoints.
exports.getDetail = async (req, res, next) => {
  try {
    const skripsiId = parseSkripsiId(req);
    if (!skripsiId) {
      return res.status(400).json({ ok: false, message: "Invalid skripsiId" });
    }
    const [[row]] = await db.query(
      `${LIST_SELECT}
       WHERE l.skripsi_id = ? LIMIT 1`,
      [skripsiId],
    );
    if (!row) {
      return res
        .status(404)
        .json({ ok: false, message: "Pengajuan SK Skripsi tidak ditemukan" });
    }
    if (!(await canRead(req, row))) {
      return res.status(403).json({ ok: false, message: "Forbidden" });
    }
    const [[halaman]] = await db.query(
      `SELECT rf.id FROM revisi_pasca_sidang rps
       JOIN revisi_pasca_sidang_files rf
         ON rf.revisi_id = rps.id AND rf.file_type = 'HALAMAN_PENGESAHAN_SEMINAR_BD'
       JOIN pengajuan_sk_skripsi_lanjutan l ON l.seminar_sidang_id = rps.sidang_id
       WHERE l.skripsi_id = ? LIMIT 1`,
      [skripsiId],
    );
    return res.json({
      ok: true,
      data: {
        ...row,
        judul_berubah: row.judul_skripsi !== row.judul_seminar,
        has_halaman_pengesahan_seminar: !!halaman,
        has_sk_skripsi: row.status === "COMPLETED",
      },
    });
  } catch (err) {
    next(err);
  }
};

// POST /sk-skripsi-lanjutan/:skripsiId/forward — Kaprodi's only action.
exports.forward = async (req, res, next) => {
  const conn = await db.getConnection();
  let txStarted = false;
  try {
    if (!req.user.hasRole("KAPRODI")) {
      return res.status(403).json({ ok: false, message: "Forbidden" });
    }
    const skripsiId = parseSkripsiId(req);
    if (!skripsiId) {
      return res.status(400).json({ ok: false, message: "Invalid skripsiId" });
    }
    const prodiIds = await getKaprodiUserProdiIds(req.user.id);

    await conn.beginTransaction();
    txStarted = true;

    const [[row]] = await conn.query(
      `SELECT l.id, l.status, sk.program_studi_id, sk.npm, m.nama AS nama_mahasiswa
       FROM pengajuan_sk_skripsi_lanjutan l
       JOIN skripsi sk ON sk.id = l.skripsi_id
       JOIN mahasiswa m ON m.npm = sk.npm
       WHERE l.skripsi_id = ? LIMIT 1 FOR UPDATE`,
      [skripsiId],
    );
    if (!row) {
      await conn.rollback();
      txStarted = false;
      return res
        .status(404)
        .json({ ok: false, message: "Pengajuan SK Skripsi tidak ditemukan" });
    }
    if (!prodiIds.includes(Number(row.program_studi_id))) {
      await conn.rollback();
      txStarted = false;
      return res.status(403).json({ ok: false, message: "Forbidden" });
    }
    if (row.status !== "WAITING_KAPRODI") {
      await conn.rollback();
      txStarted = false;
      return res
        .status(409)
        .json({ ok: false, message: "Pengajuan ini sudah diteruskan" });
    }

    await conn.query(
      `UPDATE pengajuan_sk_skripsi_lanjutan
       SET status = 'WAITING_SEKRETARIAT', forwarded_by_user_id = ?, forwarded_at = NOW()
       WHERE id = ?`,
      [req.user.id, row.id],
    );

    const [sekRows] = await conn.query(
      `SELECT u.id FROM users u
       JOIN user_roles ur ON ur.user_id = u.id AND ur.is_active = 1
       JOIN roles r ON r.id = ur.role_id
       WHERE r.code = 'SEKRETARIAT' AND u.is_active = 1`,
    );
    for (const sek of sekRows) {
      await insertNotification(
        conn,
        sek.id,
        "SK_SKRIPSI_LANJUTAN_WAITING_SEKRETARIAT",
        `Kaprodi meneruskan permohonan SK Skripsi mahasiswa ${row.nama_mahasiswa}.`,
        `/sekretariat/sk-skripsi-lanjutan/${skripsiId}`,
      );
    }
    const [[studentRow]] = await conn.query(
      `SELECT id FROM users WHERE npm = ? AND is_active = 1 LIMIT 1`,
      [row.npm],
    );
    if (studentRow) {
      await insertNotification(
        conn,
        studentRow.id,
        "SK_SKRIPSI_LANJUTAN_FORWARDED",
        "Kaprodi telah meneruskan permohonan SK Skripsi Anda ke Sekretariat.",
        "/student/skripsi-consultations",
      );
    }

    await conn.commit();
    txStarted = false;
    return res.json({ ok: true, message: "Diteruskan ke Sekretariat" });
  } catch (err) {
    try {
      if (txStarted) await conn.rollback();
    } catch (_) {}
    next(err);
  } finally {
    conn.release();
  }
};

// POST /sk-skripsi-lanjutan/:skripsiId/issue — Sekretariat issues the SK Skripsi (Skep-Skripsi series):
// applies the new title to skripsi.judul if the Seminar set one, and opens Bab 4.
exports.issue = async (req, res, next) => {
  const conn = await db.getConnection();
  let txStarted = false;
  try {
    if (!req.user.hasRole("SEKRETARIAT")) {
      return res.status(403).json({ ok: false, message: "Forbidden" });
    }
    const skripsiId = parseSkripsiId(req);
    if (!skripsiId) {
      return res.status(400).json({ ok: false, message: "Invalid skripsiId" });
    }

    await conn.beginTransaction();
    txStarted = true;

    const [[row]] = await conn.query(
      `SELECT l.id, l.status, l.judul_seminar, l.judul_skripsi,
              sk.npm, sk.program_studi_id, sk.pembimbing2_nidn,
              m.nama AS nama_mahasiswa,
              ps.nama AS program_studi_nama, ps.kode AS ps_kode,
              f.kode AS f_kode, f.dekan_staff_usr_id,
              d1.nama AS pembimbing1_nama, d2.nama AS pembimbing2_nama
       FROM pengajuan_sk_skripsi_lanjutan l
       JOIN skripsi sk ON sk.id = l.skripsi_id
       JOIN mahasiswa m ON m.npm = sk.npm
       JOIN program_studi ps ON ps.id = sk.program_studi_id
       LEFT JOIN fakultas f ON f.id = ps.fakultas_id
       LEFT JOIN dosen d1 ON d1.nidn = sk.pembimbing1_nidn
       LEFT JOIN dosen d2 ON d2.nidn = sk.pembimbing2_nidn
       WHERE l.skripsi_id = ? LIMIT 1 FOR UPDATE`,
      [skripsiId],
    );
    if (!row) {
      await conn.rollback();
      txStarted = false;
      return res
        .status(404)
        .json({ ok: false, message: "Pengajuan SK Skripsi tidak ditemukan" });
    }
    if (row.status !== "WAITING_SEKRETARIAT") {
      await conn.rollback();
      txStarted = false;
      return res.status(409).json({
        ok: false,
        message:
          row.status === "COMPLETED"
            ? "SK Skripsi sudah diterbitkan"
            : "Pengajuan belum diteruskan oleh Kaprodi",
      });
    }
    if (!row.f_kode || !row.dekan_staff_usr_id) {
      await conn.rollback();
      txStarted = false;
      return res
        .status(400)
        .json({ ok: false, message: "Dekan belum dikonfigurasi untuk fakultas ini" });
    }

    const [[dekan]] = await conn.query(
      `SELECT nama FROM staf WHERE usr_id = ? LIMIT 1`,
      [row.dekan_staff_usr_id],
    );
    const dekanSignature = await getStaffSignature(conn, row.dekan_staff_usr_id);
    assertSignatures([
      { role: "Dekan", nama: dekan?.nama, signatureImage: dekanSignature },
    ]);

    const now = new Date();
    const nomorSurat = await nextNomorSk(conn, {
      programStudiId: row.program_studi_id,
      jenisSk: JENIS.SKRIPSI,
      fakultasKode: row.f_kode,
      prodiKode: row.ps_kode,
      date: now,
    });
    const judul = row.judul_skripsi ?? row.judul_seminar;
    const skBuffer = await generateSuratKeputusanSkripsiFTI({
      nomorSurat,
      programStudi: row.program_studi_nama,
      mahasiswa: { nama: row.nama_mahasiswa, npm: row.npm },
      pembimbing: { pertama: row.pembimbing1_nama, kedua: row.pembimbing2_nama },
      judulSkripsi: judul,
      tanggal: formatTanggal(now),
      dekan: { nama: dekan?.nama ?? "", signatureBase64: dekanSignature },
    });

    await conn.query(
      `UPDATE pengajuan_sk_skripsi_lanjutan
       SET status = 'COMPLETED', nomor_surat = ?, judul_skripsi = ?,
           file_name = ?, mime_type = 'application/pdf', file_content = ?,
           issued_by_user_id = ?, completed_at = ?
       WHERE id = ?`,
      [
        nomorSurat,
        judul,
        `${row.npm} - ${row.nama_mahasiswa} - SK Penunjukan Pembimbing.pdf`,
        Buffer.from(skBuffer).toString("base64"),
        req.user.id,
        now,
        row.id,
      ],
    );

    // "Judul perlu diubah": the new title applies from the SK Skripsi on (Bab 4–5, kartu, Sidang Skripsi).
    if (judul !== row.judul_seminar) {
      await conn.query(
        `UPDATE skripsi SET judul = ?, updated_at = NOW() WHERE id = ?`,
        [judul, skripsiId],
      );
    }

    // Open Bab 4: the review flow creates each next stage, but Bab 3 ended the Seminar phase.
    const [[kartu]] = await conn.query(
      `SELECT id FROM kartu_konsultasi_skripsi WHERE skripsi_id = ? LIMIT 1`,
      [skripsiId],
    );
    if (kartu) {
      const [[bab4]] = await conn.query(
        `SELECT id FROM konsultasi_skripsi_stage
         WHERE kartu_konsultasi_skripsi_id = ? AND chapter_group = 'BAB_4' AND stage = 'PEMBIMBING_2'
         LIMIT 1`,
        [kartu.id],
      );
      if (!bab4) {
        await conn.query(
          `INSERT INTO konsultasi_skripsi_stage (
             kartu_konsultasi_skripsi_id, chapter_group, stage,
             pembimbing_nidn, current_status, current_submission_no, started_at
           ) VALUES (?, 'BAB_4', 'PEMBIMBING_2', ?, 'WAITING_SUBMISSION', 0, CURRENT_TIMESTAMP)`,
          [kartu.id, row.pembimbing2_nidn],
        );
      }
    }

    const [[studentRow]] = await conn.query(
      `SELECT id FROM users WHERE npm = ? AND is_active = 1 LIMIT 1`,
      [row.npm],
    );
    if (studentRow) {
      await insertNotification(
        conn,
        studentRow.id,
        "SK_SKRIPSI_LANJUTAN_ISSUED",
        "SK Skripsi Anda telah terbit. Konsultasi Bab 4 sudah dibuka.",
        "/student/skripsi-consultations",
      );
    }

    await conn.commit();
    txStarted = false;
    return res.json({
      ok: true,
      message: "SK Skripsi diterbitkan",
      data: { nomorSurat, judul },
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

// GET /sk-skripsi-lanjutan/:skripsiId/file — the issued SK Skripsi.
exports.getFile = async (req, res, next) => {
  try {
    const skripsiId = parseSkripsiId(req);
    if (!skripsiId) {
      return res.status(400).json({ ok: false, message: "Invalid skripsiId" });
    }
    const [[row]] = await db.query(
      `SELECT l.file_name, l.mime_type, l.file_content,
              sk.npm, sk.program_studi_id, sk.pembimbing1_nidn, sk.pembimbing2_nidn
       FROM pengajuan_sk_skripsi_lanjutan l
       JOIN skripsi sk ON sk.id = l.skripsi_id
       WHERE l.skripsi_id = ? LIMIT 1`,
      [skripsiId],
    );
    if (!row) {
      return res
        .status(404)
        .json({ ok: false, message: "Pengajuan SK Skripsi tidak ditemukan" });
    }
    if (!(await canRead(req, row, { includeSkReaders: true }))) {
      return res.status(403).json({ ok: false, message: "Forbidden" });
    }
    if (!row.file_content) {
      return res
        .status(404)
        .json({ ok: false, message: "SK Skripsi belum diterbitkan" });
    }
    return res.json({
      ok: true,
      data: {
        file_name: row.file_name,
        mime_type: row.mime_type,
        file_content: row.file_content,
      },
    });
  } catch (err) {
    next(err);
  }
};
