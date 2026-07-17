const db = require("../db");
const { insertNotification } = require("../utils/notify");
const path = require("path");
const { readFile } = require("fs/promises");
const { patchDocument, PatchType, TextRun, ImageRun } = require("docx");

const CHAPTER_ORDER = ["BAB_1_2", "BAB_3", "BAB_4", "BAB_5"];
const CHAPTER_LABEL = {
  BAB_1_2: "Bab 1 & 2",
  BAB_3: "Bab 3",
  BAB_4: "Bab 4",
  BAB_5: "Bab 5",
};

function nextChapterGroup(current) {
  const idx = CHAPTER_ORDER.indexOf(current);
  return idx >= 0 && idx < CHAPTER_ORDER.length - 1
    ? CHAPTER_ORDER[idx + 1]
    : null;
}

function buildKartuFileName(npm, namaMahasiswa, suffix) {
  const safeNpm = String(npm ?? "").trim().replace(/[/\\:*?"<>|]+/g, "_");
  const safeNama = String(namaMahasiswa ?? "").trim().replace(/[/\\:*?"<>|]+/g, "_");
  return `${safeNpm} - ${safeNama} - ${suffix}.docx`;
}

async function getStudentNpm(userId) {
  const [rows] = await db.query(
    `SELECT npm FROM users WHERE id = ? AND is_active = 1 LIMIT 1`,
    [userId],
  );
  return rows[0]?.npm ?? null;
}

async function getLecturerNidn(userId) {
  const [rows] = await db.query(
    `SELECT nidn FROM users WHERE id = ? AND is_active = 1 LIMIT 1`,
    [userId],
  );
  return rows[0]?.nidn ?? null;
}

async function getKaprodiProgramStudiIdsByNidn(nidn) {
  const [rows] = await db.query(
    `SELECT id FROM program_studi WHERE kaprodi_nidn = ?`,
    [nidn],
  );
  return rows
    .map((r) => Number(r.id))
    .filter((id) => Number.isFinite(id) && id > 0);
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
  const dataUrlMatch = raw.match(
    /^data:image\/([a-zA-Z0-9.+-]+);base64,(.+)$/i,
  );
  if (dataUrlMatch) {
    try {
      const mimeType = dataUrlMatch[1].toLowerCase();
      const type = mimeType === "jpeg" ? "jpg" : mimeType;
      return { buffer: Buffer.from(dataUrlMatch[2], "base64"), type };
    } catch (_) {
      return null;
    }
  }
  const normalized = raw.replace(/\s+/g, "");
  const looksLikeBase64 =
    /^[A-Za-z0-9+/=]+$/.test(normalized) && normalized.length % 4 === 0;
  if (looksLikeBase64) {
    try {
      const buffer = Buffer.from(normalized, "base64");
      const type = buffer[0] === 0x89 && buffer[1] === 0x50 ? "png" : "jpg";
      return { buffer, type };
    } catch (_) {
      return null;
    }
  }
  return null;
}

function signatureImagePatch(signatureValue) {
  const decoded = decodeSignatureToBuffer(signatureValue);
  if (!decoded || decoded.buffer.length === 0) return textPatch("");
  try {
    return {
      type: PatchType.PARAGRAPH,
      children: [
        new ImageRun({
          type: decoded.type,
          data: decoded.buffer,
          transformation: { width: 120, height: 50 },
        }),
      ],
    };
  } catch (_) {
    return textPatch("");
  }
}

function hasSignature(signatureValue) {
  return Boolean(decodeSignatureToBuffer(signatureValue));
}

function assertSignatures(checks) {
  const missing = checks
    .filter((c) => !hasSignature(c.signatureImage))
    .map((c) => ({ role: c.role, nama: c.nama ?? "" }));
  if (missing.length > 0) {
    const detail = missing
      .map((m) => `${m.role}${m.nama ? ` (${m.nama})` : ""}`)
      .join(", ");
    const err = new Error(
      `Dokumen belum dapat dibuat karena tanda tangan berikut belum tersimpan: ${detail}. Mohon hubungi admin agar pihak terkait mengunggah tanda tangan terlebih dahulu.`,
    );
    err.statusCode = 400;
    err.missingSignatures = missing;
    throw err;
  }
}

function formatKartuDate(value) {
  if (!value) return "";
  return new Intl.DateTimeFormat("id-ID", {
    day: "2-digit",
    month: "long",
    year: "numeric",
    timeZone: "Asia/Jakarta",
  }).format(new Date(value));
}

function getChapterGroupLabel(chapterGroup) {
  const map = {
    BAB_1_2: "Bab 1 & 2",
    BAB_3: "Bab 3",
    BAB_4: "Bab 4",
    BAB_5: "Bab 5",
  };
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
    const p2 =
      stages.find(
        (s) => s.chapter_group === chapterGroup && s.stage === "PEMBIMBING_2",
      ) ?? null;
    const p1 =
      stages.find(
        (s) => s.chapter_group === chapterGroup && s.stage === "PEMBIMBING_1",
      ) ?? null;

    if (!p2) continue;
    if (p2.current_status !== "CONTINUE") {
      return {
        chapterGroup,
        activeStage: "PEMBIMBING_2",
        activeStatus: p2.current_status,
        stageRow: p2,
      };
    }
    if (!p1) {
      return {
        chapterGroup,
        activeStage: null,
        activeStatus: null,
        stageRow: null,
      };
    }
    if (p1.current_status !== "ACCEPTED") {
      return {
        chapterGroup,
        activeStage: "PEMBIMBING_1",
        activeStatus: p1.current_status,
        stageRow: p1,
      };
    }
  }
  return {
    chapterGroup: null,
    activeStage: null,
    activeStatus: null,
    stageRow: null,
  };
}

async function getKartuLogs(queryable, kartuId) {
  const [logs] = await queryable.query(
    `SELECT
       st.chapter_group,
       st.stage,
       rv.submission_no,
       u.nidn          AS reviewer_nidn,
       d.nama          AS reviewer_nama,
       u.signature_image AS reviewer_signature,
       rv.decision_status AS status,
       rv.catatan_kartu,
       rv.reviewed_at  AS logged_at
     FROM konsultasi_skripsi_review rv
     JOIN konsultasi_skripsi_stage st ON st.id = rv.konsultasi_skripsi_stage_id
     LEFT JOIN users u ON u.id = rv.reviewer_user_id
     LEFT JOIN dosen d ON d.nidn = u.nidn
     WHERE st.kartu_konsultasi_skripsi_id = ?
     ORDER BY rv.reviewed_at ASC, rv.id ASC
     LIMIT 53`,
    [kartuId],
  );
  return logs;
}

async function buildKartuKonsultasiSkripsiDocxBuffer(kartu, logs, extra = {}) {
  const templatePath = path.join(
    __dirname,
    "..",
    "templates",
    "template_kartu_penulisan_skripsi.docx",
  );
  const templateBuffer = await readFile(templatePath);

  assertSignatures(
    logs.map((log, idx) => ({
      role: `Paraf ${idx + 1} (${getChapterGroupLabel(log.chapter_group)} - ${getStageLabel(log.stage)})`,
      nama: log.reviewer_nama,
      signatureImage: log.reviewer_signature,
    })),
  );

  const patches = {
    fakultas: textPatch((extra.fakultasNama ?? "").toUpperCase()),
    nomor_sk: textPatch(extra.nomorSk ?? ""),
    nama_mahasiswa: textPatch(kartu.nama_mahasiswa),
    npm: textPatch(kartu.npm),
    prodi: textPatch(kartu.program_studi_nama),
    judul_skripsi: textPatch(kartu.judul_skripsi),
    pembimbing1_name: textPatch(kartu.pembimbing1_nama),
    pembimbing2_name: textPatch(kartu.pembimbing2_nama),
    pembimbing1_signature: signatureImagePatch(kartu.pembimbing1_signature),
    pembimbing2_signature: signatureImagePatch(kartu.pembimbing2_signature),
    kaprodi_signature: signatureImagePatch(extra.kaprodiSignature ?? null),
    tanggal_mulai: textPatch(extra.tanggalMulai ?? ""),
    tanggal_selesai: textPatch(
      kartu.completed_at ? formatKartuDate(kartu.completed_at) : "",
    ),
    kaprodi_name: textPatch(extra.kaprodiNama ?? ""),
  };

  for (let i = 1; i <= 53; i += 1) {
    const log = logs[i - 1];
    const keterangan = log
      ? `${getChapterGroupLabel(log.chapter_group)} - ${getStageLabel(log.stage)} - ${getDecisionLabel(log.status)}: ${log.catatan_kartu ?? ""}`
      : "";
    patches[`tanggal_${i}`] = textPatch(
      log ? formatKartuDate(log.logged_at) : "",
    );
    patches[`keterangan_${i}`] = textPatch(keterangan);
    patches[`paraf_${i}`] = signatureImagePatch(log?.reviewer_signature);
  }

  return patchDocument({
    outputType: "nodebuffer",
    data: templateBuffer,
    patches,
  });
}

async function fetchKartuExtra(queryable, kartuId, skripsiId) {
  const [[skRow]] = await queryable.query(
    `SELECT psk.nomor_surat, psk.verified_at
     FROM pengajuan_sk_penelitian psk
     JOIN skripsi s ON s.outline_id = psk.outline_id
     WHERE s.id = ? ORDER BY psk.created_at DESC LIMIT 1`,
    [skripsiId],
  );

  const [[psRow]] = await queryable.query(
    `SELECT f.nama AS fakultas_nama, ps.kaprodi_nidn
     FROM kartu_konsultasi_skripsi k
     JOIN skripsi sk ON sk.id = k.skripsi_id
     JOIN program_studi ps ON ps.id = sk.program_studi_id
     LEFT JOIN fakultas f ON f.id = ps.fakultas_id
     WHERE k.id = ? LIMIT 1`,
    [kartuId],
  );

  let kaprodiNama = "";
  let kaprodiSignature = null;
  if (psRow?.kaprodi_nidn) {
    const [[kaprodiRow]] = await queryable.query(
      `SELECT d.nama, u.signature_image
       FROM dosen d
       LEFT JOIN users u ON u.nidn = d.nidn
       LEFT JOIN user_roles ur ON ur.user_id = u.id
       LEFT JOIN roles r ON r.id = ur.role_id AND r.code = 'KAPRODI'
       WHERE d.nidn = ? AND r.id IS NOT NULL
       LIMIT 1`,
      [psRow.kaprodi_nidn],
    );
    kaprodiNama = kaprodiRow?.nama ?? "";
    kaprodiSignature = kaprodiRow?.signature_image ?? null;
  }

  return {
    fakultasNama: psRow?.fakultas_nama ?? "",
    nomorSk: skRow?.nomor_surat ?? "",
    tanggalMulai: skRow?.verified_at ? formatKartuDate(skRow.verified_at) : "",
    kaprodiNama,
    kaprodiSignature,
  };
}

async function fetchKartuDenorm(queryable, kartu) {
  const [[row]] = await queryable.query(
    `SELECT m.npm AS npm, m.nama AS nama_mahasiswa, ps.nama AS program_studi_nama,
            sk.judul AS judul_skripsi,
            d1.nama AS pembimbing1_nama, d2.nama AS pembimbing2_nama,
            u1.signature_image AS pembimbing1_signature,
            u2.signature_image AS pembimbing2_signature
     FROM kartu_konsultasi_skripsi k
     JOIN skripsi sk ON sk.id = k.skripsi_id
     JOIN mahasiswa m ON m.npm = sk.npm
     JOIN program_studi ps ON ps.id = sk.program_studi_id
     LEFT JOIN dosen d1 ON d1.nidn = sk.pembimbing1_nidn
     LEFT JOIN dosen d2 ON d2.nidn = sk.pembimbing2_nidn
     LEFT JOIN users u1 ON u1.nidn = sk.pembimbing1_nidn AND u1.is_active = 1
     LEFT JOIN users u2 ON u2.nidn = sk.pembimbing2_nidn AND u2.is_active = 1
     WHERE k.id = ? LIMIT 1`,
    [kartu.id],
  );
  return { ...kartu, ...row };
}

async function generateAndStoreFinalKartuDocx(
  queryable,
  { kartuId, skripsiId, generatedByUserId },
) {
  const [kartuRows] = await queryable.query(
    `SELECT * FROM kartu_konsultasi_skripsi WHERE id = ? LIMIT 1`,
    [kartuId],
  );
  const kartu = kartuRows[0] ?? null;
  if (!kartu) {
    const err = new Error("Kartu not found");
    err.statusCode = 404;
    throw err;
  }

  const logs = await getKartuLogs(queryable, kartuId);
  const extra = await fetchKartuExtra(queryable, kartuId, skripsiId);
  const kartuFull = await fetchKartuDenorm(queryable, kartu);

  assertSignatures([
    { role: "Pembimbing 1", nama: kartuFull.pembimbing1_nama, signatureImage: kartuFull.pembimbing1_signature },
    { role: "Pembimbing 2", nama: kartuFull.pembimbing2_nama, signatureImage: kartuFull.pembimbing2_signature },
    { role: "Kaprodi", nama: extra.kaprodiNama, signatureImage: extra.kaprodiSignature },
  ]);

  const outputBuffer = await buildKartuKonsultasiSkripsiDocxBuffer(
    kartuFull,
    logs,
    extra,
  );
  const fileName = buildKartuFileName(
    kartuFull.npm,
    kartuFull.nama_mahasiswa,
    "Kartu Penulisan Skripsi",
  );

  await queryable.query(
    `UPDATE kartu_konsultasi_skripsi
     SET file_content = ?, file_name = ?,
         mime_type = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
         generated_by_user_id = ?, generated_at = NOW()
     WHERE id = ?`,
    [outputBuffer.toString("base64"), fileName, generatedByUserId, kartuId],
  );

  return { kartuId, fileName };
}

exports.initKartu = async (req, res, next) => {
  const conn = await db.getConnection();
  let txStarted = false;
  try {
    if (req.user.userType !== "STUDENT") {
      return res.status(403).json({ ok: false, message: "Only students" });
    }

    const skripsiId = Number(req.params.skripsiId);
    if (!Number.isFinite(skripsiId) || skripsiId <= 0) {
      return res.status(400).json({ ok: false, message: "Invalid skripsiId" });
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
      `SELECT psk.id FROM pengajuan_sk_penelitian psk
       JOIN skripsi s ON s.outline_id = psk.outline_id
       WHERE s.id = ? AND s.npm = ? AND psk.status = 'COMPLETED'
       LIMIT 1`,
      [skripsiId, npm],
    );
    if (skRows.length === 0) {
      await conn.rollback();
      txStarted = false;
      return res.status(409).json({
        ok: false,
        message:
          "SK Penelitian must be COMPLETED before starting Konsultasi Skripsi",
      });
    }

    const [existingKartu] = await conn.query(
      `SELECT id FROM kartu_konsultasi_skripsi WHERE skripsi_id = ? LIMIT 1`,
      [skripsiId],
    );
    if (existingKartu.length > 0) {
      await conn.rollback();
      txStarted = false;
      return res.status(409).json({
        ok: false,
        message: "Kartu konsultasi skripsi already exists",
      });
    }

    const [[skripsiRow]] = await conn.query(
      `SELECT s.npm, s.judul, s.program_studi_id,
              m.nama AS nama_mahasiswa, ps.nama AS program_studi_nama,
              s.pembimbing1_nidn, d1.nama AS pembimbing1_nama,
              s.pembimbing2_nidn, d2.nama AS pembimbing2_nama
       FROM skripsi s
       JOIN mahasiswa m ON m.npm = s.npm
       JOIN program_studi ps ON ps.id = s.program_studi_id
       LEFT JOIN dosen d1 ON d1.nidn = s.pembimbing1_nidn
       LEFT JOIN dosen d2 ON d2.nidn = s.pembimbing2_nidn
       WHERE s.id = ? AND s.npm = ? LIMIT 1`,
      [skripsiId, npm],
    );
    if (!skripsiRow) {
      await conn.rollback();
      txStarted = false;
      return res.status(404).json({ ok: false, message: "Skripsi not found" });
    }
    if (!skripsiRow.pembimbing1_nidn || !skripsiRow.pembimbing2_nidn) {
      await conn.rollback();
      txStarted = false;
      return res
        .status(409)
        .json({ ok: false, message: "Both pembimbing must be assigned" });
    }

    let kartuId;
    try {
      const [kartuIns] = await conn.query(
        `INSERT INTO kartu_konsultasi_skripsi (skripsi_id) VALUES (?)`,
        [skripsiId],
      );
      kartuId = kartuIns.insertId;
    } catch (insErr) {
      if (insErr.code === "ER_DUP_ENTRY") {
        await conn.rollback();
        txStarted = false;
        return res.status(409).json({
          ok: false,
          message: "Kartu konsultasi skripsi already exists",
        });
      }
      throw insErr;
    }

    await conn.query(
      `INSERT INTO konsultasi_skripsi_stage (
         kartu_konsultasi_skripsi_id, chapter_group, stage,
         pembimbing_nidn, current_status, current_submission_no, started_at
       ) VALUES (?, 'BAB_1_2', 'PEMBIMBING_2', ?, 'WAITING_SUBMISSION', 0, CURRENT_TIMESTAMP)`,
      [kartuId, skripsiRow.pembimbing2_nidn],
    );

    await conn.commit();
    txStarted = false;

    return res.status(201).json({
      ok: true,
      message: "Kartu konsultasi skripsi initialized",
      data: { kartuId, skripsiId },
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

exports.getMyDetail = async (req, res, next) => {
  try {
    if (req.user.userType !== "STUDENT") {
      return res.status(403).json({ ok: false, message: "Only students" });
    }

    const skripsiId = Number(req.params.skripsiId);
    if (!Number.isFinite(skripsiId) || skripsiId <= 0) {
      return res.status(400).json({ ok: false, message: "Invalid skripsiId" });
    }

    const npm = await getStudentNpm(req.user.id);
    if (!npm) {
      return res
        .status(400)
        .json({ ok: false, message: "Mahasiswa tidak valid" });
    }

    const [kartuRows] = await db.query(
      `SELECT k.*, sk.npm, sk.judul AS judul_skripsi, sk.program_studi_id,
              sk.pembimbing1_nidn, sk.pembimbing2_nidn,
              m.nama AS nama_mahasiswa, ps.nama AS program_studi_nama,
              d1.nama AS pembimbing1_nama, d2.nama AS pembimbing2_nama
       FROM kartu_konsultasi_skripsi k
       JOIN skripsi sk ON sk.id = k.skripsi_id
       JOIN mahasiswa m ON m.npm = sk.npm
       JOIN program_studi ps ON ps.id = sk.program_studi_id
       LEFT JOIN dosen d1 ON d1.nidn = sk.pembimbing1_nidn
       LEFT JOIN dosen d2 ON d2.nidn = sk.pembimbing2_nidn
       WHERE k.skripsi_id = ? AND sk.npm = ? LIMIT 1`,
      [skripsiId, npm],
    );
    const kartu = kartuRows[0] ?? null;
    if (!kartu) {
      return res
        .status(404)
        .json({ ok: false, message: "Consultation not found" });
    }

    const [stages] = await db.query(
      `SELECT * FROM konsultasi_skripsi_stage
       WHERE kartu_konsultasi_skripsi_id = ?
       ORDER BY FIELD(chapter_group, 'BAB_1_2','BAB_3','BAB_4','BAB_5') ASC,
                CASE stage WHEN 'PEMBIMBING_2' THEN 1 WHEN 'PEMBIMBING_1' THEN 2 ELSE 3 END ASC`,
      [kartu.id],
    );

    const [submissions] = await db.query(
      `SELECT
         s.id, s.konsultasi_skripsi_stage_id, st.chapter_group, st.stage,
         s.submission_no, s.file_name, s.submitted_at
       FROM konsultasi_skripsi_submission s
       INNER JOIN konsultasi_skripsi_stage st ON st.id = s.konsultasi_skripsi_stage_id
       WHERE st.kartu_konsultasi_skripsi_id = ?
       ORDER BY s.submitted_at DESC`,
      [kartu.id],
    );

    const [reviews] = await db.query(
      `SELECT
         r.id, r.konsultasi_skripsi_stage_id, st.chapter_group, st.stage,
         r.submission_no, r.decision_status, r.catatan_kartu, r.reviewed_at,
         CASE WHEN rf.id IS NULL THEN 0 ELSE 1 END AS has_review_file,
         rf.id AS review_file_id, rf.file_name AS review_file_name
       FROM konsultasi_skripsi_review r
       INNER JOIN konsultasi_skripsi_stage st ON st.id = r.konsultasi_skripsi_stage_id
       LEFT JOIN konsultasi_skripsi_review_file rf ON rf.konsultasi_skripsi_review_id = r.id
       WHERE st.kartu_konsultasi_skripsi_id = ?
       ORDER BY r.reviewed_at DESC`,
      [kartu.id],
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

    const skripsiId = Number(req.params.skripsiId);
    if (!Number.isFinite(skripsiId) || skripsiId <= 0) {
      return res.status(400).json({ ok: false, message: "Invalid skripsiId" });
    }

    const { fileContent, fileName } = req.body || {};
    const safeFileName = String(fileName ?? "").trim();
    if (!fileContent) {
      return res
        .status(400)
        .json({ ok: false, message: "fileContent is required" });
    }
    if (!safeFileName) {
      return res
        .status(400)
        .json({ ok: false, message: "fileName is required" });
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
      `SELECT k.* FROM kartu_konsultasi_skripsi k
       JOIN skripsi sk ON sk.id = k.skripsi_id
       WHERE k.skripsi_id = ? AND sk.npm = ?
       LIMIT 1 FOR UPDATE`,
      [skripsiId, npm],
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
      `SELECT * FROM konsultasi_skripsi_stage
       WHERE kartu_konsultasi_skripsi_id = ?
       ORDER BY FIELD(chapter_group, 'BAB_1_2','BAB_3','BAB_4','BAB_5') ASC,
                CASE stage WHEN 'PEMBIMBING_2' THEN 1 WHEN 'PEMBIMBING_1' THEN 2 ELSE 3 END ASC
       FOR UPDATE`,
      [kartu.id],
    );

    const resolved = resolveActiveStage(stageRows);
    if (!resolved.stageRow) {
      await conn.rollback();
      txStarted = false;
      return res
        .status(409)
        .json({ ok: false, message: "No active stage to submit to" });
    }

    const activeStage = resolved.stageRow;
    if (
      activeStage.current_status === "ACCEPTED" ||
      activeStage.current_status === "CONTINUE"
    ) {
      await conn.rollback();
      txStarted = false;
      return res
        .status(409)
        .json({ ok: false, message: "Active stage is already completed" });
    }

    const nextSubmissionNo = Number(activeStage.current_submission_no || 0) + 1;

    await conn.query(
      `INSERT INTO konsultasi_skripsi_submission (
         konsultasi_skripsi_stage_id, submission_no, file_content, file_name, submitted_by_user_id
       ) VALUES (?, ?, ?, ?, ?)`,
      [
        activeStage.id,
        nextSubmissionNo,
        String(fileContent),
        safeFileName,
        req.user.id,
      ],
    );

    await conn.query(
      `UPDATE konsultasi_skripsi_stage
       SET current_submission_no = ?, current_status = 'SUBMITTED', updated_at = CURRENT_TIMESTAMP
       WHERE id = ?`,
      [nextSubmissionNo, activeStage.id],
    );

    const [pUserRows] = await conn.query(
      `SELECT u.id FROM users u JOIN user_roles ur ON ur.user_id = u.id JOIN roles r ON r.id = ur.role_id
       WHERE u.nidn = ? AND r.code = 'PEMBIMBING' LIMIT 1`,
      [activeStage.pembimbing_nidn],
    );
    if (pUserRows[0]?.id) {
      const [mRows] = await conn.query(
        `SELECT nama FROM mahasiswa WHERE npm = ? LIMIT 1`,
        [npm],
      );
      const namaMahasiswa = mRows[0]?.nama ?? npm;
      const chapterLabel =
        CHAPTER_LABEL[activeStage.chapter_group] ?? activeStage.chapter_group;
      await insertNotification(
        conn,
        pUserRows[0].id,
        "SKRIPSI_CONSULTATION_SUBMITTED",
        `Mahasiswa ${namaMahasiswa} mengumpulkan ${chapterLabel} untuk dikonsultasikan`,
        "/pembimbing/skripsi-consultations",
      );
    }

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
    try {
      if (txStarted) await conn.rollback();
    } catch (_) {}
    next(err);
  } finally {
    conn.release();
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
         s.id, s.konsultasi_skripsi_stage_id, s.submission_no,
         s.file_content, s.file_name, s.submitted_at,
         st.chapter_group, st.stage,
         sk.npm, sk.pembimbing1_nidn, sk.pembimbing2_nidn, sk.program_studi_id
       FROM konsultasi_skripsi_submission s
       INNER JOIN konsultasi_skripsi_stage st ON st.id = s.konsultasi_skripsi_stage_id
       INNER JOIN kartu_konsultasi_skripsi k ON k.id = st.kartu_konsultasi_skripsi_id
       JOIN skripsi sk ON sk.id = k.skripsi_id
       WHERE s.id = ?
       LIMIT 1`,
      [submissionId],
    );
    const submission = rows[0] ?? null;
    if (!submission) {
      return res
        .status(404)
        .json({ ok: false, message: "Submission not found" });
    }

    let isAuthorized = false;
    if (req.user.userType === "STUDENT") {
      const npm = await getStudentNpm(req.user.id);
      isAuthorized = Boolean(npm) && npm === submission.npm;
    } else if (req.user.userType === "LECTURER") {
      const nidn = await getLecturerNidn(req.user.id);
      isAuthorized =
        Boolean(nidn) &&
        (nidn === submission.pembimbing1_nidn ||
          nidn === submission.pembimbing2_nidn);
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
         rf.id, rf.file_content, rf.file_name, rf.mime_type, rf.created_at,
         sk.npm, sk.pembimbing1_nidn, sk.pembimbing2_nidn
       FROM konsultasi_skripsi_review_file rf
       INNER JOIN konsultasi_skripsi_review r ON r.id = rf.konsultasi_skripsi_review_id
       INNER JOIN konsultasi_skripsi_stage st ON st.id = r.konsultasi_skripsi_stage_id
       INNER JOIN kartu_konsultasi_skripsi k ON k.id = st.kartu_konsultasi_skripsi_id
       JOIN skripsi sk ON sk.id = k.skripsi_id
       WHERE rf.konsultasi_skripsi_review_id = ?
       LIMIT 1`,
      [reviewId],
    );
    const file = rows[0] ?? null;
    if (!file) {
      return res
        .status(404)
        .json({ ok: false, message: "Review file not found" });
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
      decisionStatus,
      catatanKartu,
      reviewFile,
      reviewFileName,
      reviewFileMimeType,
    } = req.body || {};

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

    const nidn = await getLecturerNidn(req.user.id);
    if (!nidn) {
      return res.status(400).json({ ok: false, message: "Dosen tidak valid" });
    }

    await conn.beginTransaction();
    txStarted = true;

    const [stageRows] = await conn.query(
      `SELECT s.*, k.id AS kartu_id, sk.pembimbing1_nidn, sk.pembimbing2_nidn
       FROM konsultasi_skripsi_stage s
       INNER JOIN kartu_konsultasi_skripsi k ON k.id = s.kartu_konsultasi_skripsi_id
       JOIN skripsi sk ON sk.id = k.skripsi_id
       WHERE s.id = ? AND s.pembimbing_nidn = ?
       LIMIT 1 FOR UPDATE`,
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
    let signatureImageValue = null;
    if (shouldRequireSignature) {
      const [[sigRow]] = await conn.query(
        `SELECT signature_image FROM users WHERE id = ? LIMIT 1`,
        [req.user.id],
      );
      if (!sigRow?.signature_image) {
        await conn.rollback();
        txStarted = false;
        return res.status(400).json({
          ok: false,
          message:
            "No saved signature found. Please upload your signature first.",
        });
      }
      signatureImageValue = sigRow.signature_image;
    }

    const [subRows] = await conn.query(
      `SELECT id, submission_no
       FROM konsultasi_skripsi_submission
       WHERE konsultasi_skripsi_stage_id = ?
       ORDER BY submission_no DESC LIMIT 1 FOR UPDATE`,
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

    const [existingReview] = await conn.query(
      `SELECT id FROM konsultasi_skripsi_review
       WHERE konsultasi_skripsi_stage_id = ? AND submission_no = ? LIMIT 1`,
      [stageId, latestSubmission.submission_no],
    );
    if (existingReview.length > 0) {
      await conn.rollback();
      txStarted = false;
      return res
        .status(409)
        .json({ ok: false, message: "Submission already reviewed" });
    }

    const [reviewIns] = await conn.query(
      `INSERT INTO konsultasi_skripsi_review (
         konsultasi_skripsi_stage_id, submission_no, reviewer_user_id,
         decision_status, catatan_kartu
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
        `INSERT INTO konsultasi_skripsi_review_file (
           konsultasi_skripsi_review_id, file_content, file_name, mime_type, uploaded_by_user_id
         ) VALUES (?, ?, ?, ?, ?)`,
        [
          reviewIns.insertId,
          String(reviewFile),
          safeReviewFileName,
          reviewFileMimeType ?? null,
          req.user.id,
        ],
      );
    }

    const stageFinished =
      decisionStatus === "CONTINUE" || decisionStatus === "ACCEPTED";
    await conn.query(
      `UPDATE konsultasi_skripsi_stage
       SET current_status = ?,
           finished_at = CASE WHEN ? = 1 THEN CURRENT_TIMESTAMP ELSE finished_at END,
           updated_at = CURRENT_TIMESTAMP
       WHERE id = ?`,
      [decisionStatus, stageFinished ? 1 : 0, stageId],
    );

    let autoFinalizedFile = null;

    if (stage.stage === "PEMBIMBING_2" && decisionStatus === "CONTINUE") {
      const [p1Rows] = await conn.query(
        `SELECT id FROM konsultasi_skripsi_stage
         WHERE kartu_konsultasi_skripsi_id = ? AND chapter_group = ? AND stage = 'PEMBIMBING_1'
         LIMIT 1 FOR UPDATE`,
        [stage.kartu_id, stage.chapter_group],
      );
      if (p1Rows.length === 0) {
        const [kRows] = await conn.query(
          `SELECT sk.pembimbing1_nidn FROM kartu_konsultasi_skripsi k
           JOIN skripsi sk ON sk.id = k.skripsi_id WHERE k.id = ? LIMIT 1`,
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
          `INSERT INTO konsultasi_skripsi_stage (
             kartu_konsultasi_skripsi_id, chapter_group, stage,
             pembimbing_nidn, current_status, current_submission_no, started_at
           ) VALUES (?, ?, 'PEMBIMBING_1', ?, 'WAITING_SUBMISSION', 0, CURRENT_TIMESTAMP)`,
          [stage.kartu_id, stage.chapter_group, pembimbing1Nidn],
        );
      }
    }

    if (stage.stage === "PEMBIMBING_1" && decisionStatus === "ACCEPTED") {
      const nextChapter = nextChapterGroup(stage.chapter_group);
      if (nextChapter) {
        const [nextP2Rows] = await conn.query(
          `SELECT id FROM konsultasi_skripsi_stage
           WHERE kartu_konsultasi_skripsi_id = ? AND chapter_group = ? AND stage = 'PEMBIMBING_2'
           LIMIT 1 FOR UPDATE`,
          [stage.kartu_id, nextChapter],
        );
        if (nextP2Rows.length === 0) {
          const [kRows] = await conn.query(
            `SELECT sk.pembimbing2_nidn FROM kartu_konsultasi_skripsi k
             JOIN skripsi sk ON sk.id = k.skripsi_id WHERE k.id = ? LIMIT 1`,
            [stage.kartu_id],
          );
          const pembimbing2Nidn = kRows[0]?.pembimbing2_nidn ?? null;
          if (!pembimbing2Nidn) {
            await conn.rollback();
            txStarted = false;
            return res
              .status(409)
              .json({ ok: false, message: "Pembimbing 2 is not assigned" });
          }
          await conn.query(
            `INSERT INTO konsultasi_skripsi_stage (
               kartu_konsultasi_skripsi_id, chapter_group, stage,
               pembimbing_nidn, current_status, current_submission_no, started_at
             ) VALUES (?, ?, 'PEMBIMBING_2', ?, 'WAITING_SUBMISSION', 0, CURRENT_TIMESTAMP)`,
            [stage.kartu_id, nextChapter, pembimbing2Nidn],
          );
        }
      } else {
        await conn.query(
          `UPDATE kartu_konsultasi_skripsi
           SET is_completed = 1, completed_at = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP
           WHERE id = ?`,
          [stage.kartu_id],
        );

        const [[kartuSkripsiRow]] = await conn.query(
          `SELECT skripsi_id FROM kartu_konsultasi_skripsi WHERE id = ? LIMIT 1`,
          [stage.kartu_id],
        );
        autoFinalizedFile = await generateAndStoreFinalKartuDocx(conn, {
          kartuId: stage.kartu_id,
          skripsiId: kartuSkripsiRow?.skripsi_id,
          generatedByUserId: req.user.id,
        });

        // Auto-init pengajuan_sidang DRAFT first, then pengajuan_sidang_kaprodi linked to it
        const kartuSkripsiId = kartuSkripsiRow?.skripsi_id;
        let [[existingSidang]] = await conn.query(
          `SELECT id FROM pengajuan_sidang
           WHERE skripsi_id = ? AND status NOT IN ('COMPLETED','REJECTED')
           ORDER BY id DESC LIMIT 1`,
          [kartuSkripsiId],
        );
        let autoSidangId = existingSidang?.id ?? null;
        if (!autoSidangId) {
          const [sidangIns] = await conn.query(
            `INSERT INTO pengajuan_sidang (skripsi_id, status, ujian_ke) VALUES (?, 'DRAFT', 1)`,
            [kartuSkripsiId],
          );
          autoSidangId = sidangIns.insertId;
        }

        const [[existingKaprodi]] = await conn.query(
          `SELECT id FROM pengajuan_sidang_kaprodi WHERE pengajuan_sidang_id = ? LIMIT 1`,
          [autoSidangId],
        );
        if (!existingKaprodi) {
          await conn.query(
            `INSERT INTO pengajuan_sidang_kaprodi (pengajuan_sidang_id, status) VALUES (?, 'DRAFT')`,
            [autoSidangId],
          );
        }
      }
    }

    const [kartuInfoRows] = await conn.query(
      `SELECT sk.id AS skripsi_id, sk.npm, sk.pembimbing1_nidn, m.nama AS nama_mahasiswa
       FROM kartu_konsultasi_skripsi k
       JOIN skripsi sk ON sk.id = k.skripsi_id
       JOIN mahasiswa m ON m.npm = sk.npm
       WHERE k.id = ? LIMIT 1`,
      [stage.kartu_id],
    );
    const kartuInfo = kartuInfoRows[0];
    if (kartuInfo) {
      const chapterLabel =
        CHAPTER_LABEL[stage.chapter_group] ?? stage.chapter_group;
      const [studentUserRows] = await conn.query(
        `SELECT id FROM users WHERE npm = ? LIMIT 1`,
        [kartuInfo.npm],
      );
      const studentUserId = studentUserRows[0]?.id ?? null;

      if (decisionStatus === "NEED_REVISION" && studentUserId) {
        await insertNotification(
          conn,
          studentUserId,
          "SKRIPSI_CONSULTATION_NEED_REVISION",
          `Pembimbing memberikan catatan revisi untuk ${chapterLabel}`,
          "/student/skripsi-consultations",
        );
      } else if (decisionStatus === "CONTINUE") {
        if (studentUserId) {
          await insertNotification(
            conn,
            studentUserId,
            "SKRIPSI_CONSULTATION_CONTINUE",
            `${chapterLabel} Anda dilanjutkan ke Pembimbing 1`,
            "/student/skripsi-consultations",
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
            "SKRIPSI_CONSULTATION_SUBMITTED",
            `${chapterLabel} mahasiswa ${kartuInfo.nama_mahasiswa} siap untuk direview`,
            "/pembimbing/skripsi-consultations",
          );
        }
      } else if (decisionStatus === "ACCEPTED" && studentUserId) {
        const isFinal =
          stage.stage === "PEMBIMBING_1" &&
          !nextChapterGroup(stage.chapter_group);
        if (isFinal) {
          await insertNotification(
            conn,
            studentUserId,
            "SKRIPSI_CONSULTATION_COMPLETED",
            "Konsultasi skripsi Anda telah selesai",
            "/student/skripsi-consultations",
          );
          await conn.query(
            `UPDATE skripsi
             SET status = 'COMPLETED', completed_at = CURRENT_TIMESTAMP
             WHERE id = ?`,
            [kartuInfo.skripsi_id],
          );
        } else {
          await insertNotification(
            conn,
            studentUserId,
            "SKRIPSI_CONSULTATION_CHAPTER_ACCEPTED",
            `${chapterLabel} Anda telah diterima, lanjutkan ke bab berikutnya`,
            "/student/skripsi-consultations",
          );
        }
      }
    }

    await conn.commit();
    txStarted = false;

    return res.json({
      ok: true,
      message:
        stage.stage === "PEMBIMBING_1" &&
        decisionStatus === "ACCEPTED" &&
        !nextChapterGroup(stage.chapter_group)
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
    try {
      if (txStarted) await conn.rollback();
    } catch (_) {}
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
         s.id AS stage_id, s.kartu_konsultasi_skripsi_id, k.skripsi_id,
         s.chapter_group, s.stage AS stage_name, s.pembimbing_nidn,
         d.nama AS stage_dosen_name, s.current_status, s.current_submission_no,
         s.started_at, s.finished_at,
         k.id AS kartu_id, sk.npm, sk.program_studi_id, sk.pembimbing1_nidn,
         sk.pembimbing2_nidn, k.is_completed,
         m.nama AS nama_mahasiswa, ps.nama AS program_studi_nama,
         sk.judul AS judul_skripsi,
         d1.nama AS pembimbing1_nama, d2.nama AS pembimbing2_nama
       FROM konsultasi_skripsi_stage s
       INNER JOIN kartu_konsultasi_skripsi k ON k.id = s.kartu_konsultasi_skripsi_id
       JOIN skripsi sk ON sk.id = k.skripsi_id
       JOIN mahasiswa m ON m.npm = sk.npm
       JOIN program_studi ps ON ps.id = sk.program_studi_id
       LEFT JOIN dosen d ON d.nidn = s.pembimbing_nidn
       LEFT JOIN dosen d1 ON d1.nidn = sk.pembimbing1_nidn
       LEFT JOIN dosen d2 ON d2.nidn = sk.pembimbing2_nidn
       WHERE s.id = ? AND (sk.pembimbing1_nidn = ? OR sk.pembimbing2_nidn = ?)
       LIMIT 1`,
      [stageId, nidn, nidn],
    );
    const row = stageRows[0] ?? null;
    if (!row) {
      return res.status(404).json({ ok: false, message: "Stage not found" });
    }

    const [submissions] = await db.query(
      `SELECT sub.id, sub.konsultasi_skripsi_stage_id, st.chapter_group, st.stage AS stage_name,
              sub.submission_no, sub.file_name, sub.submitted_by_user_id, sub.submitted_at
       FROM konsultasi_skripsi_submission sub
       INNER JOIN konsultasi_skripsi_stage st ON st.id = sub.konsultasi_skripsi_stage_id
       WHERE st.kartu_konsultasi_skripsi_id = ?
       ORDER BY sub.submitted_at DESC`,
      [row.kartu_id],
    );

    const [reviews] = await db.query(
      `SELECT
         r.id, r.submission_no, r.decision_status, r.catatan_kartu, r.reviewed_at,
         st.chapter_group, st.stage,
         CASE WHEN rf.id IS NULL THEN 0 ELSE 1 END AS has_review_file,
         rf.id AS review_file_id, rf.file_name AS review_file_name
       FROM konsultasi_skripsi_review r
       INNER JOIN konsultasi_skripsi_stage st ON st.id = r.konsultasi_skripsi_stage_id
       LEFT JOIN konsultasi_skripsi_review_file rf ON rf.konsultasi_skripsi_review_id = r.id
       WHERE st.kartu_konsultasi_skripsi_id = ?
       ORDER BY r.reviewed_at DESC`,
      [row.kartu_id],
    );

    const [logs] = await db.query(
      `SELECT
         rv.id,
         st.chapter_group,
         st.stage,
         rv.submission_no,
         rv.decision_status AS status,
         rv.catatan_kartu,
         rv.reviewed_at     AS logged_at,
         CASE WHEN rf.id IS NULL THEN 0 ELSE 1 END AS has_review_file,
         rf.id AS review_file_id, rf.file_name AS review_file_name
       FROM konsultasi_skripsi_review rv
       JOIN konsultasi_skripsi_stage st ON st.id = rv.konsultasi_skripsi_stage_id
       LEFT JOIN konsultasi_skripsi_review_file rf ON rf.konsultasi_skripsi_review_id = rv.id
       WHERE st.kartu_konsultasi_skripsi_id = ?
       ORDER BY rv.reviewed_at DESC`,
      [row.kartu_id],
    );

    return res.json({
      ok: true,
      data: {
        stage: {
          id: row.stage_id,
          kartuKonsultasiSkripsiId: row.kartu_konsultasi_skripsi_id,
          skripsiId: row.skripsi_id,
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
         k.id AS kartu_id, k.skripsi_id, sk.npm,
         sk.pembimbing1_nidn, sk.pembimbing2_nidn,
         k.is_completed, k.completed_at, k.created_at, k.updated_at,
         m.nama AS nama_mahasiswa, ps.nama AS program_studi_nama,
         sk.judul AS judul_skripsi,
         d1.nama AS pembimbing1_nama, d2.nama AS pembimbing2_nama
       FROM kartu_konsultasi_skripsi k
       JOIN skripsi sk ON sk.id = k.skripsi_id
       JOIN mahasiswa m ON m.npm = sk.npm
       JOIN program_studi ps ON ps.id = sk.program_studi_id
       LEFT JOIN dosen d1 ON d1.nidn = sk.pembimbing1_nidn
       LEFT JOIN dosen d2 ON d2.nidn = sk.pembimbing2_nidn
       WHERE sk.pembimbing1_nidn = ? OR sk.pembimbing2_nidn = ?
       ORDER BY k.updated_at DESC`,
      [nidn, nidn],
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
      [kartuIds],
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
      return res
        .status(403)
        .json({ ok: false, message: "Only kaprodi can access this endpoint" });
    }

    const nidn = await getLecturerNidn(req.user.id);
    if (!nidn) {
      return res.status(400).json({ ok: false, message: "Dosen tidak valid" });
    }

    const programStudiIds = await getKaprodiProgramStudiIdsByNidn(nidn);
    if (programStudiIds.length === 0) {
      return res
        .status(403)
        .json({ ok: false, message: "You are not assigned as Kaprodi" });
    }

    const { q } = req.query || {};
    const where = ["sk.program_studi_id IN (?)"];
    const params = [programStudiIds];

    if (q && String(q).trim().length > 0) {
      const queryValue = `%${String(q).trim()}%`;
      where.push("(m.nama LIKE ? OR sk.npm LIKE ? OR sk.judul LIKE ?)");
      params.push(queryValue, queryValue, queryValue);
    }

    const [kartuRows] = await db.query(
      `SELECT
         k.id AS kartu_id, k.skripsi_id, sk.npm,
         sk.program_studi_id, sk.pembimbing1_nidn, sk.pembimbing2_nidn,
         k.is_completed, k.completed_at, k.created_at, k.updated_at,
         m.nama AS nama_mahasiswa, ps.nama AS program_studi_nama,
         sk.judul AS judul_skripsi,
         d1.nama AS pembimbing1_nama, d2.nama AS pembimbing2_nama,
         o.submission_period_id,
         osp.tahun_akademik AS period_tahun_akademik,
         osp.periode_akademik AS period_periode_akademik
       FROM kartu_konsultasi_skripsi k
       JOIN skripsi sk ON sk.id = k.skripsi_id
       JOIN mahasiswa m ON m.npm = sk.npm
       JOIN program_studi ps ON ps.id = sk.program_studi_id
       LEFT JOIN dosen d1 ON d1.nidn = sk.pembimbing1_nidn
       LEFT JOIN dosen d2 ON d2.nidn = sk.pembimbing2_nidn
       LEFT JOIN outline o ON o.id = sk.outline_id
       LEFT JOIN outline_submission_period osp ON osp.id = o.submission_period_id
       WHERE ${where.join(" AND ")}
       ORDER BY k.updated_at DESC`,
      params,
    );

    if (kartuRows.length === 0) {
      return res.json({ ok: true, data: [] });
    }

    const kartuIds = kartuRows.map((r) => r.kartu_id);
    const [stageRows] = await db.query(
      `SELECT *
       FROM konsultasi_skripsi_stage
       WHERE kartu_konsultasi_skripsi_id IN (?)`,
      [kartuIds],
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
    const skripsiId = Number(req.params.skripsiId);
    if (!Number.isFinite(skripsiId) || skripsiId <= 0) {
      return res.status(400).json({ ok: false, message: "Invalid skripsiId" });
    }

    const [kartuRows] = await db.query(
      `SELECT k.id, k.skripsi_id, k.is_completed, k.file_content, k.file_name, k.mime_type,
              sk.npm, sk.pembimbing1_nidn, sk.pembimbing2_nidn, sk.program_studi_id
       FROM kartu_konsultasi_skripsi k
       JOIN skripsi sk ON sk.id = k.skripsi_id
       WHERE k.skripsi_id = ? LIMIT 1`,
      [skripsiId],
    );
    const kartu = kartuRows[0] ?? null;
    if (!kartu) {
      return res
        .status(404)
        .json({ ok: false, message: "Consultation not found" });
    }

    let isAuthorized = false;
    if (req.user.userType === "STUDENT") {
      const npm = await getStudentNpm(req.user.id);
      isAuthorized = Boolean(npm) && npm === kartu.npm;
    } else if (req.user.userType === "LECTURER") {
      const nidn = await getLecturerNidn(req.user.id);
      if (nidn) {
        isAuthorized =
          nidn === kartu.pembimbing1_nidn || nidn === kartu.pembimbing2_nidn;
        if (!isAuthorized && hasRole(req, "KAPRODI")) {
          const kaprodiProgramStudiIds =
            await getKaprodiProgramStudiIdsByNidn(nidn);
          isAuthorized = kaprodiProgramStudiIds.includes(
            Number(kartu.program_studi_id),
          );
        }
      }
    }

    if (!isAuthorized) {
      return res.status(403).json({ ok: false, message: "Forbidden" });
    }

    if (!kartu.file_content) {
      return res
        .status(404)
        .json({ ok: false, message: "Final artifact not found" });
    }

    const fileBuffer = Buffer.from(kartu.file_content, "base64");
    const mimeType =
      kartu.mime_type ??
      "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
    res.setHeader("Content-Type", mimeType);
    res.setHeader(
      "Content-Disposition",
      `attachment; filename="${kartu.file_name ?? "kartu-konsultasi-skripsi.docx"}"`,
    );
    res.setHeader("Content-Length", fileBuffer.length);
    return res.send(fileBuffer);
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

    const skripsiId = Number(req.params.skripsiId);
    if (!Number.isFinite(skripsiId) || skripsiId <= 0) {
      return res.status(400).json({ ok: false, message: "Invalid skripsiId" });
    }

    const nidn = await getLecturerNidn(req.user.id);
    if (!nidn) {
      return res.status(400).json({ ok: false, message: "Dosen tidak valid" });
    }

    const programStudiIds = await getKaprodiProgramStudiIdsByNidn(nidn);
    if (programStudiIds.length === 0) {
      return res
        .status(403)
        .json({ ok: false, message: "You are not assigned as Kaprodi" });
    }

    const [kartuRows] = await db.query(
      `SELECT k.id, k.skripsi_id, k.is_completed, k.created_at,
              sk.npm, sk.program_studi_id,
              m.nama AS nama_mahasiswa, ps.nama AS program_studi_nama,
              sk.judul AS judul_skripsi,
              d1.nama AS pembimbing1_nama, d2.nama AS pembimbing2_nama
       FROM kartu_konsultasi_skripsi k
       JOIN skripsi sk ON sk.id = k.skripsi_id
       JOIN mahasiswa m ON m.npm = sk.npm
       JOIN program_studi ps ON ps.id = sk.program_studi_id
       LEFT JOIN dosen d1 ON d1.nidn = sk.pembimbing1_nidn
       LEFT JOIN dosen d2 ON d2.nidn = sk.pembimbing2_nidn
       WHERE k.skripsi_id = ?
       LIMIT 1`,
      [skripsiId],
    );
    const kartu = kartuRows[0] ?? null;
    if (!kartu) {
      return res
        .status(404)
        .json({ ok: false, message: "Consultation not found" });
    }

    if (!programStudiIds.includes(Number(kartu.program_studi_id))) {
      return res.status(403).json({ ok: false, message: "Forbidden" });
    }

    const [stages] = await db.query(
      `SELECT id, chapter_group, stage, current_status
       FROM konsultasi_skripsi_stage
       WHERE kartu_konsultasi_skripsi_id = ?
       ORDER BY FIELD(chapter_group, 'BAB_1_2','BAB_3','BAB_4','BAB_5') ASC,
                CASE stage WHEN 'PEMBIMBING_2' THEN 1 WHEN 'PEMBIMBING_1' THEN 2 ELSE 3 END ASC`,
      [kartu.id],
    );

    const [submissions] = await db.query(
      `SELECT s.id, s.konsultasi_skripsi_stage_id AS stage_id,
              s.submission_no, s.file_name, s.submitted_at
       FROM konsultasi_skripsi_submission s
       INNER JOIN konsultasi_skripsi_stage st ON st.id = s.konsultasi_skripsi_stage_id
       WHERE st.kartu_konsultasi_skripsi_id = ?
       ORDER BY s.submitted_at DESC`,
      [kartu.id],
    );

    const [reviews] = await db.query(
      `SELECT r.id, r.konsultasi_skripsi_stage_id AS stage_id,
              r.submission_no, r.decision_status, r.catatan_kartu,
              rf.file_name AS review_file_name, r.reviewed_at
       FROM konsultasi_skripsi_review r
       INNER JOIN konsultasi_skripsi_stage st ON st.id = r.konsultasi_skripsi_stage_id
       LEFT JOIN konsultasi_skripsi_review_file rf ON rf.konsultasi_skripsi_review_id = r.id
       WHERE st.kartu_konsultasi_skripsi_id = ?
       ORDER BY r.reviewed_at DESC`,
      [kartu.id],
    );

    const submissionsByStage = new Map();
    for (const s of submissions) {
      if (!submissionsByStage.has(s.stage_id))
        submissionsByStage.set(s.stage_id, []);
      submissionsByStage.get(s.stage_id).push(s);
    }

    const reviewsByStage = new Map();
    for (const r of reviews) {
      if (!reviewsByStage.has(r.stage_id)) reviewsByStage.set(r.stage_id, []);
      reviewsByStage.get(r.stage_id).push(r);
    }

    const stagesWithDetail = stages.map((s) => ({
      id: s.id,
      chapter_group: s.chapter_group,
      stage: s.stage,
      current_status: s.current_status,
      submissions: submissionsByStage.get(s.id) ?? [],
      reviews: reviewsByStage.get(s.id) ?? [],
    }));

    const resolved = resolveActiveStage(stages);

    return res.json({
      ok: true,
      data: {
        kartu: {
          id: kartu.id,
          skripsi_id: kartu.skripsi_id,
          is_completed: kartu.is_completed,
          created_at: kartu.created_at,
          nama_mahasiswa: kartu.nama_mahasiswa,
          npm: kartu.npm,
          judul_skripsi: kartu.judul_skripsi,
          program_studi_nama: kartu.program_studi_nama,
          pembimbing1_nama: kartu.pembimbing1_nama,
          pembimbing2_nama: kartu.pembimbing2_nama,
        },
        active_stage_resolution: {
          active_chapter_group: resolved.chapterGroup,
          active_stage: resolved.activeStage,
          active_status: resolved.activeStatus,
        },
        stages: stagesWithDetail,
      },
    });
  } catch (err) {
    next(err);
  }
};

exports.previewKartuDocx = async (req, res, next) => {
  try {
    const skripsiId = Number(req.params.skripsiId);
    if (!Number.isFinite(skripsiId) || skripsiId <= 0) {
      return res.status(400).json({ ok: false, message: "Invalid skripsiId" });
    }

    const [kartuRows] = await db.query(
      `SELECT k.id, k.skripsi_id, k.is_completed, k.completed_at, k.file_content, k.file_name, k.mime_type,
              sk.npm, sk.pembimbing1_nidn, sk.pembimbing2_nidn, sk.program_studi_id
       FROM kartu_konsultasi_skripsi k
       JOIN skripsi sk ON sk.id = k.skripsi_id
       WHERE k.skripsi_id = ? LIMIT 1`,
      [skripsiId],
    );
    const kartu = kartuRows[0] ?? null;
    if (!kartu) {
      return res
        .status(404)
        .json({ ok: false, message: "Consultation not found" });
    }

    let isAuthorized = false;
    if (req.user.userType === "STUDENT") {
      const npm = await getStudentNpm(req.user.id);
      isAuthorized = Boolean(npm) && npm === kartu.npm;
    } else if (req.user.userType === "LECTURER") {
      const nidn = await getLecturerNidn(req.user.id);
      if (nidn) {
        isAuthorized =
          nidn === kartu.pembimbing1_nidn || nidn === kartu.pembimbing2_nidn;
        if (!isAuthorized && hasRole(req, "KAPRODI")) {
          const kaprodiProgramStudiIds =
            await getKaprodiProgramStudiIdsByNidn(nidn);
          isAuthorized = kaprodiProgramStudiIds.includes(
            Number(kartu.program_studi_id),
          );
        }
      }
    }

    if (!isAuthorized) {
      return res.status(403).json({ ok: false, message: "Forbidden" });
    }

    const logs = await getKartuLogs(db, kartu.id);
    const extra = await fetchKartuExtra(db, kartu.id, kartu.skripsi_id);
    const kartuFull = await fetchKartuDenorm(db, kartu);
    const outputBuffer = await buildKartuKonsultasiSkripsiDocxBuffer(
      kartuFull,
      logs,
      extra,
    );
    const fileName = buildKartuFileName(
      kartuFull.npm,
      kartuFull.nama_mahasiswa,
      "Kartu Penulisan Skripsi Preview",
    );

    res.setHeader(
      "Content-Type",
      "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    );
    res.setHeader("Content-Disposition", `attachment; filename="${fileName}"`);
    res.setHeader("Content-Length", outputBuffer.length);
    return res.send(outputBuffer);
  } catch (err) {
    next(err);
  }
};
