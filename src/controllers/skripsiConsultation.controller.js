const db = require("../db");
const path = require("path");
const { readFile } = require("fs/promises");
const { patchDocument, PatchType, TextRun, ImageRun } = require("docx");

const CHAPTER_ORDER = ["BAB_1_2", "BAB_3", "BAB_4", "BAB_5"];

function nextChapterGroup(current) {
  const idx = CHAPTER_ORDER.indexOf(current);
  return idx >= 0 && idx < CHAPTER_ORDER.length - 1 ? CHAPTER_ORDER[idx + 1] : null;
}

async function getStudentNpm(userId) {
  const [rows] = await db.query(
    `SELECT npm FROM users WHERE id = ? AND is_active = 1 LIMIT 1`,
    [userId]
  );
  return rows[0]?.npm ?? null;
}

async function getLecturerNidn(userId) {
  const [rows] = await db.query(
    `SELECT nidn FROM users WHERE id = ? AND is_active = 1 LIMIT 1`,
    [userId]
  );
  return rows[0]?.nidn ?? null;
}

async function getKaprodiProgramStudiIdsByNidn(nidn) {
  const [rows] = await db.query(
    `SELECT id FROM program_studi WHERE kaprodi_nidn = ?`,
    [nidn]
  );
  return rows.map((r) => Number(r.id)).filter((id) => Number.isFinite(id) && id > 0);
}

function hasRole(req, role) {
  return typeof req.user?.hasRole === "function" && req.user.hasRole(role);
}

function textPatch(value) {
  return {
    type: PatchType.PARAGRAPH,
    children: [new TextRun(String(value ?? ""))],
  };
}

function decodeSignatureToBuffer(signatureValue) {
  if (signatureValue === undefined || signatureValue === null) return null;
  const raw = String(signatureValue).trim();
  if (!raw) return null;
  const dataUrlMatch = raw.match(/^data:image\/[a-zA-Z0-9.+-]+;base64,(.+)$/i);
  if (dataUrlMatch?.[1]) {
    try { return Buffer.from(dataUrlMatch[1], "base64"); } catch (_) { return null; }
  }
  const normalized = raw.replace(/\s+/g, "");
  const looksLikeBase64 = /^[A-Za-z0-9+/=]+$/.test(normalized) && normalized.length % 4 === 0;
  if (looksLikeBase64) {
    try { return Buffer.from(normalized, "base64"); } catch (_) { return null; }
  }
  return null;
}

function signatureImagePatch(signatureValue) {
  const buf = decodeSignatureToBuffer(signatureValue);
  if (!buf || buf.length === 0) return textPatch("");
  try {
    return {
      type: PatchType.PARAGRAPH,
      children: [new ImageRun({ data: buf, transformation: { width: 120, height: 50 } })],
    };
  } catch (_) {
    return textPatch("");
  }
}

function formatKartuDate(value) {
  if (!value) return "";
  return new Intl.DateTimeFormat("id-ID", {
    day: "2-digit", month: "long", year: "numeric", timeZone: "Asia/Jakarta",
  }).format(new Date(value));
}

function getChapterGroupLabel(chapterGroup) {
  const map = { BAB_1_2: "Bab 1 & 2", BAB_3: "Bab 3", BAB_4: "Bab 4", BAB_5: "Bab 5" };
  return map[chapterGroup] ?? chapterGroup ?? "";
}

function getStageLabel(stage) {
  if (stage === "PEMBIMBING_2") return "Pembimbing 2";
  if (stage === "PEMBIMBING_1") return "Pembimbing 1";
  return stage ?? "";
}

function getDecisionLabel(status) {
  if (status === "NEED_REVISION") return "Perlu Revisi";
  if (status === "CONTINUE") return "Lanjut ke Pembimbing 1";
  if (status === "ACCEPTED") return "Diterima";
  return status ?? "";
}

function canReviewStageStatus(stageStatus) {
  return stageStatus === "SUBMITTED" || stageStatus === "IN_REVIEW";
}

function resolveActiveStage(stages) {
  for (const chapterGroup of CHAPTER_ORDER) {
    const p2 = stages.find((s) => s.chapter_group === chapterGroup && s.stage === "PEMBIMBING_2") ?? null;
    const p1 = stages.find((s) => s.chapter_group === chapterGroup && s.stage === "PEMBIMBING_1") ?? null;

    if (!p2) continue;
    if (p2.current_status !== "CONTINUE") {
      return { chapterGroup, activeStage: "PEMBIMBING_2", activeStatus: p2.current_status, stageRow: p2 };
    }
    if (!p1) {
      return { chapterGroup, activeStage: null, activeStatus: null, stageRow: null };
    }
    if (p1.current_status !== "ACCEPTED") {
      return { chapterGroup, activeStage: "PEMBIMBING_1", activeStatus: p1.current_status, stageRow: p1 };
    }
  }
  return { chapterGroup: null, activeStage: null, activeStatus: null, stageRow: null };
}

async function getKartuLogs(queryable, kartuId) {
  const [logs] = await queryable.query(
    `SELECT chapter_group, stage, submission_no, reviewer_nidn, reviewer_nama, status, catatan_kartu, logged_at
     FROM kartu_konsultasi_skripsi_log
     WHERE kartu_konsultasi_skripsi_id = ?
     ORDER BY logged_at ASC, id ASC`,
    [kartuId]
  );
  return logs;
}

async function buildKartuKonsultasiSkripsiDocxBuffer(kartu, logs) {
  const templatePath = path.join(
    __dirname, "..", "templates", "template_kartu_konsultasi_skripsi.docx"
  );
  const templateBuffer = await readFile(templatePath);

  const patches = {
    nama_mahasiswa: textPatch(kartu.nama_mahasiswa),
    npm: textPatch(kartu.npm),
    program_studi: textPatch(kartu.program_studi_nama),
    judul_skripsi: textPatch(kartu.judul_skripsi),
    pembimbing1: textPatch(kartu.pembimbing1_nama),
    pembimbing2: textPatch(kartu.pembimbing2_nama),
    ttd_pembimbing1: signatureImagePatch(kartu.pembimbing1_signature),
    ttd_pembimbing2: signatureImagePatch(kartu.pembimbing2_signature),
  };

  for (let i = 1; i <= 18; i += 1) {
    const log = logs[i - 1];
    const keterangan = log
      ? `${getChapterGroupLabel(log.chapter_group)} - ${getStageLabel(log.stage)} - ${getDecisionLabel(log.status)}: ${log.catatan_kartu ?? ""}`
      : "";
    patches[`tanggal_${i}`] = textPatch(log ? formatKartuDate(log.logged_at) : "");
    patches[`keterangan_${i}`] = textPatch(keterangan);
    patches[`paraf_${i}`] = textPatch(log?.reviewer_nama ?? "");
  }

  return patchDocument({ outputType: "nodebuffer", data: templateBuffer, patches });
}

async function generateAndStoreFinalKartuDocx(queryable, { kartuId, pengajuanJudulId, generatedByUserId }) {
  const [kartuRows] = await queryable.query(
    `SELECT * FROM kartu_konsultasi_skripsi WHERE id = ? LIMIT 1`,
    [kartuId]
  );
  const kartu = kartuRows[0] ?? null;
  if (!kartu) {
    const err = new Error("Kartu not found");
    err.statusCode = 404;
    throw err;
  }

  const logs = await getKartuLogs(queryable, kartuId);
  const outputBuffer = await buildKartuKonsultasiSkripsiDocxBuffer(kartu, logs);
  const fileName = `kartu-konsultasi-skripsi-${pengajuanJudulId}-${Date.now()}.docx`;

  await queryable.query(
    `UPDATE kartu_konsultasi_skripsi_file
     SET is_active = 0
     WHERE kartu_konsultasi_skripsi_id = ? AND file_type = 'FINAL_DOCX' AND is_active = 1`,
    [kartuId]
  );

  const [ins] = await queryable.query(
    `INSERT INTO kartu_konsultasi_skripsi_file (
       kartu_konsultasi_skripsi_id, file_type, file_content, file_name,
       generated_by_user_id, generated_at, is_active
     ) VALUES (?, 'FINAL_DOCX', ?, ?, ?, CURRENT_TIMESTAMP, 1)`,
    [kartuId, outputBuffer.toString("base64"), fileName, generatedByUserId]
  );

  return { id: ins.insertId, kartuId, fileType: "FINAL_DOCX", fileName };
}

exports.initKartu = async (req, res, next) => {
  const conn = await db.getConnection();
  let txStarted = false;
  try {
    if (req.user.userType !== "STUDENT") {
      return res.status(403).json({ ok: false, message: "Only students" });
    }

    const pengajuanJudulId = Number(req.params.pengajuanJudulId);
    if (!Number.isFinite(pengajuanJudulId) || pengajuanJudulId <= 0) {
      return res.status(400).json({ ok: false, message: "Invalid pengajuanJudulId" });
    }

    const npm = await getStudentNpm(req.user.id);
    if (!npm) {
      return res.status(400).json({ ok: false, message: "Mahasiswa tidak valid" });
    }

    await conn.beginTransaction();
    txStarted = true;

    const [skRows] = await conn.query(
      `SELECT psk.id, psk.status
       FROM pengajuan_sk_penelitian psk
       INNER JOIN mahasiswa m ON m.npm = ?
       WHERE psk.pengajuan_judul_id = ? AND psk.status = 'COMPLETED'
       LIMIT 1`,
      [npm, pengajuanJudulId]
    );
    if (skRows.length === 0) {
      await conn.rollback();
      txStarted = false;
      return res.status(409).json({
        ok: false,
        message: "SK Penelitian must be COMPLETED before starting Konsultasi Skripsi",
      });
    }

    const [existingKartu] = await conn.query(
      `SELECT id FROM kartu_konsultasi_skripsi WHERE pengajuan_judul_id = ? LIMIT 1`,
      [pengajuanJudulId]
    );
    if (existingKartu.length > 0) {
      await conn.rollback();
      txStarted = false;
      return res.status(409).json({ ok: false, message: "Kartu konsultasi skripsi already exists" });
    }

    const [pjRows] = await conn.query(
      `SELECT
         pj.id,
         pj.pembimbing1_ditetapkan_nidn,
         pj.pembimbing2_ditetapkan_nidn,
         pj.judul,
         m.nama AS nama_mahasiswa,
         m.program_studi_id,
         ps.nama AS program_studi_nama,
         d1.nama AS pembimbing1_nama,
         d2.nama AS pembimbing2_nama
       FROM pengajuan_judul pj
       INNER JOIN mahasiswa m ON m.npm = ?
       INNER JOIN program_studi ps ON ps.id = m.program_studi_id
       LEFT JOIN dosen d1 ON d1.nidn = pj.pembimbing1_ditetapkan_nidn
       LEFT JOIN dosen d2 ON d2.nidn = pj.pembimbing2_ditetapkan_nidn
       WHERE pj.id = ?
       LIMIT 1`,
      [npm, pengajuanJudulId]
    );
    const pj = pjRows[0] ?? null;
    if (!pj) {
      await conn.rollback();
      txStarted = false;
      return res.status(404).json({ ok: false, message: "Pengajuan judul not found" });
    }
    if (!pj.pembimbing1_ditetapkan_nidn || !pj.pembimbing2_ditetapkan_nidn) {
      await conn.rollback();
      txStarted = false;
      return res.status(409).json({ ok: false, message: "Both pembimbing must be assigned" });
    }

    const [kartuIns] = await conn.query(
      `INSERT INTO kartu_konsultasi_skripsi (
         pengajuan_judul_id, nama_mahasiswa, npm, program_studi_id, program_studi_nama,
         judul_skripsi, pembimbing1_nidn, pembimbing1_nama, pembimbing2_nidn, pembimbing2_nama
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        pengajuanJudulId,
        pj.nama_mahasiswa,
        npm,
        pj.program_studi_id,
        pj.program_studi_nama,
        pj.judul,
        pj.pembimbing1_ditetapkan_nidn,
        pj.pembimbing1_nama,
        pj.pembimbing2_ditetapkan_nidn,
        pj.pembimbing2_nama,
      ]
    );
    const kartuId = kartuIns.insertId;

    await conn.query(
      `INSERT INTO konsultasi_skripsi_stage (
         kartu_konsultasi_skripsi_id, pengajuan_judul_id, chapter_group, stage,
         pembimbing_nidn, current_status, current_submission_no, started_at
       ) VALUES (?, ?, 'BAB_1_2', 'PEMBIMBING_2', ?, 'WAITING_SUBMISSION', 0, CURRENT_TIMESTAMP)`,
      [kartuId, pengajuanJudulId, pj.pembimbing2_ditetapkan_nidn]
    );

    await conn.commit();
    txStarted = false;

    return res.status(201).json({
      ok: true,
      message: "Kartu konsultasi skripsi initialized",
      data: { kartuId, pengajuanJudulId },
    });
  } catch (err) {
    try { if (txStarted) await conn.rollback(); } catch (_) {}
    next(err);
  } finally {
    conn.release();
  }
};

exports.getMyDetail = async (req, res, next) => {
  try {
    if (req.user.userType !== "STUDENT") {
      return res.status(403).json({ ok: false, message: "Only students" });
    }

    const pengajuanJudulId = Number(req.params.pengajuanJudulId);
    if (!Number.isFinite(pengajuanJudulId) || pengajuanJudulId <= 0) {
      return res.status(400).json({ ok: false, message: "Invalid pengajuanJudulId" });
    }

    const npm = await getStudentNpm(req.user.id);
    if (!npm) {
      return res.status(400).json({ ok: false, message: "Mahasiswa tidak valid" });
    }

    const [kartuRows] = await db.query(
      `SELECT * FROM kartu_konsultasi_skripsi WHERE pengajuan_judul_id = ? AND npm = ? LIMIT 1`,
      [pengajuanJudulId, npm]
    );
    const kartu = kartuRows[0] ?? null;
    if (!kartu) {
      return res.status(404).json({ ok: false, message: "Consultation not found" });
    }

    const [stages] = await db.query(
      `SELECT * FROM konsultasi_skripsi_stage
       WHERE kartu_konsultasi_skripsi_id = ?
       ORDER BY FIELD(chapter_group, 'BAB_1_2','BAB_3','BAB_4','BAB_5') ASC,
                CASE stage WHEN 'PEMBIMBING_2' THEN 1 WHEN 'PEMBIMBING_1' THEN 2 ELSE 3 END ASC`,
      [kartu.id]
    );

    const [submissions] = await db.query(
      `SELECT
         s.id, s.konsultasi_skripsi_stage_id, st.chapter_group, st.stage,
         s.submission_no, s.file_name, s.submitted_at
       FROM konsultasi_skripsi_submission s
       INNER JOIN konsultasi_skripsi_stage st ON st.id = s.konsultasi_skripsi_stage_id
       WHERE st.kartu_konsultasi_skripsi_id = ?
       ORDER BY s.submitted_at DESC`,
      [kartu.id]
    );

    const [reviews] = await db.query(
      `SELECT
         r.id, r.konsultasi_skripsi_stage_id, st.chapter_group, st.stage,
         r.submission_no, r.decision_status, r.catatan_mahasiswa, r.reviewed_at,
         CASE WHEN rf.id IS NULL THEN 0 ELSE 1 END AS has_review_file,
         rf.id AS review_file_id, rf.file_name AS review_file_name
       FROM konsultasi_skripsi_review r
       INNER JOIN konsultasi_skripsi_stage st ON st.id = r.konsultasi_skripsi_stage_id
       LEFT JOIN konsultasi_skripsi_review_file rf ON rf.konsultasi_skripsi_review_id = r.id
       WHERE st.kartu_konsultasi_skripsi_id = ?
       ORDER BY r.reviewed_at DESC`,
      [kartu.id]
    );

    const resolved = resolveActiveStage(stages);

    return res.json({
      ok: true,
      data: {
        kartu,
        stages,
        active_chapter_group: resolved.chapterGroup,
        active_stage: resolved.activeStage,
        active_status: resolved.activeStatus,
        submissions,
        reviews,
        isCompleted: Boolean(kartu.is_completed),
      },
    });
  } catch (err) {
    next(err);
  }
};

exports.submitMyChapter = async (req, res, next) => {
  const conn = await db.getConnection();
  let txStarted = false;
  try {
    if (req.user.userType !== "STUDENT") {
      return res.status(403).json({ ok: false, message: "Only students" });
    }

    const pengajuanJudulId = Number(req.params.pengajuanJudulId);
    if (!Number.isFinite(pengajuanJudulId) || pengajuanJudulId <= 0) {
      return res.status(400).json({ ok: false, message: "Invalid pengajuanJudulId" });
    }

    const { fileContent, fileName } = req.body || {};
    const safeFileName = String(fileName ?? "").trim();
    if (!fileContent) {
      return res.status(400).json({ ok: false, message: "fileContent is required" });
    }
    if (!safeFileName) {
      return res.status(400).json({ ok: false, message: "fileName is required" });
    }

    const npm = await getStudentNpm(req.user.id);
    if (!npm) {
      return res.status(400).json({ ok: false, message: "Mahasiswa tidak valid" });
    }

    await conn.beginTransaction();
    txStarted = true;

    const [kartuRows] = await conn.query(
      `SELECT * FROM kartu_konsultasi_skripsi
       WHERE pengajuan_judul_id = ? AND npm = ?
       LIMIT 1 FOR UPDATE`,
      [pengajuanJudulId, npm]
    );
    const kartu = kartuRows[0] ?? null;
    if (!kartu) {
      await conn.rollback();
      txStarted = false;
      return res.status(404).json({ ok: false, message: "Consultation not found" });
    }
    if (Number(kartu.is_completed) === 1) {
      await conn.rollback();
      txStarted = false;
      return res.status(409).json({ ok: false, message: "Consultation is already completed" });
    }

    const [stageRows] = await conn.query(
      `SELECT * FROM konsultasi_skripsi_stage
       WHERE kartu_konsultasi_skripsi_id = ?
       ORDER BY FIELD(chapter_group, 'BAB_1_2','BAB_3','BAB_4','BAB_5') ASC,
                CASE stage WHEN 'PEMBIMBING_2' THEN 1 WHEN 'PEMBIMBING_1' THEN 2 ELSE 3 END ASC
       FOR UPDATE`,
      [kartu.id]
    );

    const resolved = resolveActiveStage(stageRows);
    if (!resolved.stageRow) {
      await conn.rollback();
      txStarted = false;
      return res.status(409).json({ ok: false, message: "No active stage to submit to" });
    }

    const activeStage = resolved.stageRow;
    if (activeStage.current_status === "ACCEPTED" || activeStage.current_status === "CONTINUE") {
      await conn.rollback();
      txStarted = false;
      return res.status(409).json({ ok: false, message: "Active stage is already completed" });
    }

    const nextSubmissionNo = Number(activeStage.current_submission_no || 0) + 1;

    await conn.query(
      `INSERT INTO konsultasi_skripsi_submission (
         konsultasi_skripsi_stage_id, submission_no, file_content, file_name, submitted_by_user_id
       ) VALUES (?, ?, ?, ?, ?)`,
      [activeStage.id, nextSubmissionNo, String(fileContent), safeFileName, req.user.id]
    );

    await conn.query(
      `UPDATE konsultasi_skripsi_stage
       SET current_submission_no = ?, current_status = 'SUBMITTED', updated_at = CURRENT_TIMESTAMP
       WHERE id = ?`,
      [nextSubmissionNo, activeStage.id]
    );

    await conn.commit();
    txStarted = false;

    return res.status(201).json({
      ok: true,
      message: "Submission saved",
      data: {
        stageId: activeStage.id,
        chapterGroup: activeStage.chapter_group,
        stage: activeStage.stage,
        submissionNo: nextSubmissionNo,
      },
    });
  } catch (err) {
    try { if (txStarted) await conn.rollback(); } catch (_) {}
    next(err);
  } finally {
    conn.release();
  }
};

exports.getSubmissionFile = async (req, res, next) => {
  try {
    const submissionId = Number(req.params.submissionId);
    if (!Number.isFinite(submissionId) || submissionId <= 0) {
      return res.status(400).json({ ok: false, message: "Invalid submissionId" });
    }

    const [rows] = await db.query(
      `SELECT
         s.id, s.konsultasi_skripsi_stage_id, s.submission_no,
         s.file_content, s.file_name, s.submitted_at,
         st.chapter_group, st.stage,
         k.npm, k.pembimbing1_nidn, k.pembimbing2_nidn, k.program_studi_id
       FROM konsultasi_skripsi_submission s
       INNER JOIN konsultasi_skripsi_stage st ON st.id = s.konsultasi_skripsi_stage_id
       INNER JOIN kartu_konsultasi_skripsi k ON k.id = st.kartu_konsultasi_skripsi_id
       WHERE s.id = ?
       LIMIT 1`,
      [submissionId]
    );
    const submission = rows[0] ?? null;
    if (!submission) {
      return res.status(404).json({ ok: false, message: "Submission not found" });
    }

    let isAuthorized = false;
    if (req.user.userType === "STUDENT") {
      const npm = await getStudentNpm(req.user.id);
      isAuthorized = Boolean(npm) && npm === submission.npm;
    } else if (req.user.userType === "LECTURER") {
      const nidn = await getLecturerNidn(req.user.id);
      isAuthorized =
        Boolean(nidn) &&
        (nidn === submission.pembimbing1_nidn || nidn === submission.pembimbing2_nidn);
    }

    if (!isAuthorized) {
      return res.status(403).json({ ok: false, message: "Forbidden" });
    }

    return res.json({ ok: true, data: submission });
  } catch (err) {
    next(err);
  }
};

exports.getReviewFile = async (req, res, next) => {
  try {
    const reviewId = Number(req.params.reviewId);
    if (!Number.isFinite(reviewId) || reviewId <= 0) {
      return res.status(400).json({ ok: false, message: "Invalid reviewId" });
    }

    const [rows] = await db.query(
      `SELECT
         rf.id, rf.file_content, rf.file_name, rf.created_at,
         k.npm, k.pembimbing1_nidn, k.pembimbing2_nidn
       FROM konsultasi_skripsi_review_file rf
       INNER JOIN konsultasi_skripsi_review r ON r.id = rf.konsultasi_skripsi_review_id
       INNER JOIN konsultasi_skripsi_stage st ON st.id = r.konsultasi_skripsi_stage_id
       INNER JOIN kartu_konsultasi_skripsi k ON k.id = st.kartu_konsultasi_skripsi_id
       WHERE rf.konsultasi_skripsi_review_id = ?
       LIMIT 1`,
      [reviewId]
    );
    const file = rows[0] ?? null;
    if (!file) {
      return res.status(404).json({ ok: false, message: "Review file not found" });
    }

    let isAuthorized = false;
    if (req.user.userType === "STUDENT") {
      const npm = await getStudentNpm(req.user.id);
      isAuthorized = Boolean(npm) && npm === file.npm;
    } else if (req.user.userType === "LECTURER") {
      const nidn = await getLecturerNidn(req.user.id);
      isAuthorized =
        Boolean(nidn) &&
        (nidn === file.pembimbing1_nidn || nidn === file.pembimbing2_nidn);
    }

    if (!isAuthorized) {
      return res.status(403).json({ ok: false, message: "Forbidden" });
    }

    return res.json({ ok: true, data: file });
  } catch (err) {
    next(err);
  }
};

exports.reviewStageByLecturer = async (req, res, next) => {
  const conn = await db.getConnection();
  let txStarted = false;
  try {
    if (req.user.userType !== "LECTURER") {
      return res.status(403).json({ ok: false, message: "Only lecturers" });
    }

    const stageId = Number(req.params.stageId);
    if (!Number.isFinite(stageId) || stageId <= 0) {
      return res.status(400).json({ ok: false, message: "Invalid stageId" });
    }

    const {
      decisionStatus, catatanMahasiswa, catatanKartu,
      signatureImage, reviewFile, reviewFileName,
    } = req.body || {};

    if (!decisionStatus || !String(catatanMahasiswa || "").trim() || !String(catatanKartu || "").trim()) {
      return res.status(400).json({
        ok: false,
        message: "decisionStatus, catatanMahasiswa, and catatanKartu are required",
      });
    }

    const hasReviewFile = reviewFile !== undefined && reviewFile !== null && String(reviewFile) !== "";
    const safeReviewFileName = String(reviewFileName ?? "").trim();
    if (hasReviewFile && !safeReviewFileName) {
      return res.status(400).json({
        ok: false,
        message: "reviewFileName is required when reviewFile is provided",
      });
    }

    const nidn = await getLecturerNidn(req.user.id);
    if (!nidn) {
      return res.status(400).json({ ok: false, message: "Dosen tidak valid" });
    }

    await conn.beginTransaction();
    txStarted = true;

    const [stageRows] = await conn.query(
      `SELECT s.*, k.id AS kartu_id, k.pembimbing1_nidn, k.pembimbing2_nidn
       FROM konsultasi_skripsi_stage s
       INNER JOIN kartu_konsultasi_skripsi k ON k.id = s.kartu_konsultasi_skripsi_id
       WHERE s.id = ? AND s.pembimbing_nidn = ?
       LIMIT 1 FOR UPDATE`,
      [stageId, nidn]
    );
    const stage = stageRows[0] ?? null;
    if (!stage) {
      await conn.rollback();
      txStarted = false;
      return res.status(404).json({ ok: false, message: "Stage not found" });
    }
    if (!canReviewStageStatus(stage.current_status)) {
      await conn.rollback();
      txStarted = false;
      return res.status(409).json({
        ok: false,
        message: `Stage is not reviewable in status ${stage.current_status}`,
      });
    }

    const allowedP2 = ["NEED_REVISION", "CONTINUE"];
    const allowedP1 = ["NEED_REVISION", "ACCEPTED"];
    const allowed = stage.stage === "PEMBIMBING_2" ? allowedP2 : allowedP1;
    if (!allowed.includes(decisionStatus)) {
      await conn.rollback();
      txStarted = false;
      return res.status(400).json({
        ok: false,
        message: `Decision ${decisionStatus} is not allowed for ${stage.stage}`,
      });
    }

    const signatureImageValue = signatureImage != null ? String(signatureImage) : null;
    const shouldRequireSignature =
      (stage.stage === "PEMBIMBING_2" && decisionStatus === "CONTINUE") ||
      (stage.stage === "PEMBIMBING_1" && decisionStatus === "ACCEPTED");
    if (shouldRequireSignature && (!signatureImageValue || !signatureImageValue.trim())) {
      await conn.rollback();
      txStarted = false;
      return res.status(400).json({ ok: false, message: "signatureImage is required for this decision" });
    }

    const [subRows] = await conn.query(
      `SELECT id, submission_no
       FROM konsultasi_skripsi_submission
       WHERE konsultasi_skripsi_stage_id = ?
       ORDER BY submission_no DESC LIMIT 1 FOR UPDATE`,
      [stageId]
    );
    const latestSubmission = subRows[0] ?? null;
    if (!latestSubmission) {
      await conn.rollback();
      txStarted = false;
      return res.status(409).json({ ok: false, message: "No submission to review" });
    }

    const [existingReview] = await conn.query(
      `SELECT id FROM konsultasi_skripsi_review
       WHERE konsultasi_skripsi_stage_id = ? AND submission_no = ? LIMIT 1`,
      [stageId, latestSubmission.submission_no]
    );
    if (existingReview.length > 0) {
      await conn.rollback();
      txStarted = false;
      return res.status(409).json({ ok: false, message: "Submission already reviewed" });
    }

    const [reviewIns] = await conn.query(
      `INSERT INTO konsultasi_skripsi_review (
         konsultasi_skripsi_stage_id, submission_no, reviewer_user_id,
         decision_status, catatan_mahasiswa, catatan_kartu
       ) VALUES (?, ?, ?, ?, ?, ?)`,
      [
        stageId, latestSubmission.submission_no, req.user.id,
        decisionStatus,
        String(catatanMahasiswa).trim(),
        String(catatanKartu).trim(),
      ]
    );

    if (hasReviewFile) {
      await conn.query(
        `INSERT INTO konsultasi_skripsi_review_file (
           konsultasi_skripsi_review_id, file_content, file_name, uploaded_by_user_id
         ) VALUES (?, ?, ?, ?)`,
        [reviewIns.insertId, String(reviewFile), safeReviewFileName, req.user.id]
      );
    }

    const [reviewerRows] = await conn.query(
      `SELECT nama FROM dosen WHERE nidn = ? LIMIT 1`,
      [nidn]
    );
    const reviewerNama = reviewerRows[0]?.nama ?? null;

    await conn.query(
      `INSERT INTO kartu_konsultasi_skripsi_log (
         kartu_konsultasi_skripsi_id, konsultasi_skripsi_stage_id, konsultasi_skripsi_review_id,
         chapter_group, stage, submission_no, reviewer_nidn, reviewer_nama, status, catatan_kartu, logged_at
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)`,
      [
        stage.kartu_id, stageId, reviewIns.insertId,
        stage.chapter_group, stage.stage, latestSubmission.submission_no,
        nidn, reviewerNama, decisionStatus, String(catatanKartu).trim(),
      ]
    );

    const stageFinished = decisionStatus === "CONTINUE" || decisionStatus === "ACCEPTED";
    await conn.query(
      `UPDATE konsultasi_skripsi_stage
       SET current_status = ?,
           finished_at = CASE WHEN ? = 1 THEN CURRENT_TIMESTAMP ELSE finished_at END,
           updated_at = CURRENT_TIMESTAMP
       WHERE id = ?`,
      [decisionStatus, stageFinished ? 1 : 0, stageId]
    );

    let autoFinalizedFile = null;

    if (stage.stage === "PEMBIMBING_2" && decisionStatus === "CONTINUE") {
      await conn.query(
        `UPDATE kartu_konsultasi_skripsi
         SET pembimbing2_signature = ?, updated_at = CURRENT_TIMESTAMP
         WHERE id = ?`,
        [signatureImageValue, stage.kartu_id]
      );

      const [p1Rows] = await conn.query(
        `SELECT id FROM konsultasi_skripsi_stage
         WHERE kartu_konsultasi_skripsi_id = ? AND chapter_group = ? AND stage = 'PEMBIMBING_1'
         LIMIT 1 FOR UPDATE`,
        [stage.kartu_id, stage.chapter_group]
      );
      if (p1Rows.length === 0) {
        const [kRows] = await conn.query(
          `SELECT pembimbing1_nidn FROM kartu_konsultasi_skripsi WHERE id = ? LIMIT 1`,
          [stage.kartu_id]
        );
        const pembimbing1Nidn = kRows[0]?.pembimbing1_nidn ?? null;
        if (!pembimbing1Nidn) {
          await conn.rollback();
          txStarted = false;
          return res.status(409).json({ ok: false, message: "Pembimbing 1 is not assigned" });
        }
        await conn.query(
          `INSERT INTO konsultasi_skripsi_stage (
             kartu_konsultasi_skripsi_id, pengajuan_judul_id, chapter_group, stage,
             pembimbing_nidn, current_status, current_submission_no, started_at
           ) VALUES (?, ?, ?, 'PEMBIMBING_1', ?, 'WAITING_SUBMISSION', 0, CURRENT_TIMESTAMP)`,
          [stage.kartu_id, stage.pengajuan_judul_id, stage.chapter_group, pembimbing1Nidn]
        );
      }
    }

    if (stage.stage === "PEMBIMBING_1" && decisionStatus === "ACCEPTED") {
      await conn.query(
        `UPDATE kartu_konsultasi_skripsi
         SET pembimbing1_signature = ?, updated_at = CURRENT_TIMESTAMP
         WHERE id = ?`,
        [signatureImageValue, stage.kartu_id]
      );

      const nextChapter = nextChapterGroup(stage.chapter_group);
      if (nextChapter) {
        const [nextP2Rows] = await conn.query(
          `SELECT id FROM konsultasi_skripsi_stage
           WHERE kartu_konsultasi_skripsi_id = ? AND chapter_group = ? AND stage = 'PEMBIMBING_2'
           LIMIT 1 FOR UPDATE`,
          [stage.kartu_id, nextChapter]
        );
        if (nextP2Rows.length === 0) {
          const [kRows] = await conn.query(
            `SELECT pembimbing2_nidn FROM kartu_konsultasi_skripsi WHERE id = ? LIMIT 1`,
            [stage.kartu_id]
          );
          const pembimbing2Nidn = kRows[0]?.pembimbing2_nidn ?? null;
          if (!pembimbing2Nidn) {
            await conn.rollback();
            txStarted = false;
            return res.status(409).json({ ok: false, message: "Pembimbing 2 is not assigned" });
          }
          await conn.query(
            `INSERT INTO konsultasi_skripsi_stage (
               kartu_konsultasi_skripsi_id, pengajuan_judul_id, chapter_group, stage,
               pembimbing_nidn, current_status, current_submission_no, started_at
             ) VALUES (?, ?, ?, 'PEMBIMBING_2', ?, 'WAITING_SUBMISSION', 0, CURRENT_TIMESTAMP)`,
            [stage.kartu_id, stage.pengajuan_judul_id, nextChapter, pembimbing2Nidn]
          );
        }
      } else {
        await conn.query(
          `UPDATE kartu_konsultasi_skripsi
           SET is_completed = 1, completed_at = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP
           WHERE id = ?`,
          [stage.kartu_id]
        );

        autoFinalizedFile = await generateAndStoreFinalKartuDocx(conn, {
          kartuId: stage.kartu_id,
          pengajuanJudulId: stage.pengajuan_judul_id,
          generatedByUserId: req.user.id,
        });
      }
    }

    await conn.commit();
    txStarted = false;

    return res.json({
      ok: true,
      message:
        stage.stage === "PEMBIMBING_1" && decisionStatus === "ACCEPTED" && !nextChapterGroup(stage.chapter_group)
          ? "Review saved and final DOCX generated"
          : "Review saved",
      data: {
        stageId,
        submissionNo: latestSubmission.submission_no,
        decisionStatus,
        hasReviewFile,
        finalFile: autoFinalizedFile,
      },
    });
  } catch (err) {
    try { if (txStarted) await conn.rollback(); } catch (_) {}
    next(err);
  } finally {
    conn.release();
  }
};

exports.getLecturerStageDetail = async (req, res, next) => {
  try {
    if (req.user.userType !== "LECTURER") {
      return res.status(403).json({ ok: false, message: "Only lecturers" });
    }

    const stageId = Number(req.params.stageId);
    if (!Number.isFinite(stageId) || stageId <= 0) {
      return res.status(400).json({ ok: false, message: "Invalid stageId" });
    }

    const nidn = await getLecturerNidn(req.user.id);
    if (!nidn) {
      return res.status(400).json({ ok: false, message: "Dosen tidak valid" });
    }

    const [stageRows] = await db.query(
      `SELECT
         s.id AS stage_id, s.kartu_konsultasi_skripsi_id, s.pengajuan_judul_id,
         s.chapter_group, s.stage AS stage_name, s.pembimbing_nidn,
         d.nama AS stage_dosen_name, s.current_status, s.current_submission_no,
         s.started_at, s.finished_at,
         k.id AS kartu_id, k.nama_mahasiswa, k.npm, k.program_studi_nama,
         k.judul_skripsi, k.pembimbing1_nidn, k.pembimbing1_nama,
         k.pembimbing2_nidn, k.pembimbing2_nama, k.is_completed
       FROM konsultasi_skripsi_stage s
       INNER JOIN kartu_konsultasi_skripsi k ON k.id = s.kartu_konsultasi_skripsi_id
       LEFT JOIN dosen d ON d.nidn = s.pembimbing_nidn
       WHERE s.id = ? AND (k.pembimbing1_nidn = ? OR k.pembimbing2_nidn = ?)
       LIMIT 1`,
      [stageId, nidn, nidn]
    );
    const row = stageRows[0] ?? null;
    if (!row) {
      return res.status(404).json({ ok: false, message: "Stage not found" });
    }

    const [submissions] = await db.query(
      `SELECT id, submission_no, file_name, submitted_by_user_id, submitted_at
       FROM konsultasi_skripsi_submission
       WHERE konsultasi_skripsi_stage_id = ?
       ORDER BY submission_no DESC`,
      [stageId]
    );

    const [reviews] = await db.query(
      `SELECT
         r.id, r.submission_no, r.decision_status, r.catatan_mahasiswa, r.catatan_kartu, r.reviewed_at,
         CASE WHEN rf.id IS NULL THEN 0 ELSE 1 END AS has_review_file,
         rf.id AS review_file_id, rf.file_name AS review_file_name
       FROM konsultasi_skripsi_review r
       INNER JOIN konsultasi_skripsi_stage st ON st.id = r.konsultasi_skripsi_stage_id
       LEFT JOIN konsultasi_skripsi_review_file rf ON rf.konsultasi_skripsi_review_id = r.id
       WHERE st.kartu_konsultasi_skripsi_id = ?
       ORDER BY r.reviewed_at DESC`,
      [row.kartu_id]
    );

    const [logs] = await db.query(
      `SELECT chapter_group, stage, submission_no, status, catatan_kartu, logged_at
       FROM kartu_konsultasi_skripsi_log
       WHERE kartu_konsultasi_skripsi_id = ?
       ORDER BY logged_at DESC`,
      [row.kartu_id]
    );

    return res.json({
      ok: true,
      data: {
        stage: {
          id: row.stage_id,
          kartuKonsultasiSkripsiId: row.kartu_konsultasi_skripsi_id,
          pengajuanJudulId: row.pengajuan_judul_id,
          chapterGroup: row.chapter_group,
          stage: row.stage_name,
          pembimbingNidn: row.pembimbing_nidn,
          dosenName: row.stage_dosen_name,
          currentStatus: row.current_status,
          currentSubmissionNo: row.current_submission_no,
          startedAt: row.started_at,
          finishedAt: row.finished_at,
        },
        kartu: {
          id: row.kartu_id,
          namaMahasiswa: row.nama_mahasiswa,
          npm: row.npm,
          programStudiNama: row.program_studi_nama,
          judulSkripsi: row.judul_skripsi,
          pembimbing1Nidn: row.pembimbing1_nidn,
          pembimbing1Nama: row.pembimbing1_nama,
          pembimbing2Nidn: row.pembimbing2_nidn,
          pembimbing2Nama: row.pembimbing2_nama,
          isCompleted: Boolean(row.is_completed),
        },
        latestSubmission: submissions[0] ?? null,
        submissions,
        reviews,
        kartuLogs: logs,
      },
    });
  } catch (err) {
    next(err);
  }
};

exports.listMySupervisedConsultations = async (req, res, next) => {
  try {
    if (req.user.userType !== "LECTURER") {
      return res.status(403).json({ ok: false, message: "Only lecturers" });
    }

    const nidn = await getLecturerNidn(req.user.id);
    if (!nidn) {
      return res.status(400).json({ ok: false, message: "Dosen tidak valid" });
    }

    const [kartuRows] = await db.query(
      `SELECT
         k.id AS kartu_id, k.pengajuan_judul_id, k.nama_mahasiswa, k.npm,
         k.program_studi_nama, k.judul_skripsi,
         k.pembimbing1_nidn, k.pembimbing1_nama, k.pembimbing2_nidn, k.pembimbing2_nama,
         k.is_completed, k.completed_at, k.created_at, k.updated_at
       FROM kartu_konsultasi_skripsi k
       WHERE k.pembimbing1_nidn = ? OR k.pembimbing2_nidn = ?
       ORDER BY k.updated_at DESC`,
      [nidn, nidn]
    );

    if (kartuRows.length === 0) {
      return res.json({ ok: true, data: [] });
    }

    const kartuIds = kartuRows.map((r) => r.kartu_id);
    const [stageRows] = await db.query(
      `SELECT *
       FROM konsultasi_skripsi_stage
       WHERE kartu_konsultasi_skripsi_id IN (?)
       ORDER BY FIELD(chapter_group, 'BAB_1_2','BAB_3','BAB_4','BAB_5') ASC,
                CASE stage WHEN 'PEMBIMBING_2' THEN 1 WHEN 'PEMBIMBING_1' THEN 2 ELSE 3 END ASC`,
      [kartuIds]
    );

    const stageMap = new Map();
    for (const s of stageRows) {
      if (!stageMap.has(s.kartu_konsultasi_skripsi_id)) {
        stageMap.set(s.kartu_konsultasi_skripsi_id, []);
      }
      stageMap.get(s.kartu_konsultasi_skripsi_id).push(s);
    }

    const rows = kartuRows.map((k) => {
      const stages = stageMap.get(k.kartu_id) ?? [];
      const resolved = resolveActiveStage(stages);
      const activeStage = resolved.stageRow;

      let myRole = null;
      if (k.pembimbing1_nidn === nidn && k.pembimbing2_nidn === nidn) {
        myRole = "PEMBIMBING_1_AND_2";
      } else if (k.pembimbing1_nidn === nidn) {
        myRole = "PEMBIMBING_1";
      } else if (k.pembimbing2_nidn === nidn) {
        myRole = "PEMBIMBING_2";
      }

      return {
        ...k,
        my_role: myRole,
        active_stage_id: activeStage?.id ?? null,
        active_chapter_group: resolved.chapterGroup,
        active_stage: resolved.activeStage,
        active_status: resolved.activeStatus,
        active_submission_no: activeStage?.current_submission_no ?? null,
        can_review:
          Boolean(activeStage) &&
          activeStage.pembimbing_nidn === nidn &&
          canReviewStageStatus(activeStage.current_status),
        stages,
      };
    });

    return res.json({ ok: true, data: rows });
  } catch (err) {
    next(err);
  }
};

exports.listForKaprodi = async (req, res, next) => {
  try {
    if (!hasRole(req, "KAPRODI")) {
      return res.status(403).json({ ok: false, message: "Only kaprodi can access this endpoint" });
    }

    const nidn = await getLecturerNidn(req.user.id);
    if (!nidn) {
      return res.status(400).json({ ok: false, message: "Dosen tidak valid" });
    }

    const programStudiIds = await getKaprodiProgramStudiIdsByNidn(nidn);
    if (programStudiIds.length === 0) {
      return res.status(403).json({ ok: false, message: "You are not assigned as Kaprodi" });
    }

    const { q } = req.query || {};
    const where = ["k.program_studi_id IN (?)"];
    const params = [programStudiIds];

    if (q && String(q).trim().length > 0) {
      const queryValue = `%${String(q).trim()}%`;
      where.push("(k.nama_mahasiswa LIKE ? OR k.npm LIKE ? OR k.judul_skripsi LIKE ?)");
      params.push(queryValue, queryValue, queryValue);
    }

    const [kartuRows] = await db.query(
      `SELECT
         k.id AS kartu_id, k.pengajuan_judul_id, k.nama_mahasiswa, k.npm,
         k.program_studi_id, k.program_studi_nama, k.judul_skripsi,
         k.pembimbing1_nidn, k.pembimbing1_nama, k.pembimbing2_nidn, k.pembimbing2_nama,
         k.is_completed, k.completed_at, k.created_at, k.updated_at
       FROM kartu_konsultasi_skripsi k
       WHERE ${where.join(" AND ")}
       ORDER BY k.updated_at DESC`,
      params
    );

    if (kartuRows.length === 0) {
      return res.json({ ok: true, data: [] });
    }

    const kartuIds = kartuRows.map((r) => r.kartu_id);
    const [stageRows] = await db.query(
      `SELECT *
       FROM konsultasi_skripsi_stage
       WHERE kartu_konsultasi_skripsi_id IN (?)`,
      [kartuIds]
    );

    const stageMap = new Map();
    for (const s of stageRows) {
      if (!stageMap.has(s.kartu_konsultasi_skripsi_id)) {
        stageMap.set(s.kartu_konsultasi_skripsi_id, []);
      }
      stageMap.get(s.kartu_konsultasi_skripsi_id).push(s);
    }

    const rows = kartuRows.map((k) => {
      const stages = stageMap.get(k.kartu_id) ?? [];
      const resolved = resolveActiveStage(stages);
      return {
        ...k,
        active_stage_id: resolved.stageRow?.id ?? null,
        active_chapter_group: resolved.chapterGroup,
        active_stage: resolved.activeStage,
        active_status: resolved.activeStatus,
        stages,
      };
    });

    return res.json({ ok: true, data: rows });
  } catch (err) {
    next(err);
  }
};

exports.getFinalKartuFile = async (req, res, next) => {
  try {
    const pengajuanJudulId = Number(req.params.pengajuanJudulId);
    if (!Number.isFinite(pengajuanJudulId) || pengajuanJudulId <= 0) {
      return res.status(400).json({ ok: false, message: "Invalid pengajuanJudulId" });
    }

    const [kartuRows] = await db.query(
      `SELECT * FROM kartu_konsultasi_skripsi WHERE pengajuan_judul_id = ? LIMIT 1`,
      [pengajuanJudulId]
    );
    const kartu = kartuRows[0] ?? null;
    if (!kartu) {
      return res.status(404).json({ ok: false, message: "Consultation not found" });
    }

    let isAuthorized = false;
    if (req.user.userType === "STUDENT") {
      const npm = await getStudentNpm(req.user.id);
      isAuthorized = Boolean(npm) && npm === kartu.npm;
    } else if (req.user.userType === "LECTURER") {
      const nidn = await getLecturerNidn(req.user.id);
      if (nidn) {
        isAuthorized = nidn === kartu.pembimbing1_nidn || nidn === kartu.pembimbing2_nidn;
        if (!isAuthorized && hasRole(req, "KAPRODI")) {
          const kaprodiProgramStudiIds = await getKaprodiProgramStudiIdsByNidn(nidn);
          isAuthorized = kaprodiProgramStudiIds.includes(Number(kartu.program_studi_id));
        }
      }
    }

    if (!isAuthorized) {
      return res.status(403).json({ ok: false, message: "Forbidden" });
    }

    const [rows] = await db.query(
      `SELECT id, file_type, file_content, file_name, generated_at
       FROM kartu_konsultasi_skripsi_file
       WHERE kartu_konsultasi_skripsi_id = ? AND is_active = 1 AND file_type = 'FINAL_DOCX'
       ORDER BY generated_at DESC LIMIT 1`,
      [kartu.id]
    );
    const file = rows[0] ?? null;
    if (!file) {
      return res.status(404).json({ ok: false, message: "Final artifact not found" });
    }

    return res.json({ ok: true, data: file });
  } catch (err) {
    next(err);
  }
};
