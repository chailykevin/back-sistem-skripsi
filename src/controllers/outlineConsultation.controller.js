const db = require("../db");
const path = require("path");
const { readFile } = require("fs/promises");
const { patchDocument, PatchType, TextRun } = require("docx");

async function getStudentNpm(userId) {
  const [rows] = await db.query(
    `SELECT npm
     FROM users
     WHERE id = ? AND is_active = 1
     LIMIT 1`,
    [userId]
  );
  return rows[0]?.npm ?? null;
}

async function getLecturerNidn(userId) {
  const [rows] = await db.query(
    `SELECT nidn
     FROM users
     WHERE id = ? AND is_active = 1
     LIMIT 1`,
    [userId]
  );
  return rows[0]?.nidn ?? null;
}

async function getKaprodiProgramStudiIdsByNidn(nidn) {
  const [rows] = await db.query(
    `SELECT id
     FROM program_studi
     WHERE kaprodi_nidn = ?`,
    [nidn]
  );
  return rows.map((row) => Number(row.id)).filter((id) => Number.isFinite(id) && id > 0);
}

async function getKartuByPengajuanAndStudent(pengajuanJudulId, npm) {
  const [rows] = await db.query(
    `SELECT *
     FROM kartu_konsultasi_outline
     WHERE pengajuan_judul_id = ? AND npm = ?
     LIMIT 1`,
    [pengajuanJudulId, npm]
  );
  return rows[0] ?? null;
}

function resolveActiveStage(stages, isCompleted) {
  const p2 = stages.find((s) => s.stage === "PEMBIMBING_2") ?? null;
  const p1 = stages.find((s) => s.stage === "PEMBIMBING_1") ?? null;

  if (isCompleted || p1?.current_status === "ACCEPTED") {
    return {
      activeStage: p1?.stage ?? "PEMBIMBING_1",
      activeStatus: p1?.current_status ?? "ACCEPTED",
      isCompleted: true,
      stageRow: p1,
    };
  }

  if (!p2) {
    return { activeStage: null, activeStatus: null, isCompleted: false, stageRow: null };
  }

  if (p2.current_status !== "CONTINUE") {
    return {
      activeStage: "PEMBIMBING_2",
      activeStatus: p2.current_status,
      isCompleted: false,
      stageRow: p2,
    };
  }

  if (!p1) {
    return { activeStage: null, activeStatus: null, isCompleted: false, stageRow: null };
  }

  return {
    activeStage: "PEMBIMBING_1",
    activeStatus: p1.current_status,
    isCompleted: false,
    stageRow: p1,
  };
}

function canReviewStageStatus(stageStatus) {
  return stageStatus === "SUBMITTED" || stageStatus === "IN_REVIEW";
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

function formatKartuDate(value) {
  if (!value) {
    return "";
  }
  return new Intl.DateTimeFormat("id-ID", {
    day: "2-digit",
    month: "long",
    year: "numeric",
    timeZone: "Asia/Jakarta",
  }).format(new Date(value));
}

function getStageLabel(stage) {
  if (stage === "PEMBIMBING_2") {
    return "Pembimbing 2";
  }
  if (stage === "PEMBIMBING_1") {
    return "Pembimbing 1";
  }
  return stage ?? "";
}

function getDecisionLabel(status) {
  if (status === "NEED_REVISION") {
    return "Perlu Revisi";
  }
  if (status === "CONTINUE") {
    return "Lanjut ke Pembimbing 1";
  }
  if (status === "ACCEPTED") {
    return "Diterima";
  }
  return status ?? "";
}

async function buildKartuKonsultasiOutlineDocxBuffer(kartu, logs) {
  const templatePath = path.join(
    __dirname,
    "..",
    "templates",
    "template_kartu_konsultasi_outline.docx"
  );
  const templateBuffer = await readFile(templatePath);

  const patches = {
    nama_mahasiswa: textPatch(kartu.nama_mahasiswa),
    npm: textPatch(kartu.npm),
    program_studi: textPatch(kartu.program_studi_nama),
    judul_skripsi: textPatch(kartu.judul_skripsi),
    pembimbing1: textPatch(kartu.pembimbing1_nama),
    pembimbing2: textPatch(kartu.pembimbing2_nama),
    ttd_pembimbing1: textPatch(""),
    ttd_pembimbing2: textPatch(""),
  };

  for (let i = 1; i <= 18; i += 1) {
    const log = logs[i - 1];
    const keterangan = log
      ? `${getStageLabel(log.stage)} - ${getDecisionLabel(log.status)}: ${log.catatan_kartu ?? ""}`
      : "";

    patches[`tanggal_${i}`] = textPatch(log ? formatKartuDate(log.logged_at) : "");
    patches[`keterangan_${i}`] = textPatch(keterangan);
    patches[`paraf_${i}`] = textPatch(log?.reviewer_nama ?? "");
  }

  return patchDocument({
    outputType: "nodebuffer",
    data: templateBuffer,
    patches,
  });
}

async function getKartuLogs(queryable, kartuId) {
  const [logs] = await queryable.query(
    `SELECT stage, submission_no, reviewer_nidn, reviewer_nama, status, catatan_kartu, logged_at
     FROM kartu_konsultasi_outline_log
     WHERE kartu_konsultasi_outline_id = ?
     ORDER BY logged_at ASC, id ASC
     LIMIT 18`,
    [kartuId]
  );
  return logs;
}

async function getAuthorizedKartuForDocument(queryable, req, pengajuanJudulId) {
  const [rows] = await queryable.query(
    `SELECT *
     FROM kartu_konsultasi_outline
     WHERE pengajuan_judul_id = ?
     LIMIT 1`,
    [pengajuanJudulId]
  );
  const kartu = rows[0] ?? null;
  if (!kartu) {
    return { error: { status: 404, message: "Kartu not found" } };
  }

  if (req.user.userType === "STUDENT") {
    const npm = await getStudentNpm(req.user.id);
    if (!npm || npm !== kartu.npm) {
      return { error: { status: 403, message: "Forbidden" } };
    }
    return { kartu };
  }

  if (req.user.userType === "LECTURER") {
    const nidn = await getLecturerNidn(req.user.id);
    if (!nidn || (nidn !== kartu.pembimbing1_nidn && nidn !== kartu.pembimbing2_nidn)) {
      return { error: { status: 403, message: "Forbidden" } };
    }
    return { kartu, nidn };
  }

  if (hasRole(req, "KAPRODI")) {
    return { kartu };
  }

  return { error: { status: 403, message: "Forbidden" } };
}

function rebuildNotice(handlerName) {
  return (req, res) => {
    return res.status(501).json({
      ok: false,
      message: `Outline consultation controller is being rebuilt. Handler not implemented yet: ${handlerName}`,
    });
  };
}

exports.listMine = async (req, res, next) => {
  try {
    if (req.user.userType !== "STUDENT") {
      return res.status(403).json({ ok: false, message: "Only students" });
    }

    const npm = await getStudentNpm(req.user.id);
    if (!npm) {
      return res.status(400).json({ ok: false, message: "Mahasiswa tidak valid" });
    }

    const [kartuRows] = await db.query(
      `SELECT
         k.id AS kartu_id,
         k.pengajuan_judul_id,
         k.judul_skripsi,
         k.is_completed,
         k.completed_at,
         k.created_at
       FROM kartu_konsultasi_outline k
       WHERE k.npm = ?
       ORDER BY k.created_at DESC`,
      [npm]
    );

    if (kartuRows.length === 0) {
      return res.json({ ok: true, data: [] });
    }

    const kartuIds = kartuRows.map((r) => r.kartu_id);
    const [stageRows] = await db.query(
      `SELECT id, kartu_konsultasi_outline_id, stage, current_status
       FROM konsultasi_outline_stage
       WHERE kartu_konsultasi_outline_id IN (?)`,
      [kartuIds]
    );

    const stageMap = new Map();
    for (const s of stageRows) {
      if (!stageMap.has(s.kartu_konsultasi_outline_id)) {
        stageMap.set(s.kartu_konsultasi_outline_id, []);
      }
      stageMap.get(s.kartu_konsultasi_outline_id).push(s);
    }

    const rows = kartuRows.map((k) => {
      const stages = stageMap.get(k.kartu_id) ?? [];
      const resolved = resolveActiveStage(stages, Boolean(k.is_completed));
      return {
        ...k,
        active_stage: resolved.activeStage,
        active_status: resolved.activeStatus,
      };
    });

    return res.json({ ok: true, data: rows });
  } catch (err) {
    next(err);
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

    const kartu = await getKartuByPengajuanAndStudent(pengajuanJudulId, npm);
    if (!kartu) {
      return res.status(404).json({ ok: false, message: "Consultation not found" });
    }

    const [stages] = await db.query(
      `SELECT *
       FROM konsultasi_outline_stage
       WHERE kartu_konsultasi_outline_id = ?
       ORDER BY
         CASE stage
           WHEN 'PEMBIMBING_2' THEN 1
           WHEN 'PEMBIMBING_1' THEN 2
           ELSE 3
         END ASC`,
      [kartu.id]
    );

    const [submissions] = await db.query(
      `SELECT
         s.id,
         s.konsultasi_outline_stage_id,
         st.stage,
         s.submission_no,
         s.file_outline,
         s.file_outline_name,
         s.submitted_at
       FROM konsultasi_outline_submission s
       INNER JOIN konsultasi_outline_stage st ON st.id = s.konsultasi_outline_stage_id
       WHERE st.kartu_konsultasi_outline_id = ?
       ORDER BY s.submitted_at DESC`,
      [kartu.id]
    );

    const [reviews] = await db.query(
      `SELECT
         r.id,
         r.konsultasi_outline_stage_id,
         st.stage,
         r.submission_no,
         r.decision_status,
         r.catatan_mahasiswa,
         r.reviewed_at,
         rf.id AS review_file_id,
         rf.file_name AS review_file_name,
         rf.mime_type AS review_file_mime_type,
         CASE WHEN rf.id IS NULL THEN 0 ELSE 1 END AS has_review_file
       FROM konsultasi_outline_review r
       INNER JOIN konsultasi_outline_stage st ON st.id = r.konsultasi_outline_stage_id
       LEFT JOIN konsultasi_outline_review_file rf
         ON rf.konsultasi_outline_review_id = r.id
       WHERE st.kartu_konsultasi_outline_id = ?
       ORDER BY r.reviewed_at DESC`,
      [kartu.id]
    );

    return res.json({
      ok: true,
      data: {
        kartu,
        stages,
        latestSubmissionOverall: submissions[0] ?? null,
        submissions,
        reviews,
        isCompleted: Boolean(kartu.is_completed),
      },
    });
  } catch (err) {
    next(err);
  }
};

exports.submitMyOutline = async (req, res, next) => {
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

    const { fileOutline, fileOutlineName } = req.body || {};
    const safeFileOutlineName = String(fileOutlineName ?? "").trim();
    if (!fileOutline) {
      return res.status(400).json({ ok: false, message: "fileOutline is required" });
    }
    if (!fileOutlineName || !safeFileOutlineName) {
      return res.status(400).json({ ok: false, message: "fileOutlineName is required" });
    }

    const npm = await getStudentNpm(req.user.id);
    if (!npm) {
      return res.status(400).json({ ok: false, message: "Mahasiswa tidak valid" });
    }

    await conn.beginTransaction();
    txStarted = true;

    const [kartuRows] = await conn.query(
      `SELECT *
       FROM kartu_konsultasi_outline
       WHERE pengajuan_judul_id = ? AND npm = ?
       LIMIT 1
       FOR UPDATE`,
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
      `SELECT *
       FROM konsultasi_outline_stage
       WHERE kartu_konsultasi_outline_id = ?
       ORDER BY
         CASE stage
           WHEN 'PEMBIMBING_2' THEN 1
           WHEN 'PEMBIMBING_1' THEN 2
           ELSE 3
         END ASC
       FOR UPDATE`,
      [kartu.id]
    );

    const resolved = resolveActiveStage(stageRows, false);
    if (!resolved.stageRow) {
      await conn.rollback();
      txStarted = false;
      const hasP2 = stageRows.some((s) => s.stage === "PEMBIMBING_2");
      if (!hasP2) {
        return res.status(409).json({ ok: false, message: "Stage PEMBIMBING_2 is not initialized" });
      }
      return res.status(409).json({
        ok: false,
        message: "Stage PEMBIMBING_1 is not initialized yet",
      });
    }
    const activeStage = resolved.stageRow;

    if (activeStage.current_status === "ACCEPTED") {
      await conn.rollback();
      txStarted = false;
      return res.status(409).json({ ok: false, message: "Consultation already accepted" });
    }

    const nextSubmissionNo = Number(activeStage.current_submission_no || 0) + 1;

    await conn.query(
      `INSERT INTO konsultasi_outline_submission (
         konsultasi_outline_stage_id,
         submission_no,
         file_outline,
         file_outline_name,
         submitted_by_user_id
      ) VALUES (?, ?, ?, ?, ?)`,
      [activeStage.id, nextSubmissionNo, String(fileOutline), safeFileOutlineName, req.user.id]
    );

    await conn.query(
      `UPDATE konsultasi_outline_stage
       SET
         current_submission_no = ?,
         current_status = 'SUBMITTED',
         updated_at = CURRENT_TIMESTAMP
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
        stage: activeStage.stage,
        submissionNo: nextSubmissionNo,
      },
    });
  } catch (err) {
    try {
      if (txStarted) {
        await conn.rollback();
      }
    } catch (_) {}
    next(err);
  } finally {
    conn.release();
  }
};

exports.getMyReviewHistory = async (req, res, next) => {
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

    const kartu = await getKartuByPengajuanAndStudent(pengajuanJudulId, npm);
    if (!kartu) {
      return res.status(404).json({ ok: false, message: "Consultation not found" });
    }

    const [rows] = await db.query(
      `SELECT
         r.id,
         st.stage,
         r.submission_no,
         r.decision_status,
         r.catatan_mahasiswa,
         r.reviewed_at,
         rf.id AS review_file_id,
         rf.file_name AS review_file_name,
         rf.mime_type AS review_file_mime_type,
         CASE WHEN rf.id IS NULL THEN 0 ELSE 1 END AS has_review_file
       FROM konsultasi_outline_review r
       INNER JOIN konsultasi_outline_stage st ON st.id = r.konsultasi_outline_stage_id
       LEFT JOIN konsultasi_outline_review_file rf
         ON rf.konsultasi_outline_review_id = r.id
       WHERE st.kartu_konsultasi_outline_id = ?
       ORDER BY r.reviewed_at DESC`,
      [kartu.id]
    );

    return res.json({ ok: true, data: rows });
  } catch (err) {
    next(err);
  }
};

exports.getMyKartu = async (req, res, next) => {
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

    const kartu = await getKartuByPengajuanAndStudent(pengajuanJudulId, npm);
    if (!kartu) {
      return res.status(404).json({ ok: false, message: "Consultation not found" });
    }

    const [logs] = await db.query(
      `SELECT *
       FROM kartu_konsultasi_outline_log
       WHERE kartu_konsultasi_outline_id = ?
       ORDER BY logged_at ASC`,
      [kartu.id]
    );

    const [files] = await db.query(
      `SELECT id, file_type, file_name, mime_type, generated_at, is_active
       FROM kartu_konsultasi_outline_file
       WHERE kartu_konsultasi_outline_id = ?
       ORDER BY generated_at DESC`,
      [kartu.id]
    );

    return res.json({ ok: true, data: { kartu, logs, files } });
  } catch (err) {
    next(err);
  }
};

exports.getMyFinalKartuFile = rebuildNotice("getMyFinalKartuFile");

exports.previewKartuDocx = async (req, res, next) => {
  try {
    const pengajuanJudulId = Number(req.params.pengajuanJudulId);
    if (!Number.isFinite(pengajuanJudulId) || pengajuanJudulId <= 0) {
      return res.status(400).json({ ok: false, message: "Invalid pengajuanJudulId" });
    }

    const { kartu, error } = await getAuthorizedKartuForDocument(db, req, pengajuanJudulId);
    if (error) {
      return res.status(error.status).json({ ok: false, message: error.message });
    }

    const logs = await getKartuLogs(db, kartu.id);
    const outputBuffer = await buildKartuKonsultasiOutlineDocxBuffer(kartu, logs);
    const fileName = `kartu-konsultasi-outline-${pengajuanJudulId}-preview.docx`;

    res.setHeader(
      "Content-Type",
      "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
    );
    res.setHeader("Content-Disposition", `attachment; filename="${fileName}"`);
    res.setHeader("Content-Length", outputBuffer.length);
    return res.send(outputBuffer);
  } catch (err) {
    next(err);
  }
};

exports.finalizeKartu = async (req, res, next) => {
  const conn = await db.getConnection();
  let txStarted = false;
  try {
    if (req.user.userType !== "LECTURER") {
      return res.status(403).json({ ok: false, message: "Only lecturers can finalize" });
    }

    const pengajuanJudulId = Number(req.params.pengajuanJudulId);
    if (!Number.isFinite(pengajuanJudulId) || pengajuanJudulId <= 0) {
      return res.status(400).json({ ok: false, message: "Invalid pengajuanJudulId" });
    }

    const outputType = req.body?.outputType ?? "FINAL_DOCX";
    if (outputType !== "FINAL_DOCX") {
      return res.status(400).json({
        ok: false,
        message: "Only FINAL_DOCX generation is supported right now",
      });
    }

    await conn.beginTransaction();
    txStarted = true;

    const { kartu, error, nidn } = await getAuthorizedKartuForDocument(
      conn,
      req,
      pengajuanJudulId
    );
    if (error) {
      await conn.rollback();
      txStarted = false;
      return res.status(error.status).json({ ok: false, message: error.message });
    }

    if (!kartu.is_completed) {
      await conn.rollback();
      txStarted = false;
      return res.status(409).json({
        ok: false,
        message: "Consultation is not completed yet",
      });
    }

    if (req.user.userType === "LECTURER" && nidn !== kartu.pembimbing1_nidn) {
      await conn.rollback();
      txStarted = false;
      return res.status(403).json({
        ok: false,
        message: "Only Pembimbing 1 can finalize this kartu",
      });
    }

    const logs = await getKartuLogs(conn, kartu.id);
    const outputBuffer = await buildKartuKonsultasiOutlineDocxBuffer(kartu, logs);
    const mimeType = "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
    const fileName = `kartu-konsultasi-outline-${pengajuanJudulId}-${Date.now()}.docx`;

    await conn.query(
      `UPDATE kartu_konsultasi_outline_file
       SET is_active = 0
       WHERE kartu_konsultasi_outline_id = ?
         AND file_type = 'FINAL_DOCX'
         AND is_active = 1`,
      [kartu.id]
    );

    const [ins] = await conn.query(
      `INSERT INTO kartu_konsultasi_outline_file (
         kartu_konsultasi_outline_id,
         file_type,
         file_content,
         file_name,
         mime_type,
         generated_by_user_id,
         generated_at,
         is_active
       ) VALUES (?, 'FINAL_DOCX', ?, ?, ?, ?, CURRENT_TIMESTAMP, 1)`,
      [kartu.id, outputBuffer.toString("base64"), fileName, mimeType, req.user.id]
    );

    await conn.commit();
    txStarted = false;

    return res.json({
      ok: true,
      message: "Final kartu konsultasi outline generated",
      data: {
        id: ins.insertId,
        kartuId: kartu.id,
        fileType: "FINAL_DOCX",
        fileName,
        mimeType,
      },
    });
  } catch (err) {
    try {
      if (txStarted) {
        await conn.rollback();
      }
    } catch (_) {}
    next(err);
  } finally {
    conn.release();
  }
};

exports.getKartuFiles = rebuildNotice("getKartuFiles");

exports.initFromApprovedPengajuan = rebuildNotice("initFromApprovedPengajuan");

exports.listAssignedToLecturer = async (req, res, next) => {
  try {
    if (req.user.userType !== "LECTURER") {
      return res.status(403).json({ ok: false, message: "Only lecturers" });
    }

    const nidn = await getLecturerNidn(req.user.id);
    if (!nidn) {
      return res.status(400).json({ ok: false, message: "Dosen tidak valid" });
    }

    const { stage, status } = req.query || {};
    const where = ["s.pembimbing_nidn = ?", "s.current_status IN ('SUBMITTED', 'IN_REVIEW')"];
    const params = [nidn];

    if (stage === "PEMBIMBING_2" || stage === "PEMBIMBING_1") {
      where.push("s.stage = ?");
      params.push(stage);
    }
    if (["SUBMITTED", "IN_REVIEW"].includes(status)) {
      where.push("s.current_status = ?");
      params.push(status);
    }

    const [rows] = await db.query(
      `SELECT
         s.id AS stage_id,
         s.stage,
         s.current_status,
         s.current_submission_no,
         s.started_at,
         s.finished_at,
         latest_submission.latest_submitted_at,
         k.id AS kartu_id,
         k.pengajuan_judul_id,
         k.nama_mahasiswa,
         k.npm,
         k.program_studi_nama,
         k.judul_skripsi,
         k.is_completed
       FROM konsultasi_outline_stage s
       LEFT JOIN (
         SELECT
           konsultasi_outline_stage_id,
           MAX(submitted_at) AS latest_submitted_at
         FROM konsultasi_outline_submission
         GROUP BY konsultasi_outline_stage_id
       ) latest_submission
         ON latest_submission.konsultasi_outline_stage_id = s.id
       INNER JOIN kartu_konsultasi_outline k ON k.id = s.kartu_konsultasi_outline_id
       WHERE ${where.join(" AND ")}
       ORDER BY s.updated_at DESC`,
      params
    );

    return res.json({ ok: true, data: rows });
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

    const { stage, status } = req.query || {};

    const [kartuRows] = await db.query(
      `SELECT
         k.id AS kartu_id,
         k.pengajuan_judul_id,
         k.nama_mahasiswa,
         k.npm,
         k.program_studi_nama,
         k.judul_skripsi,
         k.pembimbing1_nidn,
         k.pembimbing1_nama,
         k.pembimbing2_nidn,
         k.pembimbing2_nama,
         k.is_completed,
         k.completed_at,
         k.created_at,
         k.updated_at
       FROM kartu_konsultasi_outline k
       WHERE k.pembimbing1_nidn = ? OR k.pembimbing2_nidn = ?
       ORDER BY k.updated_at DESC`,
      [nidn, nidn]
    );

    if (kartuRows.length === 0) {
      return res.json({ ok: true, data: [] });
    }

    const kartuIds = kartuRows.map((r) => r.kartu_id);
    const [stageRows] = await db.query(
      `SELECT
         id,
         kartu_konsultasi_outline_id,
         pengajuan_judul_id,
         stage,
         pembimbing_nidn,
         current_status,
         current_submission_no,
         started_at,
         finished_at,
         created_at,
         updated_at
       FROM konsultasi_outline_stage
       WHERE kartu_konsultasi_outline_id IN (?)
       ORDER BY
         CASE stage
           WHEN 'PEMBIMBING_2' THEN 1
           WHEN 'PEMBIMBING_1' THEN 2
           ELSE 3
         END ASC`,
      [kartuIds]
    );

    const stageMap = new Map();
    for (const s of stageRows) {
      if (!stageMap.has(s.kartu_konsultasi_outline_id)) {
        stageMap.set(s.kartu_konsultasi_outline_id, []);
      }
      stageMap.get(s.kartu_konsultasi_outline_id).push(s);
    }

    const rows = kartuRows
      .map((k) => {
        const stages = stageMap.get(k.kartu_id) ?? [];
        const resolved = resolveActiveStage(stages, Boolean(k.is_completed));
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
          active_stage: resolved.activeStage,
          active_status: resolved.activeStatus,
          active_submission_no: activeStage?.current_submission_no ?? null,
          active_stage_pembimbing_nidn: activeStage?.pembimbing_nidn ?? null,
          can_review:
            Boolean(activeStage) &&
            activeStage.pembimbing_nidn === nidn &&
            canReviewStageStatus(activeStage.current_status),
          stages,
        };
      })
      .filter((row) => {
        if (stage && stage !== "PEMBIMBING_2" && stage !== "PEMBIMBING_1") {
          return true;
        }
        if (stage && row.active_stage !== stage) {
          return false;
        }
        if (
          status &&
          ![
            "WAITING_SUBMISSION",
            "SUBMITTED",
            "IN_REVIEW",
            "NEED_REVISION",
            "CONTINUE",
            "ACCEPTED",
          ].includes(status)
        ) {
          return true;
        }
        if (status && row.active_status !== status) {
          return false;
        }
        return true;
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

    const { stage, status, q } = req.query || {};
    const where = ["k.program_studi_id IN (?)"];
    const params = [programStudiIds];

    if (q && String(q).trim().length > 0) {
      const queryValue = `%${String(q).trim()}%`;
      where.push("(k.nama_mahasiswa LIKE ? OR k.npm LIKE ? OR k.judul_skripsi LIKE ?)");
      params.push(queryValue, queryValue, queryValue);
    }

    const [kartuRows] = await db.query(
      `SELECT
         k.id AS kartu_id,
         k.pengajuan_judul_id,
         k.nama_mahasiswa,
         k.npm,
         k.program_studi_id,
         k.program_studi_nama,
         k.judul_skripsi,
         k.pembimbing1_nidn,
         k.pembimbing1_nama,
         k.pembimbing2_nidn,
         k.pembimbing2_nama,
         k.is_completed,
         k.completed_at,
         k.created_at,
         k.updated_at
       FROM kartu_konsultasi_outline k
       WHERE ${where.join(" AND ")}
       ORDER BY k.updated_at DESC`,
      params
    );

    if (kartuRows.length === 0) {
      return res.json({ ok: true, data: [] });
    }

    const kartuIds = kartuRows.map((row) => row.kartu_id);
    const [stageRows] = await db.query(
      `SELECT
         id,
         kartu_konsultasi_outline_id,
         stage,
         pembimbing_nidn,
         current_status,
         current_submission_no,
         started_at,
         finished_at
       FROM konsultasi_outline_stage
       WHERE kartu_konsultasi_outline_id IN (?)`,
      [kartuIds]
    );

    const stageMap = new Map();
    for (const stageRow of stageRows) {
      if (!stageMap.has(stageRow.kartu_konsultasi_outline_id)) {
        stageMap.set(stageRow.kartu_konsultasi_outline_id, []);
      }
      stageMap.get(stageRow.kartu_konsultasi_outline_id).push(stageRow);
    }

    const rows = kartuRows
      .map((kartu) => {
        const stages = stageMap.get(kartu.kartu_id) ?? [];
        const resolved = resolveActiveStage(stages, Boolean(kartu.is_completed));
        return {
          ...kartu,
          active_stage_id: resolved.stageRow?.id ?? null,
          active_stage: resolved.activeStage,
          active_status: resolved.activeStatus,
          active_submission_no: resolved.stageRow?.current_submission_no ?? null,
          stages,
        };
      })
      .filter((row) => {
        if (stage && stage !== "PEMBIMBING_2" && stage !== "PEMBIMBING_1") {
          return true;
        }
        if (stage && row.active_stage !== stage) {
          return false;
        }
        if (
          status &&
          ![
            "WAITING_SUBMISSION",
            "SUBMITTED",
            "IN_REVIEW",
            "NEED_REVISION",
            "CONTINUE",
            "ACCEPTED",
          ].includes(status)
        ) {
          return true;
        }
        if (status && row.active_status !== status) {
          return false;
        }
        return true;
      });

    return res.json({ ok: true, data: rows });
  } catch (err) {
    next(err);
  }
};

exports.getDetailForKaprodi = async (req, res, next) => {
  try {
    if (!hasRole(req, "KAPRODI")) {
      return res.status(403).json({ ok: false, message: "Only kaprodi can access this endpoint" });
    }

    const pengajuanJudulId = Number(req.params.pengajuanJudulId);
    if (!Number.isFinite(pengajuanJudulId) || pengajuanJudulId <= 0) {
      return res.status(400).json({ ok: false, message: "Invalid pengajuanJudulId" });
    }

    const nidn = await getLecturerNidn(req.user.id);
    if (!nidn) {
      return res.status(400).json({ ok: false, message: "Dosen tidak valid" });
    }

    const programStudiIds = await getKaprodiProgramStudiIdsByNidn(nidn);
    if (programStudiIds.length === 0) {
      return res.status(403).json({ ok: false, message: "You are not assigned as Kaprodi" });
    }

    const [kartuRows] = await db.query(
      `SELECT *
       FROM kartu_konsultasi_outline
       WHERE pengajuan_judul_id = ?
         AND program_studi_id IN (?)
       LIMIT 1`,
      [pengajuanJudulId, programStudiIds]
    );
    const kartu = kartuRows[0] ?? null;
    if (!kartu) {
      return res.status(404).json({ ok: false, message: "Consultation not found" });
    }

    const [stages] = await db.query(
      `SELECT
         s.*,
         d.nama AS pembimbing_nama
       FROM konsultasi_outline_stage s
       LEFT JOIN dosen d ON d.nidn = s.pembimbing_nidn
       WHERE s.kartu_konsultasi_outline_id = ?
       ORDER BY
         CASE s.stage
           WHEN 'PEMBIMBING_2' THEN 1
           WHEN 'PEMBIMBING_1' THEN 2
           ELSE 3
         END ASC`,
      [kartu.id]
    );

    const [submissions] = await db.query(
      `SELECT
         s.id,
         s.konsultasi_outline_stage_id,
         st.stage,
         s.submission_no,
         s.file_outline,
         s.file_outline_name,
         s.submitted_by_user_id,
         s.submitted_at
       FROM konsultasi_outline_submission s
       INNER JOIN konsultasi_outline_stage st ON st.id = s.konsultasi_outline_stage_id
       WHERE st.kartu_konsultasi_outline_id = ?
       ORDER BY s.submitted_at DESC`,
      [kartu.id]
    );

    const [reviews] = await db.query(
      `SELECT
         r.id,
         r.konsultasi_outline_stage_id,
         st.stage,
         r.submission_no,
         r.decision_status,
         r.catatan_mahasiswa,
         r.catatan_kartu,
         r.reviewed_at,
         rf.id AS review_file_id,
         rf.file_name AS review_file_name,
         rf.mime_type AS review_file_mime_type,
         CASE WHEN rf.id IS NULL THEN 0 ELSE 1 END AS has_review_file,
         d.nama AS reviewer_nama
       FROM konsultasi_outline_review r
       INNER JOIN konsultasi_outline_stage st ON st.id = r.konsultasi_outline_stage_id
       LEFT JOIN konsultasi_outline_review_file rf
         ON rf.konsultasi_outline_review_id = r.id
       LEFT JOIN users u ON u.id = r.reviewer_user_id
       LEFT JOIN dosen d ON d.nidn = u.nidn
       WHERE st.kartu_konsultasi_outline_id = ?
       ORDER BY r.reviewed_at DESC`,
      [kartu.id]
    );

    const [logs] = await db.query(
      `SELECT *
       FROM kartu_konsultasi_outline_log
       WHERE kartu_konsultasi_outline_id = ?
       ORDER BY logged_at ASC, id ASC`,
      [kartu.id]
    );

    const [files] = await db.query(
      `SELECT id, file_type, file_name, mime_type, generated_at, is_active
       FROM kartu_konsultasi_outline_file
       WHERE kartu_konsultasi_outline_id = ?
       ORDER BY generated_at DESC`,
      [kartu.id]
    );

    const resolved = resolveActiveStage(stages, Boolean(kartu.is_completed));

    return res.json({
      ok: true,
      data: {
        kartu,
        active_stage_id: resolved.stageRow?.id ?? null,
        active_stage: resolved.activeStage,
        active_status: resolved.activeStatus,
        stages,
        latestSubmissionOverall: submissions[0] ?? null,
        submissions,
        reviews,
        logs,
        files,
      },
    });
  } catch (err) {
    next(err);
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
         s.id AS stage_id,
         s.kartu_konsultasi_outline_id AS stage_kartu_konsultasi_outline_id,
         s.pengajuan_judul_id AS stage_pengajuan_judul_id,
         s.stage AS stage_name,
         s.pembimbing_nidn AS stage_pembimbing_nidn,
         d.nama AS stage_dosen_name,
         s.current_status AS stage_current_status,
         s.current_submission_no AS stage_current_submission_no,
         s.started_at AS stage_started_at,
         s.finished_at AS stage_finished_at,
         k.id AS kartu_id,
         k.nama_mahasiswa AS kartu_nama_mahasiswa,
         k.npm AS kartu_npm,
         k.program_studi_nama AS kartu_program_studi_nama,
         k.judul_skripsi AS kartu_judul_skripsi,
         k.pembimbing1_nidn AS kartu_pembimbing1_nidn,
         k.pembimbing1_nama AS kartu_pembimbing1_nama,
         k.pembimbing2_nidn AS kartu_pembimbing2_nidn,
         k.pembimbing2_nama AS kartu_pembimbing2_nama,
         k.is_completed AS kartu_is_completed
       FROM konsultasi_outline_stage s
       INNER JOIN kartu_konsultasi_outline k ON k.id = s.kartu_konsultasi_outline_id
       LEFT JOIN dosen d ON d.nidn = s.pembimbing_nidn
       WHERE s.id = ? AND (k.pembimbing1_nidn = ? OR k.pembimbing2_nidn = ?)
       LIMIT 1`,
      [stageId, nidn, nidn]
    );
    const row = stageRows[0] ?? null;
    if (!row) {
      return res.status(404).json({ ok: false, message: "Stage not found" });
    }

    const [submissionRows] = await db.query(
      `SELECT id, submission_no, file_outline, file_outline_name, submitted_by_user_id, submitted_at
       FROM konsultasi_outline_submission
       WHERE konsultasi_outline_stage_id = ?
       ORDER BY submission_no DESC`,
      [stageId]
    );

    const [reviewRows] = await db.query(
      `SELECT
         r.id,
         r.submission_no,
         r.decision_status,
         r.catatan_mahasiswa,
         r.catatan_kartu,
         r.reviewed_at,
         rf.id AS review_file_id,
         rf.file_name AS review_file_name,
         rf.mime_type AS review_file_mime_type,
         CASE WHEN rf.id IS NULL THEN 0 ELSE 1 END AS has_review_file
       FROM konsultasi_outline_review r
       LEFT JOIN konsultasi_outline_review_file rf
         ON rf.konsultasi_outline_review_id = r.id
       WHERE r.konsultasi_outline_stage_id = ?
       ORDER BY r.reviewed_at DESC`,
      [stageId]
    );

    const [logRows] = await db.query(
      `SELECT id, submission_no, status, catatan_kartu, logged_at
       FROM kartu_konsultasi_outline_log
       WHERE konsultasi_outline_stage_id = ?
       ORDER BY logged_at DESC`,
      [stageId]
    );

    return res.json({
      ok: true,
      data: {
        stage: {
          id: row.stage_id,
          kartuKonsultasiOutlineId: row.stage_kartu_konsultasi_outline_id,
          pengajuanJudulId: row.stage_pengajuan_judul_id,
          stage: row.stage_name,
          pembimbingNidn: row.stage_pembimbing_nidn,
          dosenName: row.stage_dosen_name,
          pembimbing1Name: row.kartu_pembimbing1_nama,
          pembimbing2Name: row.kartu_pembimbing2_nama,
          currentStatus: row.stage_current_status,
          currentSubmissionNo: row.stage_current_submission_no,
          startedAt: row.stage_started_at,
          finishedAt: row.stage_finished_at,
        },
        kartu: {
          id: row.kartu_id,
          namaMahasiswa: row.kartu_nama_mahasiswa,
          npm: row.kartu_npm,
          programStudiNama: row.kartu_program_studi_nama,
          judulSkripsi: row.kartu_judul_skripsi,
          pembimbing1Nidn: row.kartu_pembimbing1_nidn,
          pembimbing1Nama: row.kartu_pembimbing1_nama,
          pembimbing2Nidn: row.kartu_pembimbing2_nidn,
          pembimbing2Nama: row.kartu_pembimbing2_nama,
          isCompleted: Boolean(row.kartu_is_completed),
        },
        latestSubmission: submissionRows[0] ?? null,
        submissions: submissionRows,
        reviews: reviewRows,
        kartuLogs: logRows,
      },
    });
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
      decisionStatus,
      catatanMahasiswa,
      catatanKartu,
      reviewFile,
      reviewFileName,
      reviewFileMimeType,
    } = req.body || {};
    if (
      !decisionStatus ||
      !String(catatanMahasiswa || "").trim() ||
      !String(catatanKartu || "").trim()
    ) {
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
      `SELECT s.*, k.id AS kartu_id
       FROM konsultasi_outline_stage s
       INNER JOIN kartu_konsultasi_outline k ON k.id = s.kartu_konsultasi_outline_id
       WHERE s.id = ? AND s.pembimbing_nidn = ?
       LIMIT 1
       FOR UPDATE`,
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

    const [subRows] = await conn.query(
      `SELECT id, submission_no
       FROM konsultasi_outline_submission
       WHERE konsultasi_outline_stage_id = ?
       ORDER BY submission_no DESC
       LIMIT 1
       FOR UPDATE`,
      [stageId]
    );
    const latestSubmission = subRows[0] ?? null;
    if (!latestSubmission) {
      await conn.rollback();
      txStarted = false;
      return res.status(409).json({ ok: false, message: "No submission to review" });
    }

    const [existingReviewRows] = await conn.query(
      `SELECT id
       FROM konsultasi_outline_review
       WHERE konsultasi_outline_stage_id = ? AND submission_no = ?
       LIMIT 1`,
      [stageId, latestSubmission.submission_no]
    );
    if (existingReviewRows.length > 0) {
      await conn.rollback();
      txStarted = false;
      return res.status(409).json({ ok: false, message: "Submission already reviewed" });
    }

    const [reviewIns] = await conn.query(
      `INSERT INTO konsultasi_outline_review (
         konsultasi_outline_stage_id,
         submission_no,
         reviewer_user_id,
         decision_status,
         catatan_mahasiswa,
         catatan_kartu
       ) VALUES (?, ?, ?, ?, ?, ?)`,
      [
        stageId,
        latestSubmission.submission_no,
        req.user.id,
        decisionStatus,
        String(catatanMahasiswa).trim(),
        String(catatanKartu).trim(),
      ]
    );

    if (hasReviewFile) {
      await conn.query(
        `INSERT INTO konsultasi_outline_review_file (
           konsultasi_outline_review_id,
           file_type,
           file_content,
           file_name,
           mime_type,
           uploaded_by_user_id
         ) VALUES (?, 'REVIEWED_OUTLINE', ?, ?, ?, ?)`,
        [
          reviewIns.insertId,
          String(reviewFile),
          safeReviewFileName,
          reviewFileMimeType ?? null,
          req.user.id,
        ]
      );
    }

    const [reviewerRows] = await conn.query(
      `SELECT nama FROM dosen WHERE nidn = ? LIMIT 1`,
      [nidn]
    );
    const reviewerNama = reviewerRows[0]?.nama ?? null;

    await conn.query(
      `INSERT INTO kartu_konsultasi_outline_log (
         kartu_konsultasi_outline_id,
         konsultasi_outline_stage_id,
         konsultasi_outline_review_id,
         stage,
         submission_no,
         reviewer_nidn,
         reviewer_nama,
         status,
         catatan_kartu,
         logged_at
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)`,
      [
        stage.kartu_id,
        stageId,
        reviewIns.insertId,
        stage.stage,
        latestSubmission.submission_no,
        nidn,
        reviewerNama,
        decisionStatus,
        String(catatanKartu).trim(),
      ]
    );

    const stageStatusAfter = decisionStatus;
    const stageFinished = stageStatusAfter === "CONTINUE" || stageStatusAfter === "ACCEPTED";
    await conn.query(
      `UPDATE konsultasi_outline_stage
       SET
         current_status = ?,
         finished_at = CASE WHEN ? = 1 THEN CURRENT_TIMESTAMP ELSE finished_at END,
         updated_at = CURRENT_TIMESTAMP
       WHERE id = ?`,
      [stageStatusAfter, stageFinished ? 1 : 0, stageId]
    );

    if (stage.stage === "PEMBIMBING_2" && decisionStatus === "CONTINUE") {
      const [p1Rows] = await conn.query(
        `SELECT id
         FROM konsultasi_outline_stage
         WHERE kartu_konsultasi_outline_id = ? AND stage = 'PEMBIMBING_1'
         LIMIT 1
         FOR UPDATE`,
        [stage.kartu_id]
      );
      if (p1Rows.length === 0) {
        const [kRows] = await conn.query(
          `SELECT pembimbing1_nidn
           FROM kartu_konsultasi_outline
           WHERE id = ?
           LIMIT 1`,
          [stage.kartu_id]
        );
        const pembimbing1Nidn = kRows[0]?.pembimbing1_nidn ?? null;
        if (!pembimbing1Nidn) {
          await conn.rollback();
          txStarted = false;
          return res.status(409).json({ ok: false, message: "Pembimbing 1 is not assigned" });
        }
        await conn.query(
          `INSERT INTO konsultasi_outline_stage (
             kartu_konsultasi_outline_id,
             pengajuan_judul_id,
             stage,
             pembimbing_nidn,
             current_status,
             current_submission_no,
             started_at
           ) VALUES (?, ?, 'PEMBIMBING_1', ?, 'WAITING_SUBMISSION', 0, CURRENT_TIMESTAMP)`,
          [stage.kartu_id, stage.pengajuan_judul_id, pembimbing1Nidn]
        );
      }
    }

    if (stage.stage === "PEMBIMBING_1" && decisionStatus === "ACCEPTED") {
      await conn.query(
        `UPDATE kartu_konsultasi_outline
         SET is_completed = 1, completed_at = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP
         WHERE id = ?`,
        [stage.kartu_id]
      );
    }

    await conn.commit();
    txStarted = false;

    return res.json({
      ok: true,
      message: "Review saved",
      data: {
        stageId,
        submissionNo: latestSubmission.submission_no,
        decisionStatus,
        hasReviewFile,
      },
    });
  } catch (err) {
    try {
      if (txStarted) {
        await conn.rollback();
      }
    } catch (_) {}
    next(err);
  } finally {
    conn.release();
  }
};

exports.testKartuKonsultasiOutlineDocx = rebuildNotice("testKartuKonsultasiOutlineDocx");
