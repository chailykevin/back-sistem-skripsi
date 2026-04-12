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

function getRoleFlags(req) {
  const isKaprodi = req.user.hasRole("KAPRODI");
  const isLecturer = req.user.userType === "LECTURER" || req.user.hasRole("LECTURER") || isKaprodi;
  const isStudent = req.user.userType === "STUDENT";
  return { isKaprodi, isLecturer, isStudent };
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

exports.getMyFinalKartuFile = async (req, res, next) => {
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

    const wantedType =
      req.query?.type === "FINAL_DOCX" || req.query?.type === "FINAL_PDF"
        ? req.query.type
        : null;

    let sql =
      `SELECT id, file_type, file_content, file_name, mime_type, generated_at
       FROM kartu_konsultasi_outline_file
       WHERE kartu_konsultasi_outline_id = ? AND is_active = 1`;
    const params = [kartu.id];
    if (wantedType) {
      sql += " AND file_type = ?";
      params.push(wantedType);
    }
    sql += " ORDER BY generated_at DESC LIMIT 1";

    const [rows] = await db.query(sql, params);
    const file = rows[0] ?? null;
    if (!file) {
      return res.status(404).json({ ok: false, message: "Final artifact not found" });
    }

    return res.json({ ok: true, data: file });
  } catch (err) {
    next(err);
  }
};

exports.finalizeKartu = async (req, res, next) => {
  const conn = await db.getConnection();
  let txStarted = false;
  try {
    const { isKaprodi, isLecturer } = getRoleFlags(req);
    if (!isLecturer) {
      return res.status(403).json({ ok: false, message: "Only lecturers or kaprodi can finalize" });
    }

    const pengajuanJudulId = Number(req.params.pengajuanJudulId);
    if (!Number.isFinite(pengajuanJudulId) || pengajuanJudulId <= 0) {
      return res.status(400).json({ ok: false, message: "Invalid pengajuanJudulId" });
    }

    const outputType =
      req.body?.outputType === "FINAL_DOCX" || req.body?.outputType === "FINAL_PDF"
        ? req.body.outputType
        : "FINAL_PDF";
    const mimeType =
      outputType === "FINAL_DOCX"
        ? "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
        : "application/pdf";

    await conn.beginTransaction();
    txStarted = true;

    const [kRows] = await conn.query(
      `SELECT *
       FROM kartu_konsultasi_outline
       WHERE pengajuan_judul_id = ?
       LIMIT 1
       FOR UPDATE`,
      [pengajuanJudulId]
    );
    const kartu = kRows[0] ?? null;
    if (!kartu) {
      await conn.rollback();
      txStarted = false;
      return res.status(404).json({ ok: false, message: "Kartu not found" });
    }
    if (!isKaprodi) {
      const nidn = await getLecturerNidn(req.user.id);
      if (!nidn || (nidn !== kartu.pembimbing1_nidn && nidn !== kartu.pembimbing2_nidn)) {
        await conn.rollback();
        txStarted = false;
        return res.status(403).json({
          ok: false,
          message: "Only assigned lecturers or kaprodi can finalize this kartu",
        });
      }
    }

    if (!kartu.is_completed) {
      await conn.rollback();
      txStarted = false;
      return res.status(409).json({
        ok: false,
        message: "Consultation is not completed yet",
      });
    }

    const [logRows] = await conn.query(
      `SELECT stage, submission_no, reviewer_nama, status, catatan_kartu, logged_at
       FROM kartu_konsultasi_outline_log
       WHERE kartu_konsultasi_outline_id = ?
       ORDER BY logged_at ASC`,
      [kartu.id]
    );

    // Placeholder artifact: currently stored as serialized JSON,
    // not real DOCX/PDF binary bytes yet.
    const generatedText = JSON.stringify(
      {
        generated_as_placeholder: true,
        output_type: outputType,
        header: {
          nama_mahasiswa: kartu.nama_mahasiswa,
          npm: kartu.npm,
          program_studi_nama: kartu.program_studi_nama,
          judul_skripsi: kartu.judul_skripsi,
          pembimbing1_nama: kartu.pembimbing1_nama,
          pembimbing2_nama: kartu.pembimbing2_nama,
          completed_at: kartu.completed_at,
        },
        logs: logRows,
      },
      null,
      2
    );

    await conn.query(
      `UPDATE kartu_konsultasi_outline_file
       SET is_active = 0
       WHERE kartu_konsultasi_outline_id = ?
         AND file_type = ?
         AND is_active = 1`,
      [kartu.id, outputType]
    );

    const fileName = `kartu-konsultasi-outline-${kartu.pengajuan_judul_id}-${Date.now()}${
      outputType === "FINAL_DOCX" ? ".docx" : ".pdf"
    }`;

    const [ins] = await conn.query(
      `INSERT INTO kartu_konsultasi_outline_file (
         kartu_konsultasi_outline_id,
         file_type,
         file_content,
         file_name,
         mime_type,
         generated_by_user_id,
         is_active
       ) VALUES (?, ?, ?, ?, ?, ?, 1)`,
      [kartu.id, outputType, generatedText, fileName, mimeType, req.user.id]
    );

    await conn.commit();
    txStarted = false;

    return res.json({
      ok: true,
      message: "Final artifact generated",
      data: {
        id: ins.insertId,
        kartuId: kartu.id,
        fileType: outputType,
        fileName,
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

exports.getKartuFiles = async (req, res, next) => {
  try {
    const pengajuanJudulId = Number(req.params.pengajuanJudulId);
    if (!Number.isFinite(pengajuanJudulId) || pengajuanJudulId <= 0) {
      return res.status(400).json({ ok: false, message: "Invalid pengajuanJudulId" });
    }

    const [kRows] = await db.query(
      `SELECT * FROM kartu_konsultasi_outline WHERE pengajuan_judul_id = ? LIMIT 1`,
      [pengajuanJudulId]
    );
    const kartu = kRows[0] ?? null;
    if (!kartu) {
      return res.status(404).json({ ok: false, message: "Kartu not found" });
    }

    const { isStudent, isLecturer, isKaprodi } = getRoleFlags(req);
    if (isStudent) {
      const npm = await getStudentNpm(req.user.id);
      if (!npm || npm !== kartu.npm) {
        return res.status(403).json({ ok: false, message: "Forbidden" });
      }
    } else if (isKaprodi) {
      // Kaprodi can access regardless of pembimbing assignment.
    } else if (isLecturer) {
      const nidn = await getLecturerNidn(req.user.id);
      if (!nidn || (nidn !== kartu.pembimbing1_nidn && nidn !== kartu.pembimbing2_nidn)) {
        return res.status(403).json({ ok: false, message: "Forbidden" });
      }
    } else {
      return res.status(403).json({ ok: false, message: "Forbidden" });
    }

    const [rows] = await db.query(
      `SELECT id, file_type, file_name, mime_type, generated_by_user_id, generated_at, is_active
       FROM kartu_konsultasi_outline_file
       WHERE kartu_konsultasi_outline_id = ?
       ORDER BY generated_at DESC`,
      [kartu.id]
    );

    return res.json({ ok: true, data: rows });
  } catch (err) {
    next(err);
  }
};

exports.initFromApprovedPengajuan = async (req, res, next) => {
  const conn = await db.getConnection();
  let txStarted = false;
  try {
    if (!req.user.hasRole("LECTURER", "KAPRODI")) {
      return res.status(403).json({ ok: false, message: "Only lecturer/kaprodi" });
    }

    const pengajuanJudulId = Number(req.params.pengajuanJudulId);
    if (!Number.isFinite(pengajuanJudulId) || pengajuanJudulId <= 0) {
      return res.status(400).json({ ok: false, message: "Invalid pengajuanJudulId" });
    }

    await conn.beginTransaction();
    txStarted = true;

    const [pjRows] = await conn.query(
      `SELECT
         pj.id,
         pj.npm,
         pj.status,
         pj.program_studi_id,
         pj.pembimbing1_ditetapkan_nidn,
         pj.pembimbing2_ditetapkan_nidn,
         o.judul AS judul_skripsi,
         m.nama AS nama_mahasiswa,
         ps.nama AS program_studi_nama,
         d1.nama AS pembimbing1_nama,
         d2.nama AS pembimbing2_nama
       FROM pengajuan_judul pj
       INNER JOIN outline o ON o.id = pj.outline_id
       INNER JOIN mahasiswa m ON m.npm = pj.npm
       LEFT JOIN program_studi ps ON ps.id = pj.program_studi_id
       LEFT JOIN dosen d1 ON d1.nidn = pj.pembimbing1_ditetapkan_nidn
       LEFT JOIN dosen d2 ON d2.nidn = pj.pembimbing2_ditetapkan_nidn
       WHERE pj.id = ?
       LIMIT 1
       FOR UPDATE`,
      [pengajuanJudulId]
    );
    const pj = pjRows[0] ?? null;
    if (!pj) {
      await conn.rollback();
      txStarted = false;
      return res.status(404).json({ ok: false, message: "Pengajuan judul not found" });
    }

    if (pj.status !== "APPROVED") {
      await conn.rollback();
      txStarted = false;
      return res.status(409).json({ ok: false, message: "Pengajuan judul must be APPROVED" });
    }

    if (!pj.program_studi_id) {
      await conn.rollback();
      txStarted = false;
      return res.status(409).json({ ok: false, message: "Missing required snapshot data: program_studi_id" });
    }
    if (!pj.program_studi_nama || !String(pj.program_studi_nama).trim()) {
      await conn.rollback();
      txStarted = false;
      return res.status(409).json({ ok: false, message: "Missing required snapshot data: program_studi_nama" });
    }
    if (!pj.judul_skripsi || !String(pj.judul_skripsi).trim()) {
      await conn.rollback();
      txStarted = false;
      return res.status(409).json({ ok: false, message: "Missing required snapshot data: judul_skripsi" });
    }
    if (!pj.nama_mahasiswa || !String(pj.nama_mahasiswa).trim()) {
      await conn.rollback();
      txStarted = false;
      return res.status(409).json({ ok: false, message: "Missing required snapshot data: nama_mahasiswa" });
    }
    if (!pj.pembimbing2_ditetapkan_nidn || !String(pj.pembimbing2_ditetapkan_nidn).trim()) {
      await conn.rollback();
      txStarted = false;
      return res.status(409).json({ ok: false, message: "Missing required snapshot data: pembimbing2_ditetapkan_nidn" });
    }

    const [existingKartuRows] = await conn.query(
      `SELECT id
       FROM kartu_konsultasi_outline
       WHERE pengajuan_judul_id = ?
       LIMIT 1
       FOR UPDATE`,
      [pengajuanJudulId]
    );
    if (existingKartuRows.length > 0) {
      await conn.rollback();
      txStarted = false;
      return res.status(409).json({ ok: false, message: "Kartu konsultasi already initialized" });
    }

    const [insKartu] = await conn.query(
      `INSERT INTO kartu_konsultasi_outline (
         pengajuan_judul_id,
         nama_mahasiswa,
         npm,
         program_studi_id,
         program_studi_nama,
         judul_skripsi,
         pembimbing1_nidn,
         pembimbing1_nama,
         pembimbing2_nidn,
         pembimbing2_nama,
         is_completed
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0)`,
      [
        pj.id,
        String(pj.nama_mahasiswa).trim(),
        pj.npm,
        pj.program_studi_id,
        String(pj.program_studi_nama).trim(),
        String(pj.judul_skripsi).trim(),
        pj.pembimbing1_ditetapkan_nidn ?? null,
        pj.pembimbing1_nama ?? null,
        String(pj.pembimbing2_ditetapkan_nidn).trim(),
        pj.pembimbing2_nama ?? null,
      ]
    );

    await conn.query(
      `INSERT INTO konsultasi_outline_stage (
         kartu_konsultasi_outline_id,
         pengajuan_judul_id,
         stage,
         pembimbing_nidn,
         current_status,
         current_submission_no,
         started_at
       ) VALUES (?, ?, 'PEMBIMBING_2', ?, 'WAITING_SUBMISSION', 0, CURRENT_TIMESTAMP)`,
      [insKartu.insertId, pj.id, String(pj.pembimbing2_ditetapkan_nidn).trim()]
    );

    await conn.commit();
    txStarted = false;

    return res.status(201).json({
      ok: true,
      message: "Kartu konsultasi initialized",
      data: { pengajuanJudulId: pj.id, kartuId: insKartu.insertId },
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

exports.listAssignedToLecturer = async (req, res, next) => {
  try {
    if (req.user.userType !== "LECTURER" && !req.user.hasRole("KAPRODI")) {
      return res.status(403).json({ ok: false, message: "Only lecturers or kaprodi" });
    }

    const { isKaprodi } = getRoleFlags(req);
    const nidn = await getLecturerNidn(req.user.id);
    if (!isKaprodi && !nidn) {
      return res.status(400).json({ ok: false, message: "Dosen tidak valid" });
    }

    const { stage, status } = req.query || {};
    const where = [];
    const params = [];
    if (!isKaprodi) {
      where.push("s.pembimbing_nidn = ?");
      params.push(nidn);
    }
    if (stage === "PEMBIMBING_2" || stage === "PEMBIMBING_1") {
      where.push("s.stage = ?");
      params.push(stage);
    }
    if (
      [
        "WAITING_SUBMISSION",
        "SUBMITTED",
        "IN_REVIEW",
        "NEED_REVISION",
        "CONTINUE",
        "ACCEPTED",
      ].includes(status)
    ) {
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
         k.id AS kartu_id,
         k.pengajuan_judul_id,
         k.nama_mahasiswa,
         k.npm,
         k.program_studi_nama,
         k.judul_skripsi,
         k.is_completed
       FROM konsultasi_outline_stage s
       INNER JOIN kartu_konsultasi_outline k ON k.id = s.kartu_konsultasi_outline_id
       ${where.length > 0 ? `WHERE ${where.join(" AND ")}` : ""}
       ORDER BY s.updated_at DESC`,
      params
    );

    return res.json({ ok: true, data: rows });
  } catch (err) {
    next(err);
  }
};

exports.getLecturerStageDetail = async (req, res, next) => {
  try {
    if (req.user.userType !== "LECTURER" && !req.user.hasRole("KAPRODI")) {
      return res.status(403).json({ ok: false, message: "Only lecturers or kaprodi" });
    }

    const stageId = Number(req.params.stageId);
    if (!Number.isFinite(stageId) || stageId <= 0) {
      return res.status(400).json({ ok: false, message: "Invalid stageId" });
    }

    const { isKaprodi } = getRoleFlags(req);
    const nidn = await getLecturerNidn(req.user.id);
    if (!isKaprodi && !nidn) {
      return res.status(400).json({ ok: false, message: "Dosen tidak valid" });
    }

    const whereClause = isKaprodi ? "s.id = ?" : "s.id = ? AND s.pembimbing_nidn = ?";
    const whereParams = isKaprodi ? [stageId] : [stageId, nidn];

    const [stageRows] = await db.query(
      `SELECT
         s.id AS stage_id,
         s.kartu_konsultasi_outline_id AS stage_kartu_konsultasi_outline_id,
         s.pengajuan_judul_id AS stage_pengajuan_judul_id,
         s.stage AS stage_name,
         s.pembimbing_nidn AS stage_pembimbing_nidn,
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
         k.pembimbing2_nidn AS kartu_pembimbing2_nidn,
         k.is_completed AS kartu_is_completed
       FROM konsultasi_outline_stage s
       INNER JOIN kartu_konsultasi_outline k ON k.id = s.kartu_konsultasi_outline_id
       WHERE ${whereClause}
       LIMIT 1`,
      whereParams
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
          pembimbing2Nidn: row.kartu_pembimbing2_nidn,
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
    if (req.user.userType !== "LECTURER" && !req.user.hasRole("KAPRODI")) {
      return res.status(403).json({ ok: false, message: "Only lecturers or kaprodi" });
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

    const { isKaprodi } = getRoleFlags(req);
    const nidn = await getLecturerNidn(req.user.id);
    if (!nidn) {
      return res.status(400).json({ ok: false, message: "Dosen tidak valid" });
    }

    await conn.beginTransaction();
    txStarted = true;

    const whereClause = isKaprodi ? "s.id = ?" : "s.id = ? AND s.pembimbing_nidn = ?";
    const whereParams = isKaprodi ? [stageId] : [stageId, nidn];

    const [stageRows] = await conn.query(
      `SELECT s.*, k.id AS kartu_id
       FROM konsultasi_outline_stage s
       INNER JOIN kartu_konsultasi_outline k ON k.id = s.kartu_konsultasi_outline_id
       WHERE ${whereClause}
       LIMIT 1
       FOR UPDATE`,
      whereParams
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

exports.testKartuKonsultasiOutlineDocx = async (req, res, next) => {
  try {
    const templatePath = path.join(
      __dirname,
      "..",
      "templates",
      "template_kartu_konsultasi_outline.docx"
    );

    const templateBuffer = await readFile(templatePath);

    const patches = {
      nama_mahasiswa: {
        type: PatchType.PARAGRAPH,
        children: [new TextRun("Budi Santoso")],
      },
      npm: {
        type: PatchType.PARAGRAPH,
        children: [new TextRun("22123456")],
      },
      program_studi: {
        type: PatchType.PARAGRAPH,
        children: [new TextRun("Teknik Informatika")],
      },
      judul_skripsi: {
        type: PatchType.PARAGRAPH,
        children: [new TextRun("Sistem Informasi Manajemen Skripsi")],
      },
      pembimbing1: {
        type: PatchType.PARAGRAPH,
        children: [new TextRun("Dr. Pembimbing Satu")],
      },
      pembimbing2: {
        type: PatchType.PARAGRAPH,
        children: [new TextRun("Dr. Pembimbing Dua")],
      },
      ttd_pembimbing1: {
        type: PatchType.PARAGRAPH,
        children: [new TextRun("")],
      },
      ttd_pembimbing2: {
        type: PatchType.PARAGRAPH,
        children: [new TextRun("")],
      },
    };

    for (let i = 1; i <= 18; i += 1) {
      patches[`tanggal_${i}`] = {
        type: PatchType.PARAGRAPH,
        children: [new TextRun("")],
      };
      patches[`keterangan_${i}`] = {
        type: PatchType.PARAGRAPH,
        children: [new TextRun("")],
      };
      patches[`paraf_${i}`] = {
        type: PatchType.PARAGRAPH,
        children: [new TextRun("")],
      };
    }

    const outputBuffer = await patchDocument({
      outputType: "nodebuffer",
      data: templateBuffer,
      patches,
    });

    res.setHeader(
      "Content-Type",
      "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
    );
    res.setHeader(
      "Content-Disposition",
      'attachment; filename="test-kartu-konsultasi-outline.docx"'
    );

    return res.status(200).send(outputBuffer);
  } catch (err) {
    next(err);
  }
};
