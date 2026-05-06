const db = require("../db");

async function getStudentNpm(userId) {
  const [rows] = await db.query(
    `SELECT npm FROM users WHERE id = ? AND is_active = 1 LIMIT 1`,
    [userId],
  );
  return rows[0]?.npm ?? null;
}

const VALID_FILE_TYPES = [
  "KRS",
  "REKAP_NILAI",
  "KARTU_KONSULTASI_OUTLINE",
  "FILE_OUTLINE",
  "HALAMAN_PERSETUJUAN",
  "SK_PENELITIAN",
];

const VALID_SK_STATUSES = [
  "DRAFT",
  "SUBMITTED",
  "VERIFIED",
  "REJECTED",
  "COMPLETED",
];

async function upsertSkFile(
  conn,
  skPenelitianId,
  fileType,
  fileName,
  mimeType,
  fileContent,
  source,
) {
  await conn.query(
    `DELETE FROM pengajuan_sk_penelitian_files WHERE pengajuan_sk_penelitian_id = ? AND file_type = ?`,
    [skPenelitianId, fileType],
  );
  await conn.query(
    `INSERT INTO pengajuan_sk_penelitian_files
       (pengajuan_sk_penelitian_id, file_type, file_name, mime_type, file_content, source)
     VALUES (?, ?, ?, ?, ?, ?)`,
    [skPenelitianId, fileType, fileName, mimeType ?? null, fileContent, source],
  );
}

exports.initSkPenelitian = async (req, res, next) => {
  try {
    if (req.user.userType !== "STUDENT") {
      return res
        .status(403)
        .json({
          ok: false,
          message: "Only students can initialize SK Penelitian",
        });
    }

    const pengajuanJudulId = Number(req.params.pengajuanJudulId);
    if (!Number.isFinite(pengajuanJudulId) || pengajuanJudulId <= 0) {
      return res
        .status(400)
        .json({ ok: false, message: "Invalid pengajuanJudulId" });
    }

    const npm = await getStudentNpm(req.user.id);
    if (!npm) {
      return res
        .status(400)
        .json({ ok: false, message: "Mahasiswa tidak valid" });
    }

    const [pjRows] = await db.query(
      `SELECT id FROM pengajuan_judul WHERE id = ? LIMIT 1`,
      [pengajuanJudulId],
    );
    if (pjRows.length === 0) {
      return res
        .status(404)
        .json({ ok: false, message: "Pengajuan judul tidak ditemukan" });
    }

    const [halamanRows] = await db.query(
      `SELECT id FROM halaman_persetujuan_judul WHERE pengajuan_judul_id = ? AND status = 'COMPLETED' LIMIT 1`,
      [pengajuanJudulId],
    );
    if (halamanRows.length === 0) {
      return res
        .status(400)
        .json({
          ok: false,
          message: "Halaman persetujuan judul belum selesai",
        });
    }

    const [existingRows] = await db.query(
      `SELECT id FROM pengajuan_sk_penelitian WHERE pengajuan_judul_id = ? LIMIT 1`,
      [pengajuanJudulId],
    );
    if (existingRows.length > 0) {
      return res
        .status(409)
        .json({ ok: false, message: "SK Penelitian sudah dibuat" });
    }

    const [ins] = await db.query(
      `INSERT INTO pengajuan_sk_penelitian (pengajuan_judul_id, status) VALUES (?, 'DRAFT')`,
      [pengajuanJudulId],
    );

    return res.status(201).json({
      ok: true,
      message: "SK Penelitian dibuat",
      data: { id: ins.insertId },
    });
  } catch (err) {
    next(err);
  }
};

exports.getSkPenelitian = async (req, res, next) => {
  try {
    const pengajuanJudulId = Number(req.params.pengajuanJudulId);
    if (!Number.isFinite(pengajuanJudulId) || pengajuanJudulId <= 0) {
      return res
        .status(400)
        .json({ ok: false, message: "Invalid pengajuanJudulId" });
    }

    const [skRows] = await db.query(
      `SELECT
         sk.*,
         k.nama_mahasiswa,
         k.judul_skripsi,
         k.program_studi_nama
       FROM pengajuan_sk_penelitian sk
       LEFT JOIN kartu_konsultasi_outline k ON k.pengajuan_judul_id = sk.pengajuan_judul_id
       WHERE sk.pengajuan_judul_id = ?
       LIMIT 1`,
      [pengajuanJudulId],
    );
    const sk = skRows[0] ?? null;
    if (!sk) {
      return res
        .status(404)
        .json({ ok: false, message: "SK Penelitian tidak ditemukan" });
    }

    const [files] = await db.query(
      `SELECT id, file_type, file_name, mime_type, source, status, created_at
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
        .json({ ok: false, message: "Only students can submit SK Penelitian" });
    }

    const pengajuanJudulId = Number(req.params.pengajuanJudulId);
    if (!Number.isFinite(pengajuanJudulId) || pengajuanJudulId <= 0) {
      return res
        .status(400)
        .json({ ok: false, message: "Invalid pengajuanJudulId" });
    }

    const { rekapNilaiContent, rekapNilaiName, rekapNilaiMimeType } =
      req.body ?? {};
    if (!rekapNilaiContent || !String(rekapNilaiContent).trim()) {
      return res
        .status(400)
        .json({ ok: false, message: "rekapNilaiContent is required" });
    }
    if (!rekapNilaiName || !String(rekapNilaiName).trim()) {
      return res
        .status(400)
        .json({ ok: false, message: "rekapNilaiName is required" });
    }

    await conn.beginTransaction();
    txStarted = true;

    const [skRows] = await conn.query(
      `SELECT * FROM pengajuan_sk_penelitian WHERE pengajuan_judul_id = ? LIMIT 1 FOR UPDATE`,
      [pengajuanJudulId],
    );
    const sk = skRows[0] ?? null;
    if (!sk) {
      await conn.rollback();
      txStarted = false;
      return res
        .status(404)
        .json({ ok: false, message: "SK Penelitian tidak ditemukan" });
    }
    if (sk.status !== "DRAFT") {
      await conn.rollback();
      txStarted = false;
      return res
        .status(409)
        .json({
          ok: false,
          message: "SK Penelitian hanya bisa disubmit saat status DRAFT",
        });
    }

    // System-pull KRS
    const [krsRows] = await conn.query(
      `SELECT file_content, file_name FROM pengajuan_judul_file WHERE pengajuan_judul_id = ? AND file_type = 'KRS' LIMIT 1`,
      [pengajuanJudulId],
    );
    if (krsRows.length === 0) {
      await conn.rollback();
      txStarted = false;
      return res
        .status(400)
        .json({
          ok: false,
          message: "File KRS tidak ditemukan pada pengajuan judul",
        });
    }
    const krsRow = krsRows[0];

    // Resolve kartu_id
    const [kartuRows] = await conn.query(
      `SELECT id FROM kartu_konsultasi_outline WHERE pengajuan_judul_id = ? LIMIT 1`,
      [pengajuanJudulId],
    );
    if (kartuRows.length === 0) {
      await conn.rollback();
      txStarted = false;
      return res
        .status(400)
        .json({
          ok: false,
          message: "Kartu konsultasi outline tidak ditemukan",
        });
    }
    const kartuId = kartuRows[0].id;

    // System-pull Kartu Konsultasi Outline DOCX
    const [kartuFileRows] = await conn.query(
      `SELECT file_content, file_name, mime_type
       FROM kartu_konsultasi_outline_file
       WHERE kartu_konsultasi_outline_id = ? AND file_type = 'FINAL_DOCX' AND is_active = 1
       ORDER BY generated_at DESC
       LIMIT 1`,
      [kartuId],
    );
    if (kartuFileRows.length === 0) {
      await conn.rollback();
      txStarted = false;
      return res
        .status(400)
        .json({
          ok: false,
          message: "File kartu konsultasi outline belum digenerate",
        });
    }
    const kartuFile = kartuFileRows[0];

    // System-pull File Outline Skripsi (latest submission)
    const [outlineRows] = await conn.query(
      `SELECT s.file_outline, s.file_outline_name
       FROM konsultasi_outline_submission s
       INNER JOIN konsultasi_outline_stage st ON st.id = s.konsultasi_outline_stage_id
       WHERE st.kartu_konsultasi_outline_id = ?
       ORDER BY s.submitted_at DESC
       LIMIT 1`,
      [kartuId],
    );
    if (outlineRows.length === 0) {
      await conn.rollback();
      txStarted = false;
      return res
        .status(400)
        .json({ ok: false, message: "File outline skripsi tidak ditemukan" });
    }
    const outlineRow = outlineRows[0];

    // System-pull Halaman Persetujuan file
    const [halamanFileRows] = await conn.query(
      `SELECT f.file_content, f.file_name, f.mime_type
       FROM halaman_persetujuan_judul_file f
       INNER JOIN halaman_persetujuan_judul h ON h.id = f.halaman_persetujuan_judul_id
       WHERE h.pengajuan_judul_id = ?
       ORDER BY f.generated_at DESC
       LIMIT 1`,
      [pengajuanJudulId],
    );
    if (halamanFileRows.length === 0) {
      await conn.rollback();
      txStarted = false;
      return res
        .status(400)
        .json({
          ok: false,
          message: "File halaman persetujuan tidak ditemukan",
        });
    }
    const halamanFile = halamanFileRows[0];

    // Upsert all 5 files
    await upsertSkFile(
      conn,
      sk.id,
      "REKAP_NILAI",
      String(rekapNilaiName).trim(),
      rekapNilaiMimeType ?? "application/octet-stream",
      String(rekapNilaiContent),
      "UPLOADED",
    );
    await upsertSkFile(
      conn,
      sk.id,
      "KRS",
      krsRow.file_name,
      "application/octet-stream",
      krsRow.file_content,
      "SYSTEM",
    );
    await upsertSkFile(
      conn,
      sk.id,
      "KARTU_KONSULTASI_OUTLINE",
      kartuFile.file_name,
      kartuFile.mime_type ?? "application/octet-stream",
      kartuFile.file_content,
      "SYSTEM",
    );
    await upsertSkFile(
      conn,
      sk.id,
      "FILE_OUTLINE",
      outlineRow.file_outline_name,
      "application/octet-stream",
      outlineRow.file_outline,
      "SYSTEM",
    );
    await upsertSkFile(
      conn,
      sk.id,
      "HALAMAN_PERSETUJUAN",
      halamanFile.file_name,
      halamanFile.mime_type ?? "application/octet-stream",
      halamanFile.file_content,
      "SYSTEM",
    );

    await conn.query(
      `UPDATE pengajuan_sk_penelitian
       SET status = 'SUBMITTED', submitted_at = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP
       WHERE id = ?`,
      [sk.id],
    );

    await conn.commit();
    txStarted = false;

    return res.json({ ok: true, message: "SK Penelitian berhasil disubmit" });
  } catch (err) {
    try {
      if (txStarted) await conn.rollback();
    } catch (_) {}
    next(err);
  } finally {
    conn.release();
  }
};

const REQUIRED_FILE_TYPES = [
  "KRS",
  "REKAP_NILAI",
  "KARTU_KONSULTASI_OUTLINE",
  "FILE_OUTLINE",
  "HALAMAN_PERSETUJUAN",
];
const VALID_FILE_STATUSES = ["SUBMITTED", "NEED_REUPLOAD", "VERIFIED"];

exports.reviewSkPenelitian = async (req, res, next) => {
  const conn = await db.getConnection();
  let txStarted = false;
  try {
    if (!req.user.hasRole("SEKRETARIAT")) {
      return res
        .status(403)
        .json({ ok: false, message: "Only sekretariat can review SK Penelitian" });
    }

    const pengajuanJudulId = Number(req.params.pengajuanJudulId);
    if (!Number.isFinite(pengajuanJudulId) || pengajuanJudulId <= 0) {
      return res
        .status(400)
        .json({ ok: false, message: "Invalid pengajuanJudulId" });
    }

    const { action, catatanSekretariat, files } = req.body ?? {};

    if (action !== "VERIFY" && action !== "REJECT" && action !== "NEED_REVISION") {
      return res
        .status(400)
        .json({ ok: false, message: "action harus 'VERIFY', 'REJECT', atau 'NEED_REVISION'" });
    }
    if (
      (action === "REJECT" || action === "NEED_REVISION") &&
      (!catatanSekretariat || !String(catatanSekretariat).trim())
    ) {
      return res
        .status(400)
        .json({ ok: false, message: "catatanSekretariat wajib diisi" });
    }

    if (!Array.isArray(files) || files.length !== 5) {
      return res
        .status(400)
        .json({ ok: false, message: "files harus berisi tepat 5 entri" });
    }
    const fileTypes = files.map((f) => f?.fileType);
    const missingTypes = REQUIRED_FILE_TYPES.filter((t) => !fileTypes.includes(t));
    if (missingTypes.length > 0) {
      return res.status(400).json({
        ok: false,
        message: `fileType berikut tidak ada: ${missingTypes.join(", ")}`,
      });
    }
    if (new Set(fileTypes).size !== fileTypes.length) {
      return res
        .status(400)
        .json({ ok: false, message: "fileType tidak boleh duplikat" });
    }
    for (const f of files) {
      if (!VALID_FILE_STATUSES.includes(f?.status)) {
        return res.status(400).json({
          ok: false,
          message: `status tidak valid untuk ${f?.fileType}. Harus salah satu dari: ${VALID_FILE_STATUSES.join(", ")}`,
        });
      }
    }
    if (action === "VERIFY" && files.some((f) => f.status !== "VERIFIED")) {
      return res.status(400).json({
        ok: false,
        message: "Semua 5 file harus berstatus VERIFIED untuk melakukan VERIFY",
      });
    }

    await conn.beginTransaction();
    txStarted = true;

    const [skRows] = await conn.query(
      `SELECT * FROM pengajuan_sk_penelitian WHERE pengajuan_judul_id = ? LIMIT 1 FOR UPDATE`,
      [pengajuanJudulId],
    );
    const sk = skRows[0] ?? null;
    if (!sk) {
      await conn.rollback();
      txStarted = false;
      return res
        .status(404)
        .json({ ok: false, message: "SK Penelitian tidak ditemukan" });
    }
    if (sk.status !== "SUBMITTED") {
      await conn.rollback();
      txStarted = false;
      return res.status(409).json({
        ok: false,
        message: "SK Penelitian harus berstatus SUBMITTED untuk diverifikasi",
      });
    }

    for (const f of files) {
      await conn.query(
        `UPDATE pengajuan_sk_penelitian_files SET status = ? WHERE pengajuan_sk_penelitian_id = ? AND file_type = ?`,
        [f.status, sk.id, f.fileType],
      );
    }

    if (action === "NEED_REVISION") {
      await conn.query(
        `UPDATE pengajuan_sk_penelitian
         SET status = 'NEED_REVISION',
             catatan_sekretariat = ?,
             updated_at = CURRENT_TIMESTAMP
         WHERE id = ?`,
        [String(catatanSekretariat).trim(), sk.id],
      );
      await conn.commit();
      txStarted = false;
      return res.json({ ok: true, message: "SK Penelitian dikembalikan untuk revisi" });
    }

    if (action === "REJECT") {
      await conn.query(
        `UPDATE pengajuan_sk_penelitian
         SET status = 'REJECTED',
             catatan_sekretariat = ?,
             verified_by_user_id = ?,
             verified_at = CURRENT_TIMESTAMP,
             updated_at = CURRENT_TIMESTAMP
         WHERE id = ?`,
        [String(catatanSekretariat).trim(), req.user.id, sk.id],
      );
      await conn.commit();
      txStarted = false;
      return res.json({ ok: true, message: "SK Penelitian ditolak" });
    }

    // VERIFY — set COMPLETED (SK DOCX generation deferred until template is ready)
    await conn.query(
      `UPDATE pengajuan_sk_penelitian
       SET status = 'COMPLETED',
           catatan_sekretariat = ?,
           verified_by_user_id = ?,
           verified_at = CURRENT_TIMESTAMP,
           completed_at = CURRENT_TIMESTAMP,
           updated_at = CURRENT_TIMESTAMP
       WHERE id = ?`,
      [
        catatanSekretariat ? String(catatanSekretariat).trim() : null,
        req.user.id,
        sk.id,
      ],
    );

    await conn.commit();
    txStarted = false;

    return res.json({ ok: true, message: "SK Penelitian diverifikasi dan diselesaikan" });
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
      return res
        .status(403)
        .json({ ok: false, message: "Only students can resubmit SK Penelitian" });
    }

    const pengajuanJudulId = Number(req.params.pengajuanJudulId);
    if (!Number.isFinite(pengajuanJudulId) || pengajuanJudulId <= 0) {
      return res
        .status(400)
        .json({ ok: false, message: "Invalid pengajuanJudulId" });
    }

    const { files } = req.body ?? {};
    if (!Array.isArray(files) || files.length === 0) {
      return res
        .status(400)
        .json({ ok: false, message: "files harus berisi minimal 1 entri" });
    }
    for (const f of files) {
      if (!f?.fileType || !String(f.fileType).trim()) {
        return res.status(400).json({ ok: false, message: "Setiap file harus memiliki fileType" });
      }
      if (!VALID_FILE_TYPES.includes(f.fileType)) {
        return res.status(400).json({
          ok: false,
          message: `fileType tidak valid: ${f.fileType}. Harus salah satu dari: ${VALID_FILE_TYPES.join(", ")}`,
        });
      }
      if (!f?.content || !String(f.content).trim()) {
        return res.status(400).json({ ok: false, message: `content wajib diisi untuk ${f.fileType}` });
      }
      if (!f?.name || !String(f.name).trim()) {
        return res.status(400).json({ ok: false, message: `name wajib diisi untuk ${f.fileType}` });
      }
    }
    const fileTypes = files.map((f) => f.fileType);
    if (new Set(fileTypes).size !== fileTypes.length) {
      return res
        .status(400)
        .json({ ok: false, message: "fileType tidak boleh duplikat" });
    }

    await conn.beginTransaction();
    txStarted = true;

    const [skRows] = await conn.query(
      `SELECT * FROM pengajuan_sk_penelitian WHERE pengajuan_judul_id = ? LIMIT 1 FOR UPDATE`,
      [pengajuanJudulId],
    );
    const sk = skRows[0] ?? null;
    if (!sk) {
      await conn.rollback();
      txStarted = false;
      return res
        .status(404)
        .json({ ok: false, message: "SK Penelitian tidak ditemukan" });
    }
    if (sk.status !== "NEED_REVISION") {
      await conn.rollback();
      txStarted = false;
      return res.status(409).json({
        ok: false,
        message: "SK Penelitian harus berstatus NEED_REVISION untuk resubmit",
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
      await upsertSkFile(
        conn,
        sk.id,
        f.fileType,
        String(f.name).trim(),
        f.mimeType ?? "application/octet-stream",
        String(f.content),
        "UPLOADED",
      );
    }

    await conn.query(
      `UPDATE pengajuan_sk_penelitian SET status = 'SUBMITTED', updated_at = CURRENT_TIMESTAMP WHERE id = ?`,
      [sk.id],
    );

    await conn.commit();
    txStarted = false;

    return res.json({ ok: true, message: "File berhasil diresubmit" });
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
    const pengajuanJudulId = Number(req.params.pengajuanJudulId);
    if (!Number.isFinite(pengajuanJudulId) || pengajuanJudulId <= 0) {
      return res
        .status(400)
        .json({ ok: false, message: "Invalid pengajuanJudulId" });
    }

    const fileType = req.params.fileType;
    if (!VALID_FILE_TYPES.includes(fileType)) {
      return res.status(400).json({
        ok: false,
        message: `fileType tidak valid. Harus salah satu dari: ${VALID_FILE_TYPES.join(", ")}`,
      });
    }

    const [skRows] = await db.query(
      `SELECT id FROM pengajuan_sk_penelitian WHERE pengajuan_judul_id = ? LIMIT 1`,
      [pengajuanJudulId],
    );
    const sk = skRows[0] ?? null;
    if (!sk) {
      return res
        .status(404)
        .json({ ok: false, message: "SK Penelitian tidak ditemukan" });
    }

    const [fileRows] = await db.query(
      `SELECT id, file_type, file_name, mime_type, file_content, source, created_at
       FROM pengajuan_sk_penelitian_files
       WHERE pengajuan_sk_penelitian_id = ? AND file_type = ?
       ORDER BY created_at DESC
       LIMIT 1`,
      [sk.id, fileType],
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

exports.listSkForSekretariat = async (req, res, next) => {
  try {
    if (!req.user.hasRole("SEKRETARIAT")) {
      return res
        .status(403)
        .json({
          ok: false,
          message: "Only sekretariat can access this endpoint",
        });
    }

    const statusParam = req.query?.status;
    const status =
      statusParam && VALID_SK_STATUSES.includes(statusParam)
        ? statusParam
        : "SUBMITTED";

    const [rows] = await db.query(
      `SELECT
         sk.id,
         sk.pengajuan_judul_id,
         sk.status,
         sk.catatan_sekretariat,
         sk.submitted_at,
         sk.verified_at,
         sk.completed_at,
         sk.created_at,
         k.nama_mahasiswa,
         k.judul_skripsi,
         k.program_studi_nama
       FROM pengajuan_sk_penelitian sk
       LEFT JOIN kartu_konsultasi_outline k ON k.pengajuan_judul_id = sk.pengajuan_judul_id
       WHERE sk.status = ?
       ORDER BY sk.submitted_at DESC`,
      [status],
    );

    return res.json({ ok: true, data: rows });
  } catch (err) {
    next(err);
  }
};

