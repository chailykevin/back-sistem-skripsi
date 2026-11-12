const db = require("../db");
const { insertNotification } = require("../utils/notify");
const {
  generateSuratKeputusanSkripsiFTI,
} = require("../services/generateSuratKeputusanSkripsiFTI.js");
const {
  generateSuratKeputusanSeminarBisnisDigitalFTI,
} = require("../services/generateSuratKeputusanSeminarBisnisDigitalFTI.js");
const {
  generatePernyataanPenyelesaianSkripsiFTI,
} = require("../services/generatePernyataanPenyelesaianSkripsiFTI.js");
const { JENIS } = require("../services/sidangScope.service");
const { nextNomorSk } = require("../services/skNumber.service");
const {
  generateSuratKeteranganFTI,
} = require("../services/generateSuratKeteranganFTI.js");
const {
  getSuratPengantarPenelitianData,
  generateSuratPengantarPenelitianFTI,
} = require("../services/generateSuratPengantarPenelitianFTI.js");
const {
  skPenulisanName,
  getSkPenulisanNameForOutline,
  buildStudentFileName,
  generateHalamanPersetujuanFile,
} = require("../services/skPenulisan.service");
const {
  getStudentNpm,
  getStaffUsrId,
  getKaprodiProgramStudiIds,
  isKaprodiOfProgramStudi,
} = require("../utils/identity");
const { assertSignatures, getStaffSignature } = require("../utils/signature");
const { formatTanggal } = require("../utils/dates");
const { mimeFromFileName } = require("../utils/mime");
const { UPLOAD_RULES, validateUpload } = require("../utils/upload");
const { getSkSubmissionPeriod } = require("../services/outlineSubmissionPeriod.service");

const MIME_PDF = "application/pdf";

async function insertGeneratedFile(conn, skId, fileType, fileName, content) {
  await conn.query(
    `DELETE FROM pengajuan_sk_penelitian_files WHERE pengajuan_sk_penelitian_id = ? AND file_type = ?`,
    [skId, fileType],
  );
  await conn.query(
    `INSERT INTO pengajuan_sk_penelitian_files
       (pengajuan_sk_penelitian_id, file_type, file_name, mime_type, file_content, source, status)
     VALUES (?, ?, ?, ?, ?, 'GENERATED', 'VERIFIED')`,
    [skId, fileType, fileName, MIME_PDF, Buffer.from(content).toString("base64")],
  );
}

// `now` is also the SK's completed_at, so the monthly SK number and the row it is counted by
// come from the same clock.
async function generateSkDocuments(conn, sk, outlineId, jenisSk, now) {
  const isSeminar = jenisSk === JENIS.SEMINAR_BISNIS_DIGITAL;
  const [[kartu]] = await conn.query(
    `SELECT o.npm, o.judul AS judul_skripsi, o.program_studi_id,
            o.pembimbing1_nidn, o.pembimbing2_nidn,
            m.nama AS nama_mahasiswa,
            ps.nama AS program_studi_nama,
            d1.nama AS pembimbing1_nama,
            d2.nama AS pembimbing2_nama
     FROM kartu_konsultasi_outline k
     JOIN outline o ON o.id = k.outline_id
     JOIN mahasiswa m ON m.npm = o.npm
     JOIN program_studi ps ON ps.id = o.program_studi_id
     LEFT JOIN dosen d1 ON d1.nidn = o.pembimbing1_nidn
     LEFT JOIN dosen d2 ON d2.nidn = o.pembimbing2_nidn
     WHERE k.outline_id = ?
     LIMIT 1`,
    [outlineId],
  );
  if (!kartu)
    throw Object.assign(new Error("Kartu konsultasi outline tidak ditemukan"), {
      statusCode: 400,
    });

  const [[pj]] = await conn.query(
    `SELECT id, perlu_surat_pengantar, nama_perusahaan FROM pengajuan_disposisi_pembimbing WHERE outline_id = ? LIMIT 1`,
    [outlineId],
  );
  if (!pj)
    throw Object.assign(
      new Error("Pengajuan disposisi pembimbing tidak ditemukan"),
      { statusCode: 400 },
    );

  const [[ps]] = await conn.query(
    `SELECT ps.kode AS ps_kode, ps.kaprodi_staff_usr_id, staf.nama AS nama_kaprodi,
            f.kode AS f_kode, f.dekan_staff_usr_id
     FROM program_studi ps
     LEFT JOIN fakultas f ON f.id = ps.fakultas_id
     LEFT JOIN staf ON staf.usr_id = ps.kaprodi_staff_usr_id
     WHERE ps.id = ?
     LIMIT 1`,
    [kartu.program_studi_id],
  );
  if (!ps)
    throw Object.assign(new Error("Program studi tidak ditemukan"), {
      statusCode: 400,
    });
  if (!ps.f_kode || !ps.dekan_staff_usr_id) {
    throw Object.assign(
      new Error("Dekan belum dikonfigurasi untuk fakultas ini"),
      { statusCode: 400 },
    );
  }

  const [[dekan]] = await conn.query(
    `SELECT s.nama AS nama_dekan FROM staf s WHERE s.usr_id = ? LIMIT 1`,
    [ps.dekan_staff_usr_id],
  );
  if (!dekan)
    throw Object.assign(new Error("Dekan belum dikonfigurasi"), {
      statusCode: 400,
    });
  const dekanSignature = await getStaffSignature(conn, ps.dekan_staff_usr_id);
  const kaprodiSignature = await getStaffSignature(conn, ps.kaprodi_staff_usr_id);

  const [[mahasiswaUser]] = await conn.query(
    `SELECT signature_image FROM users WHERE npm = ? AND is_active = 1 LIMIT 1`,
    [kartu.npm],
  );

  assertSignatures([
    { role: "Dekan", nama: dekan.nama_dekan, signatureImage: dekanSignature },
    { role: "Kaprodi", nama: ps.nama_kaprodi, signatureImage: kaprodiSignature },
    {
      role: "Mahasiswa",
      nama: kartu.nama_mahasiswa,
      signatureImage: mahasiswaUser?.signature_image,
    },
  ]);

  const tanggal = formatTanggal(now);

  // Documents without the SK number are rendered before taking the program_studi lock in
  // nextNomorSk, so other numbering in this prodi doesn't wait on them.
  const penyelesaianBuffer = await generatePernyataanPenyelesaianSkripsiFTI({
    mahasiswa: {
      nama: kartu.nama_mahasiswa,
      npm: kartu.npm,
      alamat: "",
      noHp: "",
      judulSkripsi: kartu.judul_skripsi,
      signatureBase64: mahasiswaUser?.signature_image ?? null,
    },
    ketuaProgramStudi: {
      nama: ps.nama_kaprodi ?? "",
      programStudi: kartu.program_studi_nama,
      signatureBase64: kaprodiSignature ?? null,
    },
  });

  let keteranganBuffer = null;
  let pengantarBuffer = null;
  if (pj.perlu_surat_pengantar) {
    keteranganBuffer = await generateSuratKeteranganFTI({
      mahasiswa: {
        nama: kartu.nama_mahasiswa,
        npm: kartu.npm,
        programStudi: kartu.program_studi_nama,
      },
      lokasi: pj.nama_perusahaan ?? "",
      judul: kartu.judul_skripsi,
    });
    const dataPengantar = await getSuratPengantarPenelitianData(conn, pj.id);
    dataPengantar.tanggalSurat = tanggal;
    pengantarBuffer = await generateSuratPengantarPenelitianFTI(dataPengantar);
  }

  const nomorSurat = await nextNomorSk(conn, {
    programStudiId: kartu.program_studi_id,
    jenisSk,
    fakultasKode: ps.f_kode,
    prodiKode: ps.ps_kode,
    date: now,
  });
  await conn.query(
    `UPDATE pengajuan_sk_penelitian SET nomor_surat = ? WHERE id = ?`,
    [nomorSurat, sk.id],
  );

  const dataSuratKeputusan = {
    nomorSurat,
    programStudi: kartu.program_studi_nama,
    mahasiswa: { nama: kartu.nama_mahasiswa, npm: kartu.npm },
    pembimbing: { pertama: kartu.pembimbing1_nama, kedua: kartu.pembimbing2_nama },
    tanggal,
    dekan: { nama: dekan.nama_dekan, signatureBase64: dekanSignature },
  };
  const skBuffer = isSeminar
    ? await generateSuratKeputusanSeminarBisnisDigitalFTI({
        ...dataSuratKeputusan,
        judul: kartu.judul_skripsi,
      })
    : await generateSuratKeputusanSkripsiFTI({
        ...dataSuratKeputusan,
        judulSkripsi: kartu.judul_skripsi,
      });

  await insertGeneratedFile(
    conn,
    sk.id,
    "SK_PENUNJUKAN_PEMBIMBING",
    buildStudentFileName(
      kartu.npm,
      kartu.nama_mahasiswa,
      isSeminar
        ? "SK Penunjukan Pembimbing Seminar Bisnis Digital"
        : "SK Penunjukan Pembimbing",
    ),
    skBuffer,
  );
  await insertGeneratedFile(
    conn,
    sk.id,
    "SURAT_PENYELESAIAN_SKRIPSI",
    buildStudentFileName(kartu.npm, kartu.nama_mahasiswa, "Surat Penyelesaian Skripsi"),
    penyelesaianBuffer,
  );
  if (keteranganBuffer) {
    await insertGeneratedFile(
      conn,
      sk.id,
      "SURAT_KETERANGAN",
      `Surat_Keterangan_${kartu.npm}.pdf`,
      keteranganBuffer,
    );
    await insertGeneratedFile(
      conn,
      sk.id,
      "SURAT_PENGANTAR_PENELITIAN",
      `Surat_Pengantar_Penelitian_${kartu.npm}.pdf`,
      pengantarBuffer,
    );
  }
}

const VALID_FILE_TYPES = [
  "PENGAJUAN_DISPOSISI_PEMBIMBING",
  "TRANSKRIP_NILAI",
  "KARTU_KONSULTASI_OUTLINE",
  "FILE_OUTLINE",
  "HALAMAN_PERSETUJUAN",
  "SK_PENUNJUKAN_PEMBIMBING",
  "SURAT_KETERANGAN",
  "SURAT_PENGANTAR_PENELITIAN",
  "SURAT_PENYELESAIAN_SKRIPSI",
];

const VALID_SK_STATUSES = [
  "DRAFT",
  "SUBMITTED",
  "NEED_REVISION",
  "VERIFIED",
  "COMPLETED",
];

const REQUIRED_FILE_TYPES = [
  "PENGAJUAN_DISPOSISI_PEMBIMBING",
  "TRANSKRIP_NILAI",
  "KARTU_KONSULTASI_OUTLINE",
  "FILE_OUTLINE",
  "HALAMAN_PERSETUJUAN",
];
// System-generated/approved files are inserted VERIFIED; only these are reviewable or re-uploadable
const REVIEWABLE_FILE_TYPES = ["TRANSKRIP_NILAI"];
const VALID_FILE_STATUSES = ["SUBMITTED", "NEED_REUPLOAD", "VERIFIED"];

async function upsertSkFile(
  conn,
  skPenelitianId,
  fileType,
  fileName,
  mimeType,
  fileContent,
  source,
  status = "SUBMITTED",
) {
  await conn.query(
    `DELETE FROM pengajuan_sk_penelitian_files WHERE pengajuan_sk_penelitian_id = ? AND file_type = ?`,
    [skPenelitianId, fileType],
  );
  await conn.query(
    `INSERT INTO pengajuan_sk_penelitian_files
       (pengajuan_sk_penelitian_id, file_type, file_name, mime_type, file_content, source, status)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
    [
      skPenelitianId,
      fileType,
      fileName,
      mimeType ?? null,
      fileContent,
      source,
      status,
    ],
  );
}

function parseOutlineId(req) {
  const id = Number(req.params.outlineId);
  return Number.isFinite(id) && id > 0 ? id : null;
}

// Fakultas whose Dekan is this account. The Dekan columns are matched the same way the Dekan list
// always has: the legacy NIDN if set, else the staff account.
async function getDekanFakultasIds(userId) {
  const [rows] = await db.query(
    `SELECT f.id
     FROM fakultas f
     JOIN users u ON u.id = ? AND u.is_active = 1
     WHERE COALESCE(f.dekan_nidn, f.dekan_staff_usr_id) = COALESCE(u.nidn, u.staff_usr_id)`,
    [userId],
  );
  return rows.map((row) => Number(row.id));
}

// The owning student, Sekretariat, the Kaprodi of the student's prodi and the Dekan of its fakultas.
// Returns { found, allowed }: found is false when the outline doesn't exist.
async function checkSkReadAccess(req, outlineId) {
  const [[outline]] = await db.query(
    `SELECT o.npm, o.program_studi_id, ps.fakultas_id
     FROM outline o
     JOIN program_studi ps ON ps.id = o.program_studi_id
     WHERE o.id = ? LIMIT 1`,
    [outlineId],
  );
  if (!outline) return { found: false, allowed: false };
  if (req.user.hasRole("SEKRETARIAT")) return { found: true, allowed: true };
  if (req.user.hasRole("STUDENT")) {
    return {
      found: true,
      allowed: (await getStudentNpm(req.user.id)) === outline.npm,
    };
  }
  if (
    req.user.hasRole("KAPRODI") &&
    (await isKaprodiOfProgramStudi(req.user.id, outline.program_studi_id))
  ) {
    return { found: true, allowed: true };
  }
  if (req.user.hasRole("DEKAN")) {
    const fakultasIds = await getDekanFakultasIds(req.user.id);
    return { found: true, allowed: fakultasIds.includes(Number(outline.fakultas_id)) };
  }
  return { found: true, allowed: false };
}

async function notifySekretariat(conn, type, message) {
  const [sekRows] = await conn.query(
    `SELECT u.id FROM users u
     JOIN user_roles ur ON ur.user_id = u.id
     JOIN roles r ON r.id = ur.role_id
     WHERE r.code = 'SEKRETARIAT'`,
  );
  for (const sek of sekRows) {
    await insertNotification(conn, sek.id, type, message, "/sekretariat/sk-penelitian");
  }
}

exports.initSkPenelitian = async (req, res, next) => {
  const conn = await db.getConnection();
  let txStarted = false;
  try {
    if (req.user.userType !== "STUDENT") {
      return res.status(403).json({
        ok: false,
        message: "Hanya mahasiswa yang dapat menginisiasi SK Penulisan",
      });
    }

    const outlineId = parseOutlineId(req);
    if (!outlineId) {
      return res.status(400).json({ ok: false, message: "Invalid outlineId" });
    }

    const npm = await getStudentNpm(req.user.id);
    if (!npm) {
      return res
        .status(400)
        .json({ ok: false, message: "Mahasiswa tidak valid" });
    }

    const [outlineRows] = await conn.query(
      `SELECT id FROM outline WHERE id = ? AND npm = ? AND status = 'ACCEPTED' LIMIT 1`,
      [outlineId, npm],
    );
    if (outlineRows.length === 0) {
      return res
        .status(404)
        .json({ ok: false, message: "Outline tidak ditemukan" });
    }

    const [kartuRows] = await conn.query(
      `SELECT k.id FROM kartu_konsultasi_outline k
       WHERE k.outline_id = ? AND k.is_completed = 1
       LIMIT 1`,
      [outlineId],
    );
    if (kartuRows.length === 0) {
      return res.status(400).json({
        ok: false,
        message: "Kartu konsultasi outline belum selesai",
      });
    }

    const skName = await getSkPenulisanNameForOutline(conn, outlineId);

    const [existingRows] = await conn.query(
      `SELECT id FROM pengajuan_sk_penelitian WHERE outline_id = ? LIMIT 1`,
      [outlineId],
    );
    if (existingRows.length > 0) {
      return res
        .status(409)
        .json({ ok: false, message: `${skName} sudah dibuat` });
    }

    const { message: periodMessage } = await getSkSubmissionPeriod(conn);
    if (periodMessage) {
      return res.status(409).json({ ok: false, message: periodMessage });
    }

    await conn.beginTransaction();
    txStarted = true;

    const [ins] = await conn.query(
      `INSERT INTO pengajuan_sk_penelitian (outline_id, status) VALUES (?, 'DRAFT')`,
      [outlineId],
    );
    const skId = ins.insertId;

    const halaman = await generateHalamanPersetujuanFile(conn, outlineId);
    await conn.query(
      `INSERT INTO pengajuan_sk_penelitian_files
         (pengajuan_sk_penelitian_id, file_type, file_name, mime_type, file_content, source, status)
       VALUES (?, 'HALAMAN_PERSETUJUAN', ?, ?, ?, 'SYSTEM', 'VERIFIED')`,
      [skId, halaman.fileName, halaman.mimeType, halaman.content],
    );

    await conn.commit();
    txStarted = false;

    return res.status(201).json({
      ok: true,
      message: `${skName} dibuat`,
      data: { id: skId },
    });
  } catch (err) {
    try {
      if (txStarted) await conn.rollback();
    } catch (_) {}
    // A double-clicked init loses to the first one on uq_sk_outline_id.
    if (err?.code === "ER_DUP_ENTRY") {
      return res
        .status(409)
        .json({ ok: false, message: "SK Penulisan sudah dibuat" });
    }
    next(err);
  } finally {
    conn.release();
  }
};

exports.getSkPenelitian = async (req, res, next) => {
  try {
    const outlineId = parseOutlineId(req);
    if (!outlineId) {
      return res.status(400).json({ ok: false, message: "Invalid outlineId" });
    }

    const access = await checkSkReadAccess(req, outlineId);
    if (!access.found) {
      return res
        .status(404)
        .json({ ok: false, message: "SK Penulisan tidak ditemukan" });
    }
    if (!access.allowed) {
      return res.status(403).json({ ok: false, message: "Forbidden" });
    }

    const [skRows] = await db.query(
      `SELECT
         sk.*,
         o.npm,
         m.nama AS nama_mahasiswa,
         m.tahap_tugas_akhir,
         o.judul AS judul_skripsi,
         ps.nama AS program_studi_nama
       FROM pengajuan_sk_penelitian sk
       JOIN outline o ON o.id = sk.outline_id
       LEFT JOIN mahasiswa m ON m.npm = o.npm
       LEFT JOIN program_studi ps ON ps.id = o.program_studi_id
       WHERE sk.outline_id = ?
       LIMIT 1`,
      [outlineId],
    );
    const sk = skRows[0] ?? null;
    if (!sk) {
      return res
        .status(404)
        .json({ ok: false, message: "SK Penulisan tidak ditemukan" });
    }

    const [files] = await db.query(
      `SELECT id, file_type, file_name, mime_type, source, status, catatan_sekretariat, created_at
       FROM pengajuan_sk_penelitian_files
       WHERE pengajuan_sk_penelitian_id = ?
       ORDER BY file_type ASC`,
      [sk.id],
    );

    return res.json({ ok: true, data: { sk, files } });
  } catch (err) {
    next(err);
  }
};

exports.submitSkPenelitian = async (req, res, next) => {
  const conn = await db.getConnection();
  let txStarted = false;
  try {
    if (req.user.userType !== "STUDENT") {
      return res
        .status(403)
        .json({ ok: false, message: "Hanya mahasiswa yang dapat mengajukan SK Penulisan" });
    }

    const outlineId = parseOutlineId(req);
    if (!outlineId) {
      return res.status(400).json({ ok: false, message: "Invalid outlineId" });
    }

    const npm = await getStudentNpm(req.user.id);
    if (!npm) {
      return res
        .status(400)
        .json({ ok: false, message: "Mahasiswa tidak valid" });
    }

    await conn.beginTransaction();
    txStarted = true;

    const [skRows] = await conn.query(
      `SELECT sk.*
       FROM pengajuan_sk_penelitian sk
       JOIN outline o ON o.id = sk.outline_id
       WHERE sk.outline_id = ? AND o.npm = ?
       LIMIT 1 FOR UPDATE`,
      [outlineId, npm],
    );
    const sk = skRows[0] ?? null;
    if (!sk) {
      await conn.rollback();
      txStarted = false;
      return res
        .status(404)
        .json({ ok: false, message: "SK Penulisan tidak ditemukan" });
    }
    // A returned SK (NEED_REVISION) is fixed through resubmit, which takes the re-uploaded files.
    if (sk.status !== "DRAFT") {
      await conn.rollback();
      txStarted = false;
      return res.status(409).json({
        ok: false,
        message: "SK Penulisan hanya bisa diajukan saat berstatus Draft",
      });
    }

    const { period, message: periodMessage } = await getSkSubmissionPeriod(conn);
    if (!period) {
      await conn.rollback();
      txStarted = false;
      return res.status(409).json({ ok: false, message: periodMessage });
    }

    const [kartuRows] = await conn.query(
      `SELECT id, file_content, file_name, mime_type
       FROM kartu_konsultasi_outline
       WHERE outline_id = ?
       LIMIT 1`,
      [outlineId],
    );
    if (kartuRows.length === 0) {
      await conn.rollback();
      txStarted = false;
      return res.status(400).json({
        ok: false,
        message: "Kartu konsultasi outline tidak ditemukan",
      });
    }
    const kartuFile = kartuRows[0];
    if (!kartuFile.file_content) {
      await conn.rollback();
      txStarted = false;
      return res.status(400).json({
        ok: false,
        message: "File kartu konsultasi outline belum digenerate",
      });
    }

    const [outlineRows] = await conn.query(
      `SELECT s.file_outline, s.file_outline_name
       FROM konsultasi_outline_submission s
       INNER JOIN konsultasi_outline_stage st ON st.id = s.konsultasi_outline_stage_id
       WHERE st.kartu_konsultasi_outline_id = ?
       ORDER BY s.submitted_at DESC
       LIMIT 1`,
      [kartuFile.id],
    );
    if (outlineRows.length === 0) {
      await conn.rollback();
      txStarted = false;
      return res
        .status(400)
        .json({ ok: false, message: "File outline skripsi tidak ditemukan" });
    }
    const outlineRow = outlineRows[0];

    const [transkripRows] = await conn.query(
      `SELECT pf.file_content, pf.file_name
       FROM pengajuan_disposisi_pembimbing_file pf
       JOIN pengajuan_disposisi_pembimbing pj ON pj.id = pf.pengajuan_disposisi_pembimbing_id
       WHERE pj.outline_id = ? AND pf.file_type = 'TRANSKRIP' LIMIT 1`,
      [outlineId],
    );
    if (transkripRows.length === 0) {
      await conn.rollback();
      txStarted = false;
      return res.status(400).json({
        ok: false,
        message:
          "File transkrip nilai tidak ditemukan pada pengajuan disposisi pembimbing",
      });
    }
    const transkripRow = transkripRows[0];

    // The formulir is generated when Kaprodi approves the disposisi.
    const [formulirRows] = await conn.query(
      `SELECT pf.file_content, pf.file_name
       FROM pengajuan_disposisi_pembimbing_file pf
       JOIN pengajuan_disposisi_pembimbing pj ON pj.id = pf.pengajuan_disposisi_pembimbing_id
       WHERE pj.outline_id = ? AND pf.file_type = 'PENGAJUAN_DISPOSISI_PEMBIMBING' LIMIT 1`,
      [outlineId],
    );
    if (formulirRows.length === 0) {
      await conn.rollback();
      txStarted = false;
      return res.status(400).json({
        ok: false,
        message: "File formulir pengajuan disposisi pembimbing tidak ditemukan",
      });
    }
    const formulirRow = formulirRows[0];

    await upsertSkFile(
      conn,
      sk.id,
      "PENGAJUAN_DISPOSISI_PEMBIMBING",
      formulirRow.file_name,
      MIME_PDF,
      formulirRow.file_content,
      "SYSTEM",
      "VERIFIED",
    );
    await upsertSkFile(
      conn,
      sk.id,
      "TRANSKRIP_NILAI",
      transkripRow.file_name,
      mimeFromFileName(transkripRow.file_name),
      transkripRow.file_content,
      "SYSTEM",
    );
    await upsertSkFile(
      conn,
      sk.id,
      "KARTU_KONSULTASI_OUTLINE",
      kartuFile.file_name,
      kartuFile.mime_type ?? mimeFromFileName(kartuFile.file_name),
      kartuFile.file_content,
      "SYSTEM",
      "VERIFIED",
    );
    await upsertSkFile(
      conn,
      sk.id,
      "FILE_OUTLINE",
      outlineRow.file_outline_name,
      mimeFromFileName(outlineRow.file_outline_name),
      outlineRow.file_outline,
      "SYSTEM",
      "VERIFIED",
    );
    await conn.query(
      `UPDATE pengajuan_sk_penelitian
       SET status = 'SUBMITTED', submission_period_id = ?,
           submitted_at = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP
       WHERE id = ?`,
      [period.id, sk.id],
    );

    const skName = await getSkPenulisanNameForOutline(conn, outlineId);
    const [[studentRow]] = await conn.query(
      `SELECT nama FROM mahasiswa WHERE npm = ? LIMIT 1`,
      [npm],
    );
    await notifySekretariat(
      conn,
      "SK_SUBMITTED",
      `Mahasiswa ${studentRow?.nama ?? npm} mengajukan ${skName}`,
    );

    await conn.commit();
    txStarted = false;

    return res.json({ ok: true, message: `${skName} berhasil diajukan` });
  } catch (err) {
    try {
      if (txStarted) await conn.rollback();
    } catch (_) {}
    next(err);
  } finally {
    conn.release();
  }
};

exports.reviewSkFile = async (req, res, next) => {
  const conn = await db.getConnection();
  let txStarted = false;
  try {
    if (!req.user.hasRole("SEKRETARIAT")) {
      return res.status(403).json({
        ok: false,
        message: "Hanya Sekretariat yang dapat mereview berkas SK Penulisan",
      });
    }

    const outlineId = parseOutlineId(req);
    if (!outlineId) {
      return res.status(400).json({ ok: false, message: "Invalid outlineId" });
    }

    const fileType = req.params.fileType;
    if (!REVIEWABLE_FILE_TYPES.includes(fileType)) {
      return res.status(400).json({
        ok: false,
        message: REQUIRED_FILE_TYPES.includes(fileType)
          ? `File ${fileType} diverifikasi otomatis oleh sistem dan tidak dapat direview`
          : `fileType tidak valid: ${fileType}. Harus salah satu dari: ${REVIEWABLE_FILE_TYPES.join(", ")}`,
      });
    }

    const { status, catatanSekretariat } = req.body ?? {};
    if (!VALID_FILE_STATUSES.includes(status)) {
      return res.status(400).json({
        ok: false,
        message: `status harus salah satu dari: ${VALID_FILE_STATUSES.join(", ")}`,
      });
    }

    await conn.beginTransaction();
    txStarted = true;

    const [[sk]] = await conn.query(
      `SELECT id, status FROM pengajuan_sk_penelitian WHERE outline_id = ? LIMIT 1 FOR UPDATE`,
      [outlineId],
    );
    if (!sk) {
      await conn.rollback();
      txStarted = false;
      return res
        .status(404)
        .json({ ok: false, message: "SK Penulisan tidak ditemukan" });
    }
    // While the student is fixing a returned SK, the file decisions that sent it back stay fixed.
    if (sk.status !== "SUBMITTED") {
      await conn.rollback();
      txStarted = false;
      return res.status(409).json({
        ok: false,
        message: "Review berkas hanya bisa dilakukan saat pengajuan menunggu verifikasi",
      });
    }

    const [[fileRow]] = await conn.query(
      `SELECT id FROM pengajuan_sk_penelitian_files
       WHERE pengajuan_sk_penelitian_id = ? AND file_type = ? LIMIT 1`,
      [sk.id, fileType],
    );
    if (!fileRow) {
      await conn.rollback();
      txStarted = false;
      return res
        .status(404)
        .json({ ok: false, message: `File ${fileType} tidak ditemukan` });
    }

    await conn.query(
      `UPDATE pengajuan_sk_penelitian_files SET status = ?, catatan_sekretariat = ? WHERE id = ?`,
      [
        status,
        catatanSekretariat ? String(catatanSekretariat).trim() : null,
        fileRow.id,
      ],
    );

    await conn.commit();
    txStarted = false;

    return res.json({
      ok: true,
      message: `Status file ${fileType} diperbarui`,
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

// Sekretariat's final decision: VERIFY or NEED_REVISION. There is no reject (decided 2026-11-12):
// a rejected SK left the student with an ACCEPTED outline they could neither restart nor re-submit.
exports.reviewSkPenelitian = async (req, res, next) => {
  const conn = await db.getConnection();
  let txStarted = false;
  try {
    if (!req.user.hasRole("SEKRETARIAT")) {
      return res.status(403).json({
        ok: false,
        message: "Hanya Sekretariat yang dapat memverifikasi SK Penulisan",
      });
    }

    const outlineId = parseOutlineId(req);
    if (!outlineId) {
      return res.status(400).json({ ok: false, message: "Invalid outlineId" });
    }

    const { action, catatanSekretariat } = req.body ?? {};

    if (action !== "VERIFY" && action !== "NEED_REVISION") {
      return res.status(400).json({
        ok: false,
        message: "action harus 'VERIFY' atau 'NEED_REVISION'",
      });
    }
    if (
      action === "NEED_REVISION" &&
      (!catatanSekretariat || !String(catatanSekretariat).trim())
    ) {
      return res
        .status(400)
        .json({ ok: false, message: "catatanSekretariat wajib diisi" });
    }

    await conn.beginTransaction();
    txStarted = true;

    const [skRows] = await conn.query(
      `SELECT * FROM pengajuan_sk_penelitian WHERE outline_id = ? LIMIT 1 FOR UPDATE`,
      [outlineId],
    );
    const sk = skRows[0] ?? null;
    if (!sk) {
      await conn.rollback();
      txStarted = false;
      return res
        .status(404)
        .json({ ok: false, message: "SK Penulisan tidak ditemukan" });
    }
    if (sk.status !== "SUBMITTED") {
      await conn.rollback();
      txStarted = false;
      return res.status(409).json({
        ok: false,
        message: "SK Penulisan harus berstatus menunggu verifikasi untuk difinalisasi",
      });
    }

    const [skStudentRows] = await conn.query(
      `SELECT u.id FROM users u
       JOIN outline o ON o.npm = u.npm AND o.id = ?
       LIMIT 1`,
      [outlineId],
    );
    const studentUserIdForSk = skStudentRows[0]?.id ?? null;

    const [fileRows] = await conn.query(
      `SELECT file_type, status FROM pengajuan_sk_penelitian_files WHERE pengajuan_sk_penelitian_id = ?`,
      [sk.id],
    );
    const fileMap = Object.fromEntries(
      fileRows.map((f) => [f.file_type, f.status]),
    );

    if (action === "NEED_REVISION") {
      // The student can only answer a revision by re-uploading a NEED_REUPLOAD file.
      const toReupload = REVIEWABLE_FILE_TYPES.filter(
        (t) => fileMap[t] === "NEED_REUPLOAD",
      );
      if (toReupload.length === 0) {
        await conn.rollback();
        txStarted = false;
        return res.status(400).json({
          ok: false,
          message:
            "Tandai minimal satu berkas sebagai Perlu Upload Ulang sebelum mengembalikan pengajuan",
        });
      }

      await conn.query(
        `UPDATE pengajuan_sk_penelitian
         SET status = 'NEED_REVISION',
             catatan_sekretariat = ?,
             updated_at = CURRENT_TIMESTAMP
         WHERE id = ?`,
        [String(catatanSekretariat).trim(), sk.id],
      );
      if (studentUserIdForSk) {
        const skName = await getSkPenulisanNameForOutline(conn, outlineId);
        await insertNotification(
          conn,
          studentUserIdForSk,
          "SK_FILE_NEED_REUPLOAD",
          `Sekretariat meminta Anda mengunggah ulang dokumen ${skName}`,
          "/student/sk-penelitian",
        );
      }
      await conn.commit();
      txStarted = false;
      return res.json({
        ok: true,
        message: "SK Penulisan dikembalikan untuk revisi",
      });
    }

    const unverified = REQUIRED_FILE_TYPES.filter(
      (t) => fileMap[t] !== "VERIFIED",
    );
    if (unverified.length > 0) {
      await conn.rollback();
      txStarted = false;
      return res.status(400).json({
        ok: false,
        message: `File berikut belum diverifikasi: ${unverified.join(", ")}`,
      });
    }

    // A BD student still in Seminar Bisnis Digital (per the SIMIKO KRS sync) gets the Seminar SK,
    // and the skripsi record follows the Seminar flow until the SK Skripsi is issued.
    const [[tahapRow]] = await conn.query(
      `SELECT m.tahap_tugas_akhir
       FROM outline o
       JOIN mahasiswa m ON m.npm = o.npm
       WHERE o.id = ? LIMIT 1`,
      [outlineId],
    );
    const jenisSk =
      tahapRow?.tahap_tugas_akhir === JENIS.SEMINAR_BISNIS_DIGITAL
        ? JENIS.SEMINAR_BISNIS_DIGITAL
        : JENIS.SKRIPSI;

    const now = new Date();
    await conn.query(
      `UPDATE pengajuan_sk_penelitian
       SET status = 'COMPLETED',
           jenis_sk = ?,
           catatan_sekretariat = ?,
           verified_by_user_id = ?,
           verified_at = ?,
           completed_at = ?,
           updated_at = CURRENT_TIMESTAMP
       WHERE id = ?`,
      [
        jenisSk,
        catatanSekretariat ? String(catatanSekretariat).trim() : null,
        req.user.id,
        now,
        now,
        sk.id,
      ],
    );

    await generateSkDocuments(conn, sk, outlineId, jenisSk, now);

    const [[skripsiSource]] = await conn.query(
      `SELECT o.npm, o.judul AS judul, o.program_studi_id,
              o.pembimbing1_nidn, o.pembimbing2_nidn, k.outline_id
       FROM kartu_konsultasi_outline k
       JOIN outline o ON o.id = k.outline_id
       WHERE k.outline_id = ?
       LIMIT 1`,
      [outlineId],
    );
    if (skripsiSource) {
      await conn.query(
        `INSERT INTO skripsi
           (npm, outline_id, judul, status, jalur, program_studi_id,
            pembimbing1_nidn, pembimbing2_nidn)
         VALUES (?, ?, ?, 'IN_PROGRESS', ?, ?, ?, ?)`,
        [
          skripsiSource.npm,
          skripsiSource.outline_id,
          skripsiSource.judul,
          jenisSk,
          skripsiSource.program_studi_id ?? null,
          skripsiSource.pembimbing1_nidn ?? null,
          skripsiSource.pembimbing2_nidn ?? null,
        ],
      );
    }

    if (studentUserIdForSk) {
      await insertNotification(
        conn,
        studentUserIdForSk,
        "SK_COMPLETED",
        `${skPenulisanName(jenisSk)} Anda telah diverifikasi`,
        "/student/sk-penelitian",
      );
    }

    await conn.commit();
    txStarted = false;

    return res.json({
      ok: true,
      message: `${skPenulisanName(jenisSk)} diverifikasi dan diselesaikan`,
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

exports.resubmitSkPenelitian = async (req, res, next) => {
  const conn = await db.getConnection();
  let txStarted = false;
  try {
    if (req.user.userType !== "STUDENT") {
      return res.status(403).json({
        ok: false,
        message: "Hanya mahasiswa yang dapat mengajukan ulang SK Penulisan",
      });
    }

    const outlineId = parseOutlineId(req);
    if (!outlineId) {
      return res.status(400).json({ ok: false, message: "Invalid outlineId" });
    }

    const { files } = req.body ?? {};
    if (!Array.isArray(files) || files.length === 0) {
      return res
        .status(400)
        .json({ ok: false, message: "files harus berisi minimal 1 entri" });
    }
    for (const f of files) {
      if (!f?.fileType || !String(f.fileType).trim()) {
        return res
          .status(400)
          .json({ ok: false, message: "Setiap file harus memiliki fileType" });
      }
      if (!REVIEWABLE_FILE_TYPES.includes(f.fileType)) {
        return res.status(400).json({
          ok: false,
          message: `fileType tidak valid: ${f.fileType}. Harus salah satu dari: ${REVIEWABLE_FILE_TYPES.join(", ")}`,
        });
      }
      if (!f?.content || !String(f.content).trim()) {
        return res.status(400).json({
          ok: false,
          message: `content wajib diisi untuk ${f.fileType}`,
        });
      }
      if (!f?.name || !String(f.name).trim()) {
        return res
          .status(400)
          .json({ ok: false, message: `name wajib diisi untuk ${f.fileType}` });
      }
      const uploadError = validateUpload(
        f.content,
        String(f.name).trim(),
        UPLOAD_RULES.TRANSKRIP,
        "File transkrip nilai",
      );
      if (uploadError) {
        return res.status(400).json({ ok: false, message: uploadError });
      }
    }
    const fileTypes = files.map((f) => f.fileType);
    if (new Set(fileTypes).size !== fileTypes.length) {
      return res
        .status(400)
        .json({ ok: false, message: "fileType tidak boleh duplikat" });
    }

    const npm = await getStudentNpm(req.user.id);
    if (!npm) {
      return res
        .status(400)
        .json({ ok: false, message: "Mahasiswa tidak valid" });
    }

    await conn.beginTransaction();
    txStarted = true;

    const [skRows] = await conn.query(
      `SELECT sk.*
       FROM pengajuan_sk_penelitian sk
       JOIN outline o ON o.id = sk.outline_id
       WHERE sk.outline_id = ? AND o.npm = ?
       LIMIT 1 FOR UPDATE`,
      [outlineId, npm],
    );
    const sk = skRows[0] ?? null;
    if (!sk) {
      await conn.rollback();
      txStarted = false;
      return res
        .status(404)
        .json({ ok: false, message: "SK Penulisan tidak ditemukan" });
    }
    if (sk.status !== "NEED_REVISION") {
      await conn.rollback();
      txStarted = false;
      return res.status(409).json({
        ok: false,
        message: "SK Penulisan harus berstatus Perlu Revisi untuk diajukan ulang",
      });
    }

    for (const f of files) {
      const [fileRows] = await conn.query(
        `SELECT status FROM pengajuan_sk_penelitian_files WHERE pengajuan_sk_penelitian_id = ? AND file_type = ? LIMIT 1`,
        [sk.id, f.fileType],
      );
      if (fileRows.length === 0) {
        await conn.rollback();
        txStarted = false;
        return res
          .status(404)
          .json({ ok: false, message: `File ${f.fileType} tidak ditemukan` });
      }
      if (fileRows[0].status !== "NEED_REUPLOAD") {
        await conn.rollback();
        txStarted = false;
        return res.status(400).json({
          ok: false,
          message: `File ${f.fileType} tidak berstatus NEED_REUPLOAD`,
        });
      }
    }

    for (const f of files) {
      const fileName = String(f.name).trim();
      await upsertSkFile(
        conn,
        sk.id,
        f.fileType,
        fileName,
        mimeFromFileName(fileName),
        String(f.content),
        "UPLOADED",
      );
    }

    await conn.query(
      `UPDATE pengajuan_sk_penelitian SET status = 'SUBMITTED', updated_at = CURRENT_TIMESTAMP WHERE id = ?`,
      [sk.id],
    );

    const skName = await getSkPenulisanNameForOutline(conn, outlineId);
    const [[studentRow]] = await conn.query(
      `SELECT nama FROM mahasiswa WHERE npm = ? LIMIT 1`,
      [npm],
    );
    await notifySekretariat(
      conn,
      "SK_RESUBMITTED",
      `Mahasiswa ${studentRow?.nama ?? npm} mengajukan ulang ${skName}`,
    );

    await conn.commit();
    txStarted = false;

    return res.json({ ok: true, message: "File berhasil diajukan ulang" });
  } catch (err) {
    try {
      if (txStarted) await conn.rollback();
    } catch (_) {}
    next(err);
  } finally {
    conn.release();
  }
};

exports.getSkFile = async (req, res, next) => {
  try {
    const outlineId = parseOutlineId(req);
    if (!outlineId) {
      return res.status(400).json({ ok: false, message: "Invalid outlineId" });
    }

    const fileType = req.params.fileType;
    if (!VALID_FILE_TYPES.includes(fileType)) {
      return res.status(400).json({
        ok: false,
        message: `fileType tidak valid. Harus salah satu dari: ${VALID_FILE_TYPES.join(", ")}`,
      });
    }

    const access = await checkSkReadAccess(req, outlineId);
    if (!access.found) {
      return res
        .status(404)
        .json({ ok: false, message: "SK Penulisan tidak ditemukan" });
    }
    if (!access.allowed) {
      return res.status(403).json({ ok: false, message: "Forbidden" });
    }

    const [fileRows] = await db.query(
      `SELECT f.id, f.file_type, f.file_name, f.mime_type, f.file_content, f.source, f.created_at
       FROM pengajuan_sk_penelitian_files f
       JOIN pengajuan_sk_penelitian sk ON sk.id = f.pengajuan_sk_penelitian_id
       WHERE sk.outline_id = ? AND f.file_type = ?
       ORDER BY f.created_at DESC
       LIMIT 1`,
      [outlineId, fileType],
    );
    const file = fileRows[0] ?? null;
    if (!file) {
      return res
        .status(404)
        .json({ ok: false, message: `File ${fileType} tidak ditemukan` });
    }

    return res.json({ ok: true, data: file });
  } catch (err) {
    next(err);
  }
};

const LIST_SELECT = `
  SELECT
    sk.id,
    sk.jenis_sk,
    sk.outline_id,
    sk.status,
    sk.catatan_sekretariat,
    sk.submitted_at,
    sk.verified_at,
    sk.completed_at,
    sk.created_at,
    o.npm,
    m.nama AS nama_mahasiswa,
    m.tahap_tugas_akhir,
    o.judul AS judul_skripsi,
    sk.submission_period_id,
    o.program_studi_id,
    ps.nama AS program_studi_nama,
    EXISTS(
      SELECT 1 FROM pengajuan_sk_penelitian_files f
      WHERE f.pengajuan_sk_penelitian_id = sk.id AND f.file_type = 'SK_PENUNJUKAN_PEMBIMBING'
    ) AS has_sk_penunjukan_pembimbing,
    EXISTS(
      SELECT 1 FROM pengajuan_sk_penelitian_files f
      WHERE f.pengajuan_sk_penelitian_id = sk.id AND f.file_type = 'SURAT_KETERANGAN'
    ) AS has_surat_keterangan,
    EXISTS(
      SELECT 1 FROM pengajuan_sk_penelitian_files f
      WHERE f.pengajuan_sk_penelitian_id = sk.id AND f.file_type = 'SURAT_PENGANTAR_PENELITIAN'
    ) AS has_surat_pengantar_penelitian,
    EXISTS(
      SELECT 1 FROM pengajuan_sk_penelitian_files f
      WHERE f.pengajuan_sk_penelitian_id = sk.id AND f.file_type = 'SURAT_PENYELESAIAN_SKRIPSI'
    ) AS has_surat_penyelesaian_skripsi
  FROM pengajuan_sk_penelitian sk
  JOIN outline o ON o.id = sk.outline_id
  LEFT JOIN mahasiswa m ON m.npm = o.npm
  LEFT JOIN program_studi ps ON ps.id = o.program_studi_id`;

exports.listSkForSekretariat = async (req, res, next) => {
  try {
    if (!req.user.hasRole("SEKRETARIAT")) {
      return res.status(403).json({
        ok: false,
        message: "Only sekretariat can access this endpoint",
      });
    }

    const statusParam = req.query?.status;
    const filterByStatus =
      statusParam && VALID_SK_STATUSES.includes(statusParam);

    const [rows] = await db.query(
      `${LIST_SELECT}
       ${filterByStatus ? "WHERE sk.status = ?" : ""}
       ORDER BY sk.submitted_at DESC`,
      filterByStatus ? [statusParam] : [],
    );

    return res.json({ ok: true, data: rows });
  } catch (err) {
    next(err);
  }
};

exports.listSkForKaprodi = async (req, res, next) => {
  try {
    if (!req.user.hasRole("KAPRODI")) {
      return res.status(403).json({
        ok: false,
        message: "Only kaprodi can access this endpoint",
      });
    }

    const staffUsrId = await getStaffUsrId(req.user.id);
    if (!staffUsrId) {
      return res.status(400).json({ ok: false, message: "Dosen tidak valid" });
    }

    const programStudiIds = await getKaprodiProgramStudiIds(staffUsrId);
    if (programStudiIds.length === 0) {
      return res
        .status(403)
        .json({ ok: false, message: "You are not assigned as Kaprodi" });
    }

    const statusParam = req.query?.status;
    const filterByStatus =
      statusParam && VALID_SK_STATUSES.includes(statusParam);

    const [rows] = await db.query(
      `${LIST_SELECT}
       WHERE o.program_studi_id IN (?)
       ${filterByStatus ? "AND sk.status = ?" : ""}
       ORDER BY sk.submitted_at DESC`,
      filterByStatus ? [programStudiIds, statusParam] : [programStudiIds],
    );

    return res.json({ ok: true, data: rows });
  } catch (err) {
    next(err);
  }
};

// Every status by default (the Dekan dashboard counts total vs finished SKs); the Dokumen page
// filters to COMPLETED itself.
exports.listSkForDekan = async (req, res, next) => {
  try {
    if (!req.user.hasRole("DEKAN")) {
      return res
        .status(403)
        .json({ ok: false, message: "Only dekan can access this endpoint" });
    }

    const fakultasIds = await getDekanFakultasIds(req.user.id);
    if (fakultasIds.length === 0) {
      return res.status(403).json({
        ok: false,
        message: "Anda tidak terdaftar sebagai Dekan fakultas mana pun",
      });
    }

    const statusParam = req.query?.status;
    const filterByStatus =
      statusParam && VALID_SK_STATUSES.includes(statusParam);

    // The skripsi of an SK is the one created from the same outline: a student who restarted after
    // GAGAL has an older SK whose skripsi isn't their newest.
    const [rows] = await db.query(
      `SELECT
         sk.id,
         'SK_PENELITIAN' AS sumber,
         sk.jenis_sk,
         sk.outline_id,
         sk.status,
         sk.submitted_at,
         sk.completed_at,
         sk.created_at,
         m.nama AS nama_mahasiswa,
         o.judul AS judul_skripsi,
         ps.nama AS program_studi_nama,
         o.program_studi_id,
         (SELECT id FROM skripsi WHERE outline_id = sk.outline_id ORDER BY id DESC LIMIT 1) AS skripsi_id,
         EXISTS(
           SELECT 1 FROM pengajuan_sk_penelitian_files f
           WHERE f.pengajuan_sk_penelitian_id = sk.id AND f.file_type = 'SK_PENUNJUKAN_PEMBIMBING'
         ) AS has_sk_document,
         EXISTS(
           SELECT 1 FROM revisi_pasca_sidang rps
           JOIN sidang sd ON sd.id = rps.sidang_id
           JOIN skripsi s2 ON s2.id = sd.skripsi_id
           JOIN revisi_pasca_sidang_files rf ON rf.revisi_id = rps.id AND rf.file_type = 'HALAMAN_PENGESAHAN_DEKAN'
           WHERE sd.jenis = 'SKRIPSI' AND s2.outline_id = sk.outline_id
         ) AS has_halaman_pengesahan
       FROM pengajuan_sk_penelitian sk
       JOIN outline o ON o.id = sk.outline_id
       LEFT JOIN mahasiswa m ON m.npm = o.npm
       JOIN program_studi ps ON ps.id = o.program_studi_id
       WHERE ps.fakultas_id IN (?)
       ${filterByStatus ? "AND sk.status = ?" : ""}
       ORDER BY sk.submitted_at DESC`,
      filterByStatus ? [fakultasIds, statusParam] : [fakultasIds],
    );

    // SK Skripsi issued through the Seminar Bisnis Digital bridge are also signed by the Dekan.
    // Their file is downloaded from GET /sk-skripsi-lanjutan/:skripsiId/file (sumber tells them apart).
    if (!filterByStatus || statusParam === "COMPLETED") {
      const [lanjutanRows] = await db.query(
        `SELECT
           l.id,
           'SK_SKRIPSI_LANJUTAN' AS sumber,
           'SKRIPSI' AS jenis_sk,
           s.outline_id,
           'COMPLETED' AS status,
           l.forwarded_at AS submitted_at,
           l.completed_at,
           l.created_at,
           m.nama AS nama_mahasiswa,
           l.judul_skripsi,
           ps.nama AS program_studi_nama,
           s.program_studi_id,
           s.id AS skripsi_id,
           1 AS has_sk_document,
           EXISTS(
             SELECT 1 FROM revisi_pasca_sidang rps
             JOIN sidang sd ON sd.id = rps.sidang_id
             JOIN revisi_pasca_sidang_files rf ON rf.revisi_id = rps.id AND rf.file_type = 'HALAMAN_PENGESAHAN_DEKAN'
             WHERE sd.jenis = 'SKRIPSI' AND sd.skripsi_id = s.id
           ) AS has_halaman_pengesahan
         FROM pengajuan_sk_skripsi_lanjutan l
         JOIN skripsi s ON s.id = l.skripsi_id
         JOIN mahasiswa m ON m.npm = s.npm
         JOIN program_studi ps ON ps.id = s.program_studi_id
         WHERE l.status = 'COMPLETED'
           AND ps.fakultas_id IN (?)`,
        [fakultasIds],
      );
      rows.push(...lanjutanRows);
      rows.sort(
        (a, b) =>
          new Date(b.submitted_at ?? 0).getTime() -
          new Date(a.submitted_at ?? 0).getTime(),
      );
    }

    return res.json({ ok: true, data: rows });
  } catch (err) {
    next(err);
  }
};
