const db = require("../db");
const { insertNotification } = require("../utils/notify");
const { parsePagination, listResponse } = require("../utils/pagination");
const { UPLOAD_RULES, validateUpload } = require("../utils/upload");
const { mimeFromFileName } = require("../utils/mime");
const {
  generateKartuKonsultasiOutlineFTI,
} = require("../services/generateKartuKonsultasiOutlineFTI.js");
const {
  generateHalamanPersetujuanFile,
  getSkPenulisanNameForOutline,
} = require("../services/skPenulisan.service");
const { getStudentNpm, getLecturerNidn, getStaffUsrId, getKaprodiProgramStudiIds } = require("../utils/identity");
const { getSkSubmissionPeriod } = require("../services/outlineSubmissionPeriod.service");
const { getCurrentOutlineId } = require("../services/outline.service");
const { hasSignature, assertSignatures } = require("../utils/signature");
const {
  resolveActiveKonsultasiOutlineStage: resolveActiveStage,
} = require("../utils/workflowStage");

function buildKartuFileName(npm, namaMahasiswa, suffix) {
  const safeNpm = String(npm ?? "")
    .trim()
    .replace(/[/\\:*?"<>|]+/g, "_");
  const safeNama = String(namaMahasiswa ?? "")
    .trim()
    .replace(/[/\\:*?"<>|]+/g, "_");
  return `${safeNpm} - ${safeNama} - ${suffix}.pdf`;
}

function buildKartuPreviewFileName(npm, namaMahasiswa) {
  return buildKartuFileName(
    npm,
    namaMahasiswa,
    "Kartu Konsultasi Outline Preview",
  );
}

// Kartu columns safe to put in a JSON response: no generated PDF content and no signatures
// (signatures only ever go into the PDF generator).
const KARTU_RESPONSE_COLUMNS = `
       k.id,
       k.outline_id,
       k.is_completed,
       k.completed_at,
       k.file_name,
       k.mime_type,
       k.generated_at,
       k.created_at,
       k.updated_at,
       CASE WHEN k.file_content IS NULL THEN 0 ELSE 1 END AS has_kartu_file,
       o.pembimbing1_nidn  AS pembimbing1_nidn,
       o.pembimbing2_nidn  AS pembimbing2_nidn,
       o.program_studi_id  AS program_studi_id,
       m.npm               AS npm,
       m.nama              AS nama_mahasiswa,
       ps.nama             AS program_studi_nama,
       o.judul             AS judul_skripsi,
       d1.nama             AS pembimbing1_nama,
       d2.nama             AS pembimbing2_nama`;

const KARTU_RESPONSE_JOINS = `
     FROM kartu_konsultasi_outline k
     JOIN outline o ON o.id = k.outline_id
     JOIN mahasiswa m ON m.npm = o.npm
     JOIN program_studi ps ON ps.id = o.program_studi_id
     LEFT JOIN dosen d1 ON d1.nidn = o.pembimbing1_nidn
     LEFT JOIN dosen d2 ON d2.nidn = o.pembimbing2_nidn`;

async function getKartuByOutlineId(outlineId) {
  const [rows] = await db.query(
    `SELECT ${KARTU_RESPONSE_COLUMNS}
     ${KARTU_RESPONSE_JOINS}
     WHERE k.outline_id = ?
     LIMIT 1`,
    [outlineId],
  );
  return rows[0] ?? null;
}

async function isKaprodiOfProdi(req, programStudiId) {
  if (!hasRole(req, "KAPRODI")) return false;
  const staffUsrId = await getStaffUsrId(req.user.id);
  if (!staffUsrId) return false;
  const programStudiIds = await getKaprodiProgramStudiIds(staffUsrId);
  return programStudiIds.includes(Number(programStudiId));
}

// Student owner, either assigned pembimbing, or the Kaprodi of the student's prodi.
async function canAccessOutlineConsultation(req, { npm, pembimbing1Nidn, pembimbing2Nidn, programStudiId }) {
  if (req.user.userType === "STUDENT") {
    const studentNpm = await getStudentNpm(req.user.id);
    return Boolean(studentNpm) && studentNpm === npm;
  }
  const nidn = await getLecturerNidn(req.user.id);
  if (nidn && (nidn === pembimbing1Nidn || nidn === pembimbing2Nidn)) {
    return true;
  }
  return isKaprodiOfProdi(req, programStudiId);
}

const TITLE_CHANGE_PENDING_STATUSES = [
  "WAITING_PEMBIMBING_2",
  "WAITING_PEMBIMBING_1",
];

function validateJudulUsulan(judul) {
  if (judul.length < 5) return "Judul usulan minimal 5 karakter";
  if (judul.length > 255) return "Judul usulan maksimal 255 karakter";
  return null;
}

async function getTitleChangesByOutlineId(conn, outlineId) {
  const [rows] = await conn.query(
    `SELECT
       u.id, u.outline_id, u.konsultasi_outline_submission_id,
       s.submission_no, u.diajukan_pada_stage,
       u.judul_lama, u.judul_usulan, u.alasan, u.status,
       u.pembimbing2_keputusan_at, u.pembimbing2_catatan, d2.nama AS pembimbing2_nama,
       u.pembimbing1_keputusan_at, u.pembimbing1_catatan, d1.nama AS pembimbing1_nama,
       u.alasan_penolakan, u.created_at, u.updated_at
     FROM usulan_perubahan_judul u
     JOIN outline o ON o.id = u.outline_id
     LEFT JOIN konsultasi_outline_submission s ON s.id = u.konsultasi_outline_submission_id
     LEFT JOIN dosen d1 ON d1.nidn = o.pembimbing1_nidn
     LEFT JOIN dosen d2 ON d2.nidn = o.pembimbing2_nidn
     WHERE u.outline_id = ?
     ORDER BY u.created_at DESC, u.id DESC`,
    [outlineId],
  );
  return rows;
}

const SUBMITTABLE_STAGE_STATUSES = ["WAITING_SUBMISSION", "NEED_REVISION"];

const STAGE_FILTERS = ["PEMBIMBING_2", "PEMBIMBING_1"];
const STATUS_FILTERS = [
  "WAITING_SUBMISSION",
  "SUBMITTED",
  "NEED_REVISION",
  "CONTINUE",
  "ACCEPTED",
];

// `?stage=` / `?status=` on the list endpoints; an unknown value is ignored on its own and never
// switches off the other filter.
function matchesActiveFilter(row, stage, status) {
  if (STAGE_FILTERS.includes(stage) && row.active_stage !== stage) return false;
  if (STATUS_FILTERS.includes(status) && row.active_status !== status) return false;
  return true;
}

function canReviewStageStatus(stageStatus) {
  return stageStatus === "SUBMITTED";
}

function hasRole(req, role) {
  return typeof req.user?.hasRole === "function" && req.user.hasRole(role);
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

// Every review is a kartu row; the PDF table grows onto more pages as needed. Signatures are only
// selected for PDF generation, never for a response.
async function getKartuLogs(queryable, kartuId, { withSignatures = false } = {}) {
  const [logs] = await queryable.query(
    `SELECT
       r.id,
       s.stage,
       r.submission_no,
       d.nama   AS reviewer_nama,
       ${withSignatures ? "sd.dsnTtd AS reviewer_signature," : ""}
       r.decision_status AS status,
       r.catatan_kartu,
       r.reviewed_at AS logged_at,
       rf.id AS review_file_id,
       rf.file_name AS review_file_name,
       CASE WHEN rf.id IS NULL THEN 0 ELSE 1 END AS has_review_file
     FROM konsultasi_outline_stage s
     JOIN konsultasi_outline_review r ON r.konsultasi_outline_stage_id = s.id
     LEFT JOIN users u ON u.id = r.reviewer_user_id
     LEFT JOIN dosen d ON d.nidn = u.nidn
     LEFT JOIN widya_miko.m_dosen sd ON sd.dsnId = s.pembimbing_nidn
     LEFT JOIN konsultasi_outline_review_file rf
       ON rf.konsultasi_outline_review_id = r.id
     WHERE s.kartu_konsultasi_outline_id = ?
     ORDER BY r.reviewed_at ASC, r.id ASC`,
    [kartuId],
  );
  return logs;
}

function buildKartuPdfData(kartu, logs) {
  return {
    mahasiswa: {
      nama: kartu.nama_mahasiswa,
      nomorPokok: kartu.npm,
      programStudi: kartu.program_studi_nama,
      judulSkripsi: kartu.judul_skripsi,
    },
    pembimbing: {
      pertama: {
        nama: kartu.pembimbing1_nama,
        signatureBase64: kartu.pembimbing1_signature,
      },
      kedua: {
        nama: kartu.pembimbing2_nama,
        signatureBase64: kartu.pembimbing2_signature,
      },
    },
    catatanKonsultasi: logs.map((log) => ({
      tanggal: formatKartuDate(log.logged_at),
      keterangan: `${getStageLabel(log.stage)} - ${getDecisionLabel(log.status)}: ${log.catatan_kartu ?? ""}`,
      signatureBase64: log.reviewer_signature,
    })),
  };
}

// Kartu row for PDF generation only (includes signatures). A header signature is only shown once
// that pembimbing has signed off their stage.
async function getKartuForPdf(queryable, whereColumn, value) {
  const [rows] = await queryable.query(
    `SELECT ${KARTU_RESPONSE_COLUMNS},
       CASE WHEN st1.current_status = 'ACCEPTED'
         THEN sd1.dsnTtd ELSE NULL END AS pembimbing1_signature,
       CASE WHEN st2.current_status = 'CONTINUE'
         THEN sd2.dsnTtd ELSE NULL END AS pembimbing2_signature
     ${KARTU_RESPONSE_JOINS}
     LEFT JOIN konsultasi_outline_stage st1
       ON st1.kartu_konsultasi_outline_id = k.id
       AND st1.stage = 'PEMBIMBING_1'
       AND st1.pembimbing_nidn = o.pembimbing1_nidn
     LEFT JOIN konsultasi_outline_stage st2
       ON st2.kartu_konsultasi_outline_id = k.id
       AND st2.stage = 'PEMBIMBING_2'
       AND st2.pembimbing_nidn = o.pembimbing2_nidn
     LEFT JOIN widya_miko.m_dosen sd1 ON sd1.dsnId = o.pembimbing1_nidn
     LEFT JOIN widya_miko.m_dosen sd2 ON sd2.dsnId = o.pembimbing2_nidn
     WHERE ${whereColumn} = ?
     LIMIT 1`,
    [value],
  );
  return rows[0] ?? null;
}

async function generateAndStoreFinalKartuPdf(
  queryable,
  { kartuId, generatedByUserId },
) {
  const kartu = await getKartuForPdf(queryable, "k.id", kartuId);
  if (!kartu) {
    const err = new Error("Kartu not found");
    err.statusCode = 404;
    throw err;
  }

  const logs = await getKartuLogs(queryable, kartu.id, { withSignatures: true });

  // Blocking: the final kartu goes into the SK Penelitian as an auto-verified file, so it must not
  // be stored with a blank header signature or paraf.
  assertSignatures([
    {
      role: "Pembimbing 1",
      nama: kartu.pembimbing1_nama,
      signatureImage: kartu.pembimbing1_signature,
    },
    {
      role: "Pembimbing 2",
      nama: kartu.pembimbing2_nama,
      signatureImage: kartu.pembimbing2_signature,
    },
    ...logs.map((log, index) => ({
      role: `Paraf ${index + 1} (${getStageLabel(log.stage)})`,
      nama: log.reviewer_nama,
      signatureImage: log.reviewer_signature,
    })),
  ]);

  const outputBuffer = await generateKartuKonsultasiOutlineFTI(
    buildKartuPdfData(kartu, logs),
  );
  const mimeType = "application/pdf";
  const fileName = buildKartuFileName(
    kartu.npm,
    kartu.nama_mahasiswa,
    "Kartu Konsultasi Outline",
  );

  await queryable.query(
    `UPDATE kartu_konsultasi_outline
     SET file_content = ?, file_name = ?, mime_type = ?, generated_by_user_id = ?, generated_at = CURRENT_TIMESTAMP
     WHERE id = ?`,
    [
      Buffer.from(outputBuffer).toString("base64"),
      fileName,
      mimeType,
      generatedByUserId,
      kartu.id,
    ],
  );

  return {
    kartuId: kartu.id,
    fileName,
    mimeType,
  };
}

async function autoSubmitSkPenelitian(conn, { outlineId, kartuId }) {

  const [existingRows] = await conn.query(
    `SELECT id FROM pengajuan_sk_penelitian WHERE outline_id = ? LIMIT 1`,
    [outlineId],
  );
  if (existingRows.length > 0) {
    return { skippedReason: "already_exists" };
  }

  // Outside a valid period the review still goes through; the student submits the SK from the
  // SK page once a period opens.
  const { period, message: periodMessage } = await getSkSubmissionPeriod(conn);
  if (!period) {
    return { skippedReason: "period_closed", message: periodMessage };
  }

  const [transkripRows] = await conn.query(
    `SELECT pf.file_content, pf.file_name
     FROM pengajuan_disposisi_pembimbing_file pf
     JOIN pengajuan_disposisi_pembimbing pj ON pj.id = pf.pengajuan_disposisi_pembimbing_id
     WHERE pj.outline_id = ? AND pf.file_type = 'TRANSKRIP' LIMIT 1`,
    [outlineId],
  );
  const [formulirRows] = await conn.query(
    `SELECT pf.file_content, pf.file_name
     FROM pengajuan_disposisi_pembimbing_file pf
     JOIN pengajuan_disposisi_pembimbing pj ON pj.id = pf.pengajuan_disposisi_pembimbing_id
     WHERE pj.outline_id = ? AND pf.file_type = 'PENGAJUAN_DISPOSISI_PEMBIMBING' LIMIT 1`,
    [outlineId],
  );
  const [kartuFileRows] = await conn.query(
    `SELECT file_content, file_name, mime_type FROM kartu_konsultasi_outline WHERE id = ? AND file_content IS NOT NULL LIMIT 1`,
    [kartuId],
  );
  const [outlineRows] = await conn.query(
    `SELECT s.file_outline, s.file_outline_name FROM konsultasi_outline_submission s INNER JOIN konsultasi_outline_stage st ON st.id = s.konsultasi_outline_stage_id WHERE st.kartu_konsultasi_outline_id = ? ORDER BY s.submitted_at DESC LIMIT 1`,
    [kartuId],
  );


  const missingFiles = [];
  if (formulirRows.length === 0)
    missingFiles.push("PENGAJUAN_DISPOSISI_PEMBIMBING");
  if (transkripRows.length === 0) missingFiles.push("TRANSKRIP_NILAI");
  if (kartuFileRows.length === 0) missingFiles.push("KARTU_KONSULTASI_OUTLINE");
  if (outlineRows.length === 0) missingFiles.push("FILE_OUTLINE");
  if (missingFiles.length > 0) {
    return { skippedReason: "missing_files", missingFiles };
  }

  // Blocking: a missing signature aborts the outline review rather than leave the SK stuck.
  const halamanFile = await generateHalamanPersetujuanFile(conn, outlineId);

  const [ins] = await conn.query(
    `INSERT INTO pengajuan_sk_penelitian (outline_id, submission_period_id, status, submitted_at)
     VALUES (?, ?, 'SUBMITTED', CURRENT_TIMESTAMP)`,
    [outlineId, period.id],
  );
  const skId = ins.insertId;

  const files = [
    {
      type: "PENGAJUAN_DISPOSISI_PEMBIMBING",
      name: formulirRows[0].file_name,
      mime: "application/pdf",
      content: formulirRows[0].file_content,
      status: "VERIFIED",
    },
    {
      type: "TRANSKRIP_NILAI",
      name: transkripRows[0].file_name,
      mime: mimeFromFileName(transkripRows[0].file_name),
      content: transkripRows[0].file_content,
      status: "SUBMITTED",
    },
    {
      type: "KARTU_KONSULTASI_OUTLINE",
      name: kartuFileRows[0].file_name,
      mime: kartuFileRows[0].mime_type,
      content: kartuFileRows[0].file_content,
      status: "VERIFIED",
    },
    {
      type: "FILE_OUTLINE",
      name: outlineRows[0].file_outline_name,
      mime: mimeFromFileName(outlineRows[0].file_outline_name),
      content: outlineRows[0].file_outline,
      status: "VERIFIED",
    },
    {
      type: "HALAMAN_PERSETUJUAN",
      name: halamanFile.fileName,
      mime: halamanFile.mimeType,
      content: halamanFile.content,
      status: "VERIFIED",
    },
  ];
  for (const f of files) {
    await conn.query(
      `INSERT INTO pengajuan_sk_penelitian_files (pengajuan_sk_penelitian_id, file_type, file_name, mime_type, file_content, source, status) VALUES (?, ?, ?, ?, ?, 'SYSTEM', ?)`,
      [skId, f.type, f.name, f.mime, f.content, f.status],
    );
  }

  return { skippedReason: null, skId };
}

function kartuFileInfo(kartu) {
  return Number(kartu.has_kartu_file)
    ? {
        file_name: kartu.file_name,
        mime_type: kartu.mime_type,
        generated_at: kartu.generated_at,
      }
    : null;
}

function consultationAccessOf(row) {
  return {
    npm: row.npm,
    pembimbing1Nidn: row.pembimbing1_nidn,
    pembimbing2Nidn: row.pembimbing2_nidn,
    programStudiId: row.program_studi_id,
  };
}

exports.listMine = async (req, res, next) => {
  try {
    if (req.user.userType !== "STUDENT") {
      return res.status(403).json({ ok: false, message: "Only students" });
    }

    const npm = await getStudentNpm(req.user.id);
    if (!npm) {
      return res
        .status(400)
        .json({ ok: false, message: "Mahasiswa tidak valid" });
    }

    const currentOutlineId = await getCurrentOutlineId(npm);
    const [kartuRows] = await db.query(
      `SELECT
         k.id AS kartu_id,
         k.outline_id,
         o.judul AS judul_skripsi,
         k.is_completed,
         k.completed_at,
         k.created_at
       FROM kartu_konsultasi_outline k
       JOIN outline o ON o.id = k.outline_id
       WHERE o.npm = ? AND k.outline_id = ?
       ORDER BY k.created_at DESC`,
      [npm, currentOutlineId],
    );

    // The kartu is created when Kaprodi approves the disposisi, so none yet means nothing to show.
    if (kartuRows.length === 0) {
      return res.json({ ok: true, data: [] });
    }

    const kartuIds = kartuRows.map((r) => r.kartu_id);
    const [stageRows] = await db.query(
      `SELECT id, kartu_konsultasi_outline_id, stage, current_status
       FROM konsultasi_outline_stage
       WHERE kartu_konsultasi_outline_id IN (?)`,
      [kartuIds],
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

    const outlineId = Number(req.params.outlineId);
    if (!Number.isFinite(outlineId) || outlineId <= 0) {
      return res.status(400).json({ ok: false, message: "Invalid outlineId" });
    }

    const npm = await getStudentNpm(req.user.id);
    if (!npm) {
      return res
        .status(400)
        .json({ ok: false, message: "Mahasiswa tidak valid" });
    }

    const kartu = await getKartuByOutlineId(outlineId);
    if (!kartu) {
      return res
        .status(404)
        .json({ ok: false, message: "Consultation not found" });
    }
    if (!npm || npm !== kartu.npm) {
      return res.status(403).json({ ok: false, message: "Forbidden" });
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
      [kartu.id],
    );

    const [submissions] = await db.query(
      `SELECT
         s.id,
         s.konsultasi_outline_stage_id,
         st.stage,
         s.submission_no,
         CASE WHEN s.file_outline IS NULL THEN 0 ELSE 1 END AS has_file_outline,
         s.file_outline_name,
         s.submitted_at
       FROM konsultasi_outline_submission s
       INNER JOIN konsultasi_outline_stage st ON st.id = s.konsultasi_outline_stage_id
       WHERE st.kartu_konsultasi_outline_id = ?
       ORDER BY s.submitted_at DESC`,
      [kartu.id],
    );

    const [reviews] = await db.query(
      `SELECT
         r.id,
         r.konsultasi_outline_stage_id,
         st.stage,
         r.submission_no,
         r.decision_status,
         r.catatan_kartu,
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
      [kartu.id],
    );

    const titleChanges = await getTitleChangesByOutlineId(db, outlineId);
    const hasPendingTitleChange = titleChanges.some((t) =>
      TITLE_CHANGE_PENDING_STATUSES.includes(t.status),
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
        titleChanges,
        canProposeTitleChange:
          !Number(kartu.is_completed) && !hasPendingTitleChange,
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

    const outlineId = Number(req.params.outlineId);
    if (!Number.isFinite(outlineId) || outlineId <= 0) {
      return res.status(400).json({ ok: false, message: "Invalid outlineId" });
    }

    const { fileOutline, fileOutlineName } = req.body || {};
    const judulUsulan = String(req.body?.judulUsulan ?? "").trim();
    const alasanPerubahanJudul = String(
      req.body?.alasanPerubahanJudul ?? "",
    ).trim();
    const hasTitleProposal = judulUsulan.length > 0;
    const safeFileOutlineName = String(fileOutlineName ?? "").trim();
    if (!fileOutline) {
      return res
        .status(400)
        .json({ ok: false, message: "fileOutline is required" });
    }
    if (!fileOutlineName || !safeFileOutlineName) {
      return res
        .status(400)
        .json({ ok: false, message: "fileOutlineName is required" });
    }
    const uploadError = validateUpload(
      fileOutline,
      safeFileOutlineName,
      UPLOAD_RULES.DOCUMENT,
      "File outline",
    );
    if (uploadError) {
      return res.status(400).json({ ok: false, message: uploadError });
    }
    if (hasTitleProposal) {
      const judulError = validateJudulUsulan(judulUsulan);
      if (judulError) {
        return res.status(400).json({ ok: false, message: judulError });
      }
      if (!alasanPerubahanJudul) {
        return res.status(400).json({
          ok: false,
          message: "Alasan perubahan judul wajib diisi",
        });
      }
    }

    const npm = await getStudentNpm(req.user.id);
    if (!npm) {
      return res
        .status(400)
        .json({ ok: false, message: "Mahasiswa tidak valid" });
    }

    await conn.beginTransaction();
    txStarted = true;

    const [kartuRows] = await conn.query(
      `SELECT k.id, k.is_completed
       FROM kartu_konsultasi_outline k
       JOIN outline o ON o.id = k.outline_id
       WHERE k.outline_id = ? AND o.npm = ?
       LIMIT 1
       FOR UPDATE`,
      [outlineId, npm],
    );
    const kartu = kartuRows[0] ?? null;
    if (!kartu) {
      await conn.rollback();
      txStarted = false;
      return res
        .status(404)
        .json({ ok: false, message: "Consultation not found" });
    }
    if (Number(kartu.is_completed) === 1) {
      await conn.rollback();
      txStarted = false;
      return res
        .status(409)
        .json({ ok: false, message: "Consultation is already completed" });
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
      [kartu.id],
    );

    const resolved = resolveActiveStage(stageRows, false);
    if (!resolved.stageRow) {
      await conn.rollback();
      txStarted = false;
      const hasP2 = stageRows.some((s) => s.stage === "PEMBIMBING_2");
      if (!hasP2) {
        return res.status(409).json({
          ok: false,
          message: "Stage PEMBIMBING_2 is not initialized",
        });
      }
      return res.status(409).json({
        ok: false,
        message: "Stage PEMBIMBING_1 is not initialized yet",
      });
    }
    const activeStage = resolved.stageRow;

    // A file can only be sent when the stage is waiting for one: not while the previous submission
    // is still waiting for review, and not after the stage is accepted.
    if (!SUBMITTABLE_STAGE_STATUSES.includes(activeStage.current_status)) {
      await conn.rollback();
      txStarted = false;
      return res.status(409).json({
        ok: false,
        message:
          activeStage.current_status === "SUBMITTED"
            ? "File sebelumnya masih menunggu review dosen pembimbing"
            : "Tahap ini tidak menerima pengajuan file",
      });
    }

    let judulLama = null;
    if (hasTitleProposal) {
      const [[outlineRow]] = await conn.query(
        `SELECT judul FROM outline WHERE id = ? LIMIT 1 FOR UPDATE`,
        [outlineId],
      );
      judulLama = outlineRow?.judul ?? "";
      if (judulUsulan === String(judulLama).trim()) {
        await conn.rollback();
        txStarted = false;
        return res.status(400).json({
          ok: false,
          message: "Judul usulan sama dengan judul saat ini",
        });
      }
      const [pendingRows] = await conn.query(
        `SELECT id FROM usulan_perubahan_judul
         WHERE outline_id = ? AND status IN (?)
         LIMIT 1`,
        [outlineId, TITLE_CHANGE_PENDING_STATUSES],
      );
      if (pendingRows.length > 0) {
        await conn.rollback();
        txStarted = false;
        return res.status(409).json({
          ok: false,
          message:
            "Masih ada usulan perubahan judul yang menunggu keputusan pembimbing",
        });
      }
    }

    const nextSubmissionNo = Number(activeStage.current_submission_no || 0) + 1;

    const [submissionIns] = await conn.query(
      `INSERT INTO konsultasi_outline_submission (
         konsultasi_outline_stage_id,
         submission_no,
         file_outline,
         file_outline_name,
         submitted_by_user_id
      ) VALUES (?, ?, ?, ?, ?)`,
      [
        activeStage.id,
        nextSubmissionNo,
        String(fileOutline),
        safeFileOutlineName,
        req.user.id,
      ],
    );

    let titleChangeId = null;
    if (hasTitleProposal) {
      const [titleIns] = await conn.query(
        `INSERT INTO usulan_perubahan_judul (
           outline_id,
           konsultasi_outline_submission_id,
           diajukan_pada_stage,
           judul_lama,
           judul_usulan,
           alasan,
           status
         ) VALUES (?, ?, ?, ?, ?, ?, ?)`,
        [
          outlineId,
          submissionIns.insertId,
          activeStage.stage,
          judulLama,
          judulUsulan,
          alasanPerubahanJudul,
          activeStage.stage === "PEMBIMBING_2"
            ? "WAITING_PEMBIMBING_2"
            : "WAITING_PEMBIMBING_1",
        ],
      );
      titleChangeId = titleIns.insertId;
    }

    await conn.query(
      `UPDATE konsultasi_outline_stage
       SET
         current_submission_no = ?,
         current_status = 'SUBMITTED',
         updated_at = CURRENT_TIMESTAMP
       WHERE id = ?`,
      [nextSubmissionNo, activeStage.id],
    );

    const [pUserRows] = await conn.query(
      `SELECT u.id FROM users u
       JOIN user_roles ur ON ur.user_id = u.id
       JOIN roles r ON r.id = ur.role_id
       WHERE u.nidn = ? AND r.code = 'PEMBIMBING'
       LIMIT 1`,
      [activeStage.pembimbing_nidn],
    );
    if (pUserRows[0]?.id) {
      const [mRows] = await conn.query(
        `SELECT m.nama FROM mahasiswa m WHERE m.npm = ? LIMIT 1`,
        [npm],
      );
      const namaMahasiswa = mRows[0]?.nama ?? npm;
      await insertNotification(
        conn,
        pUserRows[0].id,
        "OUTLINE_CONSULTATION_SUBMITTED",
        hasTitleProposal
          ? `Mahasiswa ${namaMahasiswa} mengumpulkan file outline beserta usulan perubahan judul`
          : `Mahasiswa ${namaMahasiswa} mengumpulkan file outline untuk dikonsultasikan`,
        "/pembimbing/outline-consultations",
      );
    }

    await conn.commit();
    txStarted = false;

    return res.status(201).json({
      ok: true,
      message: "Submission saved",
      data: {
        stageId: activeStage.id,
        stage: activeStage.stage,
        submissionNo: nextSubmissionNo,
        titleChangeId,
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

    const outlineId = Number(req.params.outlineId);
    if (!Number.isFinite(outlineId) || outlineId <= 0) {
      return res.status(400).json({ ok: false, message: "Invalid outlineId" });
    }

    const npm = await getStudentNpm(req.user.id);
    if (!npm) {
      return res
        .status(400)
        .json({ ok: false, message: "Mahasiswa tidak valid" });
    }

    const kartu = await getKartuByOutlineId(outlineId);
    if (!kartu) {
      return res
        .status(404)
        .json({ ok: false, message: "Consultation not found" });
    }
    if (npm !== kartu.npm) {
      return res.status(403).json({ ok: false, message: "Forbidden" });
    }

    const [rows] = await db.query(
      `SELECT
         r.id,
         st.stage,
         r.submission_no,
         r.decision_status,
         r.catatan_kartu,
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
      [kartu.id],
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

    const outlineId = Number(req.params.outlineId);
    if (!Number.isFinite(outlineId) || outlineId <= 0) {
      return res.status(400).json({ ok: false, message: "Invalid outlineId" });
    }

    const npm = await getStudentNpm(req.user.id);
    if (!npm) {
      return res
        .status(400)
        .json({ ok: false, message: "Mahasiswa tidak valid" });
    }

    const kartu = await getKartuByOutlineId(outlineId);
    if (!kartu) {
      return res
        .status(404)
        .json({ ok: false, message: "Consultation not found" });
    }
    if (npm !== kartu.npm) {
      return res.status(403).json({ ok: false, message: "Forbidden" });
    }

    const logs = await getKartuLogs(db, kartu.id);

    return res.json({
      ok: true,
      data: { kartu, logs, file: kartuFileInfo(kartu) },
    });
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
         rf.id, rf.file_content, rf.file_name, rf.mime_type,
         o.npm, o.pembimbing1_nidn, o.pembimbing2_nidn, o.program_studi_id
       FROM konsultasi_outline_review_file rf
       INNER JOIN konsultasi_outline_review r ON r.id = rf.konsultasi_outline_review_id
       INNER JOIN konsultasi_outline_stage st ON st.id = r.konsultasi_outline_stage_id
       INNER JOIN kartu_konsultasi_outline k ON k.id = st.kartu_konsultasi_outline_id
       JOIN outline o ON o.id = k.outline_id
       WHERE rf.konsultasi_outline_review_id = ?
       LIMIT 1`,
      [reviewId],
    );
    const file = rows[0] ?? null;
    if (!file) {
      return res
        .status(404)
        .json({ ok: false, message: "Review file not found" });
    }

    if (!(await canAccessOutlineConsultation(req, consultationAccessOf(file)))) {
      return res.status(403).json({ ok: false, message: "Forbidden" });
    }

    return res.json({
      ok: true,
      data: {
        file_name: file.file_name,
        mime_type: file.mime_type ?? mimeFromFileName(file.file_name),
        file_content: file.file_content,
      },
    });
  } catch (err) {
    next(err);
  }
};

exports.getSubmissionFile = async (req, res, next) => {
  try {
    const submissionId = Number(req.params.submissionId);
    if (!Number.isFinite(submissionId) || submissionId <= 0) {
      return res
        .status(400)
        .json({ ok: false, message: "Invalid submissionId" });
    }

    const [rows] = await db.query(
      `SELECT
         s.file_outline, s.file_outline_name,
         o.npm, o.pembimbing1_nidn, o.pembimbing2_nidn, o.program_studi_id
       FROM konsultasi_outline_submission s
       INNER JOIN konsultasi_outline_stage st ON st.id = s.konsultasi_outline_stage_id
       INNER JOIN kartu_konsultasi_outline k ON k.id = st.kartu_konsultasi_outline_id
       JOIN outline o ON o.id = k.outline_id
       WHERE s.id = ?
       LIMIT 1`,
      [submissionId],
    );
    const submission = rows[0] ?? null;
    if (!submission || !submission.file_outline) {
      return res
        .status(404)
        .json({ ok: false, message: "File pengajuan tidak ditemukan" });
    }

    if (
      !(await canAccessOutlineConsultation(req, consultationAccessOf(submission)))
    ) {
      return res.status(403).json({ ok: false, message: "Forbidden" });
    }

    return res.json({
      ok: true,
      data: {
        file_name: submission.file_outline_name,
        mime_type: mimeFromFileName(submission.file_outline_name),
        file_content: submission.file_outline,
      },
    });
  } catch (err) {
    next(err);
  }
};

exports.getMyFinalKartuFile = async (req, res, next) => {
  try {
    const outlineId = Number(req.params.outlineId);
    if (!Number.isFinite(outlineId) || outlineId <= 0) {
      return res.status(400).json({ ok: false, message: "Invalid outlineId" });
    }

    const [kartuRows] = await db.query(
      `SELECT o.npm AS npm, o.pembimbing1_nidn, o.pembimbing2_nidn, o.program_studi_id,
              k.file_content, k.file_name, k.mime_type, k.generated_at
       FROM kartu_konsultasi_outline k
       JOIN outline o ON o.id = k.outline_id
       WHERE k.outline_id = ?
       LIMIT 1`,
      [outlineId],
    );
    const kartu = kartuRows[0] ?? null;
    if (!kartu) {
      return res
        .status(404)
        .json({ ok: false, message: "Consultation not found" });
    }

    if (!(await canAccessOutlineConsultation(req, consultationAccessOf(kartu)))) {
      return res.status(403).json({ ok: false, message: "Forbidden" });
    }

    if (!kartu.file_content) {
      return res
        .status(404)
        .json({ ok: false, message: "Final artifact not found" });
    }

    const fileBuffer = Buffer.from(kartu.file_content, "base64");
    res.setHeader("Content-Type", kartu.mime_type);
    res.setHeader(
      "Content-Disposition",
      `attachment; filename="${kartu.file_name}"`,
    );
    res.setHeader("Content-Length", fileBuffer.length);
    return res.send(fileBuffer);
  } catch (err) {
    next(err);
  }
};

exports.previewKartuPdf = async (req, res, next) => {
  try {
    const outlineId = Number(req.params.outlineId);
    if (!Number.isFinite(outlineId) || outlineId <= 0) {
      return res.status(400).json({ ok: false, message: "Invalid outlineId" });
    }

    const kartu = await getKartuForPdf(db, "k.outline_id", outlineId);
    if (!kartu) {
      return res.status(404).json({ ok: false, message: "Kartu not found" });
    }
    if (!(await canAccessOutlineConsultation(req, consultationAccessOf(kartu)))) {
      return res.status(403).json({ ok: false, message: "Forbidden" });
    }

    const logs = await getKartuLogs(db, kartu.id, { withSignatures: true });
    const outputBuffer = await generateKartuKonsultasiOutlineFTI(
      buildKartuPdfData(kartu, logs),
    );

    const fileName = buildKartuPreviewFileName(kartu.npm, kartu.nama_mahasiswa);

    res.setHeader("Content-Type", "application/pdf");
    res.setHeader("Content-Disposition", `attachment; filename="${fileName}"`);
    res.setHeader("Content-Length", outputBuffer.length);
    return res.send(outputBuffer);
  } catch (err) {
    next(err);
  }
};

exports.listAssignedToLecturer = async (req, res, next) => {
  try {
    if (req.user.userType !== "LECTURER") {
      return res.status(403).json({ ok: false, message: "Only lecturers" });
    }

    const nidn = await getLecturerNidn(req.user.id);
    if (!nidn) {
      return res.status(400).json({ ok: false, message: "Dosen tidak valid" });
    }

    const { stage } = req.query || {};
    const where = ["s.pembimbing_nidn = ?", "s.current_status = 'SUBMITTED'"];
    const params = [nidn];

    if (stage === "PEMBIMBING_2" || stage === "PEMBIMBING_1") {
      where.push("s.stage = ?");
      params.push(stage);
    }

    const [rows] = await db.query(
      `SELECT
         s.id AS stage_id,
         s.stage,
         s.current_status,
         s.current_submission_no,
         s.started_at,
         s.finished_at,
         (SELECT MAX(sub.submitted_at)
            FROM konsultasi_outline_submission sub
           WHERE sub.konsultasi_outline_stage_id = s.id) AS latest_submitted_at,
         k.id AS kartu_id,
         k.outline_id,
         m.nama AS nama_mahasiswa,
         m.npm,
         ps.nama AS program_studi_nama,
         o.judul AS judul_skripsi,
         k.is_completed
       FROM konsultasi_outline_stage s
       INNER JOIN kartu_konsultasi_outline k ON k.id = s.kartu_konsultasi_outline_id
       JOIN outline o ON o.id = k.outline_id
       JOIN mahasiswa m ON m.npm = o.npm
       JOIN program_studi ps ON ps.id = o.program_studi_id
       WHERE ${where.join(" AND ")}
       ORDER BY s.updated_at DESC`,
      params,
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
         k.outline_id,
         m.nama AS nama_mahasiswa,
         m.npm,
         ps.nama AS program_studi_nama,
         o.judul AS judul_skripsi,
         o.pembimbing1_nidn,
         d1.nama AS pembimbing1_nama,
         o.pembimbing2_nidn,
         d2.nama AS pembimbing2_nama,
         k.is_completed,
         k.completed_at,
         k.created_at,
         k.updated_at
       FROM kartu_konsultasi_outline k
       JOIN outline o ON o.id = k.outline_id
       JOIN mahasiswa m ON m.npm = o.npm
       JOIN program_studi ps ON ps.id = o.program_studi_id
       LEFT JOIN dosen d1 ON d1.nidn = o.pembimbing1_nidn
       LEFT JOIN dosen d2 ON d2.nidn = o.pembimbing2_nidn
       WHERE o.pembimbing1_nidn = ? OR o.pembimbing2_nidn = ?
       ORDER BY k.updated_at DESC`,
      [nidn, nidn],
    );

    if (kartuRows.length === 0) {
      return res.json({ ok: true, data: [] });
    }

    const kartuIds = kartuRows.map((r) => r.kartu_id);
    const [stageRows] = await db.query(
      `SELECT
         id,
         kartu_konsultasi_outline_id,
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
      [kartuIds],
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
      .filter((row) => matchesActiveFilter(row, stage, status));

    return res.json({ ok: true, data: rows });
  } catch (err) {
    next(err);
  }
};

exports.listForKaprodi = async (req, res, next) => {
  try {
    if (!hasRole(req, "KAPRODI")) {
      return res
        .status(403)
        .json({ ok: false, message: "Only kaprodi can access this endpoint" });
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

    const { stage, status, q, tahunAkademik, periodeAkademik } =
      req.query || {};
    const pagination = parsePagination(req.query);
    const where = ["o.program_studi_id IN (?)"];
    const params = [programStudiIds];

    if (q && String(q).trim().length > 0) {
      const queryValue = `%${String(q).trim()}%`;
      where.push("(m.nama LIKE ? OR m.npm LIKE ? OR o.judul LIKE ?)");
      params.push(queryValue, queryValue, queryValue);
    }

    if (tahunAkademik) {
      where.push("osp.tahun_akademik = ?");
      params.push(String(tahunAkademik));
    }

    if (periodeAkademik) {
      where.push("osp.periode_akademik = ?");
      params.push(String(periodeAkademik));
    }

    const [kartuRows] = await db.query(
      `SELECT
         k.id AS kartu_id,
         k.outline_id,
         m.nama AS nama_mahasiswa,
         m.npm,
         o.program_studi_id,
         ps.nama AS program_studi_nama,
         o.judul AS judul_skripsi,
         o.pembimbing1_nidn,
         d1.nama AS pembimbing1_nama,
         o.pembimbing2_nidn,
         d2.nama AS pembimbing2_nama,
         k.is_completed,
         k.completed_at,
         k.created_at,
         k.updated_at,
         o.submission_period_id,
         osp.tahun_akademik AS period_tahun_akademik,
         osp.periode_akademik AS period_periode_akademik
       FROM kartu_konsultasi_outline k
       JOIN outline o ON o.id = k.outline_id
       JOIN mahasiswa m ON m.npm = o.npm
       JOIN program_studi ps ON ps.id = o.program_studi_id
       LEFT JOIN dosen d1 ON d1.nidn = o.pembimbing1_nidn
       LEFT JOIN dosen d2 ON d2.nidn = o.pembimbing2_nidn
       LEFT JOIN outline_submission_period osp ON osp.id = o.submission_period_id
       WHERE ${where.join(" AND ")}
       ORDER BY k.updated_at DESC`,
      params,
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
      [kartuIds],
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
        const resolved = resolveActiveStage(
          stages,
          Boolean(kartu.is_completed),
        );
        return {
          ...kartu,
          active_stage_id: resolved.stageRow?.id ?? null,
          active_stage: resolved.activeStage,
          active_status: resolved.activeStatus,
          active_submission_no:
            resolved.stageRow?.current_submission_no ?? null,
          stages,
        };
      })
      .filter((row) => matchesActiveFilter(row, stage, status));

    pagination.totalItems = rows.length;
    const pageRows = pagination.enabled
      ? rows.slice(pagination.offset, pagination.offset + pagination.limit)
      : rows;
    return listResponse(res, { rows: pageRows, pagination });
  } catch (err) {
    next(err);
  }
};

exports.getDetailForKaprodi = async (req, res, next) => {
  try {
    if (!hasRole(req, "KAPRODI")) {
      return res
        .status(403)
        .json({ ok: false, message: "Only kaprodi can access this endpoint" });
    }

    const outlineId = Number(req.params.outlineId);
    if (!Number.isFinite(outlineId) || outlineId <= 0) {
      return res.status(400).json({ ok: false, message: "Invalid outlineId" });
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

    const [kartuRows] = await db.query(
      `SELECT ${KARTU_RESPONSE_COLUMNS}
       ${KARTU_RESPONSE_JOINS}
       WHERE k.outline_id = ?
         AND o.program_studi_id IN (?)
       LIMIT 1`,
      [outlineId, programStudiIds],
    );
    const kartu = kartuRows[0] ?? null;
    if (!kartu) {
      return res
        .status(404)
        .json({ ok: false, message: "Consultation not found" });
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
      [kartu.id],
    );

    const [submissions] = await db.query(
      `SELECT
         s.id,
         s.konsultasi_outline_stage_id,
         st.stage,
         s.submission_no,
         CASE WHEN s.file_outline IS NULL THEN 0 ELSE 1 END AS has_file_outline,
         s.file_outline_name,
         s.submitted_by_user_id,
         s.submitted_at
       FROM konsultasi_outline_submission s
       INNER JOIN konsultasi_outline_stage st ON st.id = s.konsultasi_outline_stage_id
       WHERE st.kartu_konsultasi_outline_id = ?
       ORDER BY s.submitted_at DESC`,
      [kartu.id],
    );

    const [reviews] = await db.query(
      `SELECT
         r.id,
         r.konsultasi_outline_stage_id,
         st.stage,
         r.submission_no,
         r.decision_status,
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
      [kartu.id],
    );

    const file = kartuFileInfo(kartu);

    const resolved = resolveActiveStage(stages, Boolean(kartu.is_completed));
    const logs = await getKartuLogs(db, kartu.id);

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
        file,
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
         s.stage AS stage_name,
         s.pembimbing_nidn AS stage_pembimbing_nidn,
         d.nama AS stage_dosen_name,
         s.current_status AS stage_current_status,
         s.current_submission_no AS stage_current_submission_no,
         s.started_at AS stage_started_at,
         s.finished_at AS stage_finished_at,
         k.id AS kartu_id,
         o.id AS kartu_outline_id,
         m.nama AS kartu_nama_mahasiswa,
         m.npm AS kartu_npm,
         ps.nama AS kartu_program_studi_nama,
         o.judul AS kartu_judul_skripsi,
         o.pembimbing1_nidn AS kartu_pembimbing1_nidn,
         d1.nama AS kartu_pembimbing1_nama,
         o.pembimbing2_nidn AS kartu_pembimbing2_nidn,
         d2.nama AS kartu_pembimbing2_nama,
         k.is_completed AS kartu_is_completed
       FROM konsultasi_outline_stage s
       INNER JOIN kartu_konsultasi_outline k ON k.id = s.kartu_konsultasi_outline_id
       LEFT JOIN dosen d ON d.nidn = s.pembimbing_nidn
       JOIN outline o ON o.id = k.outline_id
       JOIN mahasiswa m ON m.npm = o.npm
       JOIN program_studi ps ON ps.id = o.program_studi_id
       LEFT JOIN dosen d1 ON d1.nidn = o.pembimbing1_nidn
       LEFT JOIN dosen d2 ON d2.nidn = o.pembimbing2_nidn
       WHERE s.id = ? AND (o.pembimbing1_nidn = ? OR o.pembimbing2_nidn = ?)
       LIMIT 1`,
      [stageId, nidn, nidn],
    );
    const row = stageRows[0] ?? null;
    if (!row) {
      return res.status(404).json({ ok: false, message: "Stage not found" });
    }

    const [submissionRows] = await db.query(
      `SELECT id, submission_no,
              CASE WHEN file_outline IS NULL THEN 0 ELSE 1 END AS has_file_outline,
              file_outline_name, submitted_by_user_id, submitted_at
       FROM konsultasi_outline_submission
       WHERE konsultasi_outline_stage_id = ?
       ORDER BY submission_no DESC`,
      [stageId],
    );

    const [reviewRows] = await db.query(
      `SELECT
         r.id,
         r.konsultasi_outline_stage_id,
         rs.stage,
         r.submission_no,
         r.decision_status,
         r.catatan_kartu,
         r.reviewed_at,
         rf.id AS review_file_id,
         rf.file_name AS review_file_name,
         rf.mime_type AS review_file_mime_type,
         CASE WHEN rf.id IS NULL THEN 0 ELSE 1 END AS has_review_file
       FROM konsultasi_outline_review r
       INNER JOIN konsultasi_outline_stage rs
         ON rs.id = r.konsultasi_outline_stage_id
       LEFT JOIN konsultasi_outline_review_file rf
         ON rf.konsultasi_outline_review_id = r.id
       WHERE rs.kartu_konsultasi_outline_id = ?
       ORDER BY r.reviewed_at DESC`,
      [row.kartu_id],
    );

    const kartuLogs = await getKartuLogs(db, row.kartu_id);

    const titleChanges = await getTitleChangesByOutlineId(
      db,
      row.kartu_outline_id,
    );
    const awaitingStatus =
      row.stage_name === "PEMBIMBING_2"
        ? "WAITING_PEMBIMBING_2"
        : "WAITING_PEMBIMBING_1";
    const pendingTitleChange =
      row.stage_pembimbing_nidn === nidn
        ? (titleChanges.find((t) => t.status === awaitingStatus) ?? null)
        : null;

    return res.json({
      ok: true,
      data: {
        pendingTitleChange,
        titleChanges,
        stage: {
          id: row.stage_id,
          kartuKonsultasiOutlineId: row.stage_kartu_konsultasi_outline_id,
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
          outlineId: row.kartu_outline_id,
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
        kartuLogs,
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
      catatanKartu,
      reviewFile,
      reviewFileName,
      titleDecision,
      titleCatatan,
      titleAlasanPenolakan,
    } = req.body || {};
    const hasTitleDecision =
      titleDecision !== undefined && titleDecision !== null && titleDecision !== "";
    if (hasTitleDecision && !["APPROVE", "REJECT"].includes(titleDecision)) {
      return res.status(400).json({
        ok: false,
        message: "titleDecision must be APPROVE or REJECT",
      });
    }
    const safeTitleCatatan = String(titleCatatan ?? "").trim() || null;
    const safeTitleAlasanPenolakan = String(titleAlasanPenolakan ?? "").trim();
    if (titleDecision === "REJECT" && !safeTitleAlasanPenolakan) {
      return res.status(400).json({
        ok: false,
        message: "Alasan penolakan usulan judul wajib diisi",
      });
    }
    if (!decisionStatus || !String(catatanKartu || "").trim()) {
      return res.status(400).json({
        ok: false,
        message: "decisionStatus and catatanKartu are required",
      });
    }

    const hasReviewFile =
      reviewFile !== undefined &&
      reviewFile !== null &&
      String(reviewFile) !== "";
    const safeReviewFileName = String(reviewFileName ?? "").trim();
    if (hasReviewFile && !safeReviewFileName) {
      return res.status(400).json({
        ok: false,
        message: "reviewFileName is required when reviewFile is provided",
      });
    }
    if (hasReviewFile) {
      const uploadError = validateUpload(
        reviewFile,
        safeReviewFileName,
        UPLOAD_RULES.DOCUMENT,
        "File review",
      );
      if (uploadError) {
        return res.status(400).json({ ok: false, message: uploadError });
      }
    }

    const nidn = await getLecturerNidn(req.user.id);
    if (!nidn) {
      return res.status(400).json({ ok: false, message: "Dosen tidak valid" });
    }

    // Lock the kartu before the stage, the same order as submitMyOutline, so a student submit
    // and a review can't deadlock. The kartu id is looked up before the transaction so this
    // plain read doesn't fix the transaction's snapshot.
    const [[stageKartuRow]] = await conn.query(
      `SELECT kartu_konsultasi_outline_id AS kartu_id
       FROM konsultasi_outline_stage
       WHERE id = ? AND pembimbing_nidn = ?
       LIMIT 1`,
      [stageId, nidn],
    );
    if (!stageKartuRow) {
      return res.status(404).json({ ok: false, message: "Stage not found" });
    }

    await conn.beginTransaction();
    txStarted = true;

    await conn.query(
      `SELECT id FROM kartu_konsultasi_outline WHERE id = ? FOR UPDATE`,
      [stageKartuRow.kartu_id],
    );

    const [stageRows] = await conn.query(
      `SELECT s.*, k.id AS kartu_id
       FROM konsultasi_outline_stage s
       INNER JOIN kartu_konsultasi_outline k ON k.id = s.kartu_konsultasi_outline_id
       WHERE s.id = ? AND s.pembimbing_nidn = ?
       LIMIT 1
       FOR UPDATE`,
      [stageId, nidn],
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

    const shouldRequireSignature =
      (stage.stage === "PEMBIMBING_2" && decisionStatus === "CONTINUE") ||
      (stage.stage === "PEMBIMBING_1" && decisionStatus === "ACCEPTED");
    if (shouldRequireSignature) {
      const [[sigRow]] = await conn.query(
        `SELECT dsnTtd AS signature_image
         FROM widya_miko.m_dosen
         WHERE dsnId = ?
         LIMIT 1`,
        [stage.pembimbing_nidn],
      );
      if (!hasSignature(sigRow?.signature_image)) {
        await conn.rollback();
        txStarted = false;
        return res.status(400).json({
          ok: false,
          message:
            "No saved signature found. Please upload your signature first.",
        });
      }
    }

    const [subRows] = await conn.query(
      `SELECT id, submission_no
       FROM konsultasi_outline_submission
       WHERE konsultasi_outline_stage_id = ?
       ORDER BY submission_no DESC
       LIMIT 1
       FOR UPDATE`,
      [stageId],
    );
    const latestSubmission = subRows[0] ?? null;
    if (!latestSubmission) {
      await conn.rollback();
      txStarted = false;
      return res
        .status(409)
        .json({ ok: false, message: "No submission to review" });
    }

    const [existingReviewRows] = await conn.query(
      `SELECT id
       FROM konsultasi_outline_review
       WHERE konsultasi_outline_stage_id = ? AND submission_no = ?
       LIMIT 1`,
      [stageId, latestSubmission.submission_no],
    );
    if (existingReviewRows.length > 0) {
      await conn.rollback();
      txStarted = false;
      return res
        .status(409)
        .json({ ok: false, message: "Submission already reviewed" });
    }

    // A pending title proposal waiting on this stage must be decided in the
    // same review, so consultation can never finish with a title in limbo.
    const [[outlineRefRow]] = await conn.query(
      `SELECT outline_id FROM kartu_konsultasi_outline WHERE id = ? LIMIT 1`,
      [stage.kartu_id],
    );
    const stageOutlineId = outlineRefRow?.outline_id ?? null;
    const [pendingTitleRows] = await conn.query(
      `SELECT *
       FROM usulan_perubahan_judul
       WHERE outline_id = ? AND status = ?
       LIMIT 1
       FOR UPDATE`,
      [
        stageOutlineId,
        stage.stage === "PEMBIMBING_2"
          ? "WAITING_PEMBIMBING_2"
          : "WAITING_PEMBIMBING_1",
      ],
    );
    const pendingTitle = pendingTitleRows[0] ?? null;
    if (pendingTitle && !hasTitleDecision) {
      await conn.rollback();
      txStarted = false;
      return res.status(400).json({
        ok: false,
        message: "Keputusan usulan perubahan judul wajib diisi",
      });
    }
    if (!pendingTitle && hasTitleDecision) {
      await conn.rollback();
      txStarted = false;
      return res.status(409).json({
        ok: false,
        message: "Tidak ada usulan perubahan judul yang menunggu keputusan Anda",
      });
    }

    let titleStatusAfter = null;
    if (pendingTitle) {
      const prefix =
        stage.stage === "PEMBIMBING_2" ? "pembimbing2" : "pembimbing1";
      if (titleDecision === "REJECT") {
        titleStatusAfter = "REJECTED";
      } else if (stage.stage === "PEMBIMBING_2") {
        titleStatusAfter = "WAITING_PEMBIMBING_1";
      } else {
        titleStatusAfter = "APPROVED";
      }

      if (titleStatusAfter === "APPROVED") {
        const [[outlineRow]] = await conn.query(
          `SELECT judul FROM outline WHERE id = ? LIMIT 1 FOR UPDATE`,
          [stageOutlineId],
        );
        if (outlineRow?.judul !== pendingTitle.judul_lama) {
          await conn.rollback();
          txStarted = false;
          return res.status(409).json({
            ok: false,
            message:
              "Judul outline telah berubah sejak usulan dibuat; usulan ini tidak dapat disetujui",
          });
        }
        await conn.query(`UPDATE outline SET judul = ? WHERE id = ?`, [
          pendingTitle.judul_usulan,
          stageOutlineId,
        ]);
      }

      await conn.query(
        `UPDATE usulan_perubahan_judul
         SET status = ?,
             ${prefix}_user_id = ?,
             ${prefix}_keputusan_at = CURRENT_TIMESTAMP,
             ${prefix}_catatan = ?,
             alasan_penolakan = ?
         WHERE id = ?`,
        [
          titleStatusAfter,
          req.user.id,
          safeTitleCatatan,
          titleDecision === "REJECT" ? safeTitleAlasanPenolakan : null,
          pendingTitle.id,
        ],
      );
    }

    const [reviewIns] = await conn.query(
      `INSERT INTO konsultasi_outline_review (
         konsultasi_outline_stage_id,
         submission_no,
         reviewer_user_id,
         decision_status,
         catatan_kartu
       ) VALUES (?, ?, ?, ?, ?)`,
      [
        stageId,
        latestSubmission.submission_no,
        req.user.id,
        decisionStatus,
        String(catatanKartu).trim(),
      ],
    );

    if (hasReviewFile) {
      await conn.query(
        `INSERT INTO konsultasi_outline_review_file (
           konsultasi_outline_review_id,
           file_content,
           file_name,
           mime_type,
           uploaded_by_user_id
         ) VALUES (?, ?, ?, ?, ?)`,
        [
          reviewIns.insertId,
          String(reviewFile),
          safeReviewFileName,
          mimeFromFileName(safeReviewFileName),
          req.user.id,
        ],
      );
    }

    const stageStatusAfter = decisionStatus;
    const stageFinished =
      stageStatusAfter === "CONTINUE" || stageStatusAfter === "ACCEPTED";
    await conn.query(
      `UPDATE konsultasi_outline_stage
       SET
         current_status = ?,
         finished_at = CASE WHEN ? = 1 THEN CURRENT_TIMESTAMP ELSE finished_at END,
         updated_at = CURRENT_TIMESTAMP
       WHERE id = ?`,
      [stageStatusAfter, stageFinished ? 1 : 0, stageId],
    );

    if (stage.stage === "PEMBIMBING_2" && decisionStatus === "CONTINUE") {
      const [p1Rows] = await conn.query(
        `SELECT id
         FROM konsultasi_outline_stage
         WHERE kartu_konsultasi_outline_id = ? AND stage = 'PEMBIMBING_1'
         LIMIT 1
         FOR UPDATE`,
        [stage.kartu_id],
      );
      if (p1Rows.length === 0) {
        const [kRows] = await conn.query(
          `SELECT o.pembimbing1_nidn
           FROM kartu_konsultasi_outline k
           JOIN outline o ON o.id = k.outline_id
           WHERE k.id = ?
           LIMIT 1`,
          [stage.kartu_id],
        );
        const pembimbing1Nidn = kRows[0]?.pembimbing1_nidn ?? null;
        if (!pembimbing1Nidn) {
          await conn.rollback();
          txStarted = false;
          return res
            .status(409)
            .json({ ok: false, message: "Pembimbing 1 is not assigned" });
        }
        await conn.query(
          `INSERT INTO konsultasi_outline_stage (
             kartu_konsultasi_outline_id,
             stage,
             pembimbing_nidn,
             current_status,
             current_submission_no,
             started_at
           ) VALUES (?, 'PEMBIMBING_1', ?, 'WAITING_SUBMISSION', 0, CURRENT_TIMESTAMP)`,
          [stage.kartu_id, pembimbing1Nidn],
        );
      }
    }

    const [kartuInfoRows] = await conn.query(
      `SELECT k.id, k.outline_id, o.npm, o.program_studi_id, o.pembimbing1_nidn, o.pembimbing2_nidn
       FROM kartu_konsultasi_outline k
       JOIN outline o ON o.id = k.outline_id
       WHERE k.id = ? LIMIT 1`,
      [stage.kartu_id],
    );
    const kartuInfo = kartuInfoRows[0];

    let autoFinalizedFile = null;
    if (stage.stage === "PEMBIMBING_1" && decisionStatus === "ACCEPTED") {
      await conn.query(
        `UPDATE kartu_konsultasi_outline
         SET
           is_completed = 1,
           completed_at = CURRENT_TIMESTAMP,
           updated_at = CURRENT_TIMESTAMP
         WHERE id = ?`,
        [stage.kartu_id],
      );

      autoFinalizedFile = await generateAndStoreFinalKartuPdf(conn, {
        kartuId: stage.kartu_id,
        generatedByUserId: req.user.id,
      });
    }

    let autoSkResult = null;
    if (stage.stage === "PEMBIMBING_1" && decisionStatus === "ACCEPTED") {
      const outlineId = kartuInfo?.outline_id ?? null;
      if (outlineId && kartuInfo) {
        autoSkResult = await autoSubmitSkPenelitian(conn, {
          outlineId,
          kartuId: stage.kartu_id,
        });
      }
    }

    if (kartuInfo) {
      const [[studentUserRow]] = await conn.query(
        `SELECT u.id, m.nama FROM users u JOIN mahasiswa m ON m.npm = u.npm WHERE u.npm = ? LIMIT 1`,
        [kartuInfo.npm],
      );
      const studentUserId = studentUserRow?.id ?? null;
      const namaMahasiswaForNotif = studentUserRow?.nama ?? kartuInfo.npm;

      if (titleStatusAfter && studentUserId) {
        const titleMessages = {
          WAITING_PEMBIMBING_1:
            "Usulan perubahan judul Anda disetujui Pembimbing 2 dan akan diputuskan oleh Pembimbing 1",
          APPROVED:
            "Usulan perubahan judul Anda disetujui; judul outline telah diperbarui",
          REJECTED: `Usulan perubahan judul Anda ditolak oleh ${stage.stage === "PEMBIMBING_2" ? "Pembimbing 2" : "Pembimbing 1"}`,
        };
        await insertNotification(
          conn,
          studentUserId,
          `OUTLINE_TITLE_CHANGE_${titleStatusAfter === "WAITING_PEMBIMBING_1" ? "CONTINUE" : titleStatusAfter}`,
          titleMessages[titleStatusAfter],
          "/student/outline-consultations",
        );
      }

      if (decisionStatus === "NEED_REVISION" && studentUserId) {
        await insertNotification(
          conn,
          studentUserId,
          "OUTLINE_CONSULTATION_NEED_REVISION",
          "Pembimbing memberikan catatan revisi untuk outline Anda",
          "/student/outline-consultations",
        );
      } else if (decisionStatus === "CONTINUE") {
        if (studentUserId) {
          await insertNotification(
            conn,
            studentUserId,
            "OUTLINE_CONSULTATION_CONTINUE",
            "Outline Anda dilanjutkan ke Pembimbing 1",
            "/student/outline-consultations",
          );
        }
        const [p1UserRows] = await conn.query(
          `SELECT u.id FROM users u JOIN user_roles ur ON ur.user_id = u.id JOIN roles r ON r.id = ur.role_id
           WHERE u.nidn = ? AND r.code = 'PEMBIMBING' LIMIT 1`,
          [kartuInfo.pembimbing1_nidn],
        );
        if (p1UserRows[0]?.id) {
          await insertNotification(
            conn,
            p1UserRows[0].id,
            "OUTLINE_CONSULTATION_SUBMITTED",
            `Outline mahasiswa ${namaMahasiswaForNotif} siap untuk direview`,
            "/pembimbing/outline-consultations",
          );
        }
      } else if (decisionStatus === "ACCEPTED" && studentUserId) {
        await insertNotification(
          conn,
          studentUserId,
          "OUTLINE_CONSULTATION_ACCEPTED",
          "Outline Anda telah diterima oleh Pembimbing 1",
          "/student/outline-consultations",
        );
        const skName = autoSkResult
          ? await getSkPenulisanNameForOutline(conn, kartuInfo.outline_id)
          : null;
        if (autoSkResult && autoSkResult.skippedReason === null) {
          await insertNotification(
            conn,
            studentUserId,
            "SK_PENELITIAN_AUTO_SUBMITTED",
            `Pengajuan ${skName} Anda telah diajukan secara otomatis`,
            "/student/sk-penelitian",
          );
          const [sekRows] = await conn.query(
            `SELECT u.id FROM users u JOIN user_roles ur ON ur.user_id = u.id JOIN roles r ON r.id = ur.role_id WHERE r.code = 'SEKRETARIAT'`,
          );
          for (const sek of sekRows) {
            await insertNotification(
              conn,
              sek.id,
              "SK_SUBMITTED",
              `Mahasiswa ${namaMahasiswaForNotif} mengajukan ${skName}`,
              "/sekretariat/sk-penelitian",
            );
          }
        } else if (autoSkResult?.skippedReason === "period_closed") {
          await insertNotification(
            conn,
            studentUserId,
            "SK_PENELITIAN_WAITING_PERIOD",
            `${autoSkResult.message} Ajukan ${skName} Anda dari halaman SK saat periode dibuka.`,
            "/student/sk-penelitian",
          );
        } else if (autoSkResult?.skippedReason === "missing_files") {
          await insertNotification(
            conn,
            studentUserId,
            "SK_PENELITIAN_AUTO_SUBMIT_FAILED",
            `Pengajuan ${skName} belum dapat diajukan otomatis karena ada dokumen yang belum tersedia. Silakan ajukan dari halaman SK.`,
            "/student/sk-penelitian",
          );
        }
      }
    }

    await conn.commit();
    txStarted = false;

    return res.json({
      ok: true,
      message:
        stage.stage === "PEMBIMBING_1" && decisionStatus === "ACCEPTED"
          ? "Review saved and final kartu generated"
          : "Review saved",
      data: {
        stageId,
        submissionNo: latestSubmission.submission_no,
        decisionStatus,
        hasReviewFile,
        finalFile: autoFinalizedFile,
        skPenelitian: autoSkResult,
        titleChangeStatus: titleStatusAfter,
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
