const db = require("../db");
const { insertNotification } = require("../utils/notify");
const { parsePagination, listResponse } = require("../utils/pagination");
const { UPLOAD_RULES, validateUpload } = require("../utils/upload");
const { mimeFromFileName } = require("../utils/mime");
const {
  CHAPTER_ORDER,
  resolveActiveKonsultasiSkripsiStage: resolveActiveStage,
} = require("../utils/workflowStage");
const {
  getOpenPeriod: getSidangOpenPeriod,
} = require("../services/sidangSubmissionPeriod.service");
const {
  attachSidangSystemFiles,
} = require("../services/pengajuanSidangSystemFiles.service");
const {
  generateKartuPenulisanSkripsiFTI,
} = require("../services/generateKartuPenulisanSkripsiFTI.js");
const { getStudentNpm, getLecturerNidn, getStaffUsrId, getKaprodiProgramStudiIds } = require("../utils/identity");
const {
  assertSignatures,
  getStaffSignature,
  hasSignature,
} = require("../utils/signature");
const {
  JENIS,
  requireJenis,
  resolveJenis,
} = require("../services/sidangScope.service");

// A Seminar Bisnis Digital record pauses after Bab 3 for its Seminar sidang; Bab 4 opens when the
// Seminar revisi completes (finishSeminarPhase), when resolveJenis switches the record to SKRIPSI.
function lastChapterGroupFor(jenis) {
  return jenis === JENIS.SEMINAR_BISNIS_DIGITAL ? "BAB_3" : "BAB_5";
}

function isPausedForSeminar(jenis, stages) {
  return (
    jenis === JENIS.SEMINAR_BISNIS_DIGITAL &&
    stages.some(
      (s) =>
        s.chapter_group === lastChapterGroupFor(jenis) &&
        s.stage === "PEMBIMBING_1" &&
        s.current_status === "ACCEPTED",
    )
  );
}

// Auto-init at the end of a konsultasi phase: the pengajuan_sidang DRAFT, its Kaprodi row and the
// system files. Existence-guarded, so a repeated call is a no-op.
async function ensurePengajuanSidangDraft(conn, skripsiId, jenis) {
  const [[existing]] = await conn.query(
    `SELECT id FROM pengajuan_sidang
     WHERE skripsi_id = ? AND jenis = ? AND status <> 'COMPLETED'
     ORDER BY id DESC LIMIT 1`,
    [skripsiId, requireJenis(jenis)],
  );
  let pengajuanSidangId = existing?.id ?? null;
  if (!pengajuanSidangId) {
    const openPeriod = await getSidangOpenPeriod(jenis);
    const [ins] = await conn.query(
      `INSERT INTO pengajuan_sidang (skripsi_id, jenis, status, ujian_ke, sidang_submission_period_id) VALUES (?, ?, 'DRAFT', 1, ?)`,
      [skripsiId, jenis, openPeriod?.id ?? null],
    );
    pengajuanSidangId = ins.insertId;
  }

  const [[existingKaprodi]] = await conn.query(
    `SELECT id FROM pengajuan_sidang_kaprodi WHERE pengajuan_sidang_id = ? LIMIT 1`,
    [pengajuanSidangId],
  );
  if (!existingKaprodi) {
    await conn.query(
      `INSERT INTO pengajuan_sidang_kaprodi (pengajuan_sidang_id, status) VALUES (?, 'DRAFT')`,
      [pengajuanSidangId],
    );
  }

  await attachSidangSystemFiles(conn, pengajuanSidangId, skripsiId);
}
const CHAPTER_LABEL = {
  BAB_1: "Bab 1",
  BAB_2: "Bab 2",
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
  const safeNpm = String(npm ?? "")
    .trim()
    .replace(/[/\\:*?"<>|]+/g, "_");
  const safeNama = String(namaMahasiswa ?? "")
    .trim()
    .replace(/[/\\:*?"<>|]+/g, "_");
  return `${safeNpm} - ${safeNama} - ${suffix}.pdf`;
}

function hasRole(req, role) {
  return typeof req.user?.hasRole === "function" && req.user.hasRole(role);
}

// Student owner, either assigned pembimbing, or the Kaprodi of the student's prodi.
async function canAccessSkripsiConsultation(
  req,
  { npm, pembimbing1_nidn, pembimbing2_nidn, program_studi_id },
) {
  if (req.user.userType === "STUDENT") {
    const studentNpm = await getStudentNpm(req.user.id);
    return Boolean(studentNpm) && studentNpm === npm;
  }
  const nidn = await getLecturerNidn(req.user.id);
  if (nidn && (nidn === pembimbing1_nidn || nidn === pembimbing2_nidn)) {
    return true;
  }
  if (!hasRole(req, "KAPRODI")) return false;
  const staffUsrId = await getStaffUsrId(req.user.id);
  if (!staffUsrId) return false;
  const programStudiIds = await getKaprodiProgramStudiIds(staffUsrId);
  return programStudiIds.includes(Number(program_studi_id));
}

const SUBMITTABLE_STAGE_STATUSES = ["WAITING_SUBMISSION", "NEED_REVISION"];

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
  return CHAPTER_LABEL[chapterGroup] ?? chapterGroup ?? "";
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
  return stageStatus === "SUBMITTED";
}

// Every review is a kartu row; the PDF table grows onto more pages as needed.
async function getKartuLogs(queryable, kartuId) {
  const [logs] = await queryable.query(
    `SELECT
       st.chapter_group,
       st.stage,
       rv.submission_no,
       u.nidn          AS reviewer_nidn,
       d.nama          AS reviewer_nama,
       sd.dsnTtd       AS reviewer_signature,
       rv.decision_status AS status,
       rv.catatan_kartu,
       rv.reviewed_at  AS logged_at
     FROM konsultasi_skripsi_review rv
     JOIN konsultasi_skripsi_stage st ON st.id = rv.konsultasi_skripsi_stage_id
     LEFT JOIN users u ON u.id = rv.reviewer_user_id
     LEFT JOIN dosen d ON d.nidn = u.nidn
     LEFT JOIN widya_miko.m_dosen sd ON sd.dsnId = st.pembimbing_nidn
     WHERE st.kartu_konsultasi_skripsi_id = ?
     ORDER BY rv.reviewed_at ASC, rv.id ASC`,
    [kartuId],
  );
  return logs;
}

function assertKartuKonsultasiSkripsiLogSignatures(logs) {
  assertSignatures(
    logs.map((log, idx) => ({
      role: `Paraf ${idx + 1} (${getChapterGroupLabel(log.chapter_group)} - ${getStageLabel(log.stage)})`,
      nama: log.reviewer_nama,
      signatureImage: log.reviewer_signature,
    })),
  );
}

function buildKartuKonsultasiSkripsiPdfData(kartu, logs, extra = {}) {
  return {
    nomorSk: extra.nomorSk ?? "",
    mahasiswa: {
      nama: kartu.nama_mahasiswa,
      npm: kartu.npm,
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
    ketuaProgramStudi: {
      nama: extra.kaprodiNama ?? "",
      signatureBase64: extra.kaprodiSignature ?? null,
    },
    tanggalMulaiMenulis: extra.tanggalMulai ?? "",
    tanggalSelesaiMenulis: kartu.completed_at
      ? formatKartuDate(kartu.completed_at)
      : "",
    ...(extra.tanggalSelesaiProposal !== undefined && {
      tanggalSelesaiMenulisProposal: extra.tanggalSelesaiProposal,
    }),
    catatanKonsultasi: logs.map((log) => ({
      tanggal: formatKartuDate(log.logged_at),
      keterangan: `${getChapterGroupLabel(log.chapter_group)} - ${getStageLabel(log.stage)} - ${getDecisionLabel(log.status)}: ${log.catatan_kartu ?? ""}`,
      parafBase64: log.reviewer_signature,
    })),
  };
}

async function fetchKartuExtra(queryable, kartuId, skripsiId) {
  const [[skRow]] = await queryable.query(
    `SELECT psk.nomor_surat, psk.verified_at, psk.jenis_sk
     FROM pengajuan_sk_penelitian psk
     JOIN skripsi s ON s.outline_id = psk.outline_id
     WHERE s.id = ? ORDER BY psk.created_at DESC LIMIT 1`,
    [skripsiId],
  );

  // A student who went through the Seminar (Seminar SK) gets a separate "Selesai Menulis Proposal"
  // date on the card: when Pembimbing 1 accepted Bab 3. Read from the SK, which never changes, not
  // resolveJenis, which switches to SKRIPSI after the bridge.
  let tanggalSelesaiProposal;
  if (skRow?.jenis_sk === JENIS.SEMINAR_BISNIS_DIGITAL) {
    const [[bab3Row]] = await queryable.query(
      `SELECT finished_at FROM konsultasi_skripsi_stage
       WHERE kartu_konsultasi_skripsi_id = ? AND chapter_group = 'BAB_3'
         AND stage = 'PEMBIMBING_1' AND current_status = 'ACCEPTED'
       LIMIT 1`,
      [kartuId],
    );
    tanggalSelesaiProposal = bab3Row?.finished_at
      ? formatKartuDate(bab3Row.finished_at)
      : "";
  }

  const [[psRow]] = await queryable.query(
    `SELECT f.nama AS fakultas_nama, ps.kaprodi_staff_usr_id
     FROM kartu_konsultasi_skripsi k
     JOIN skripsi sk ON sk.id = k.skripsi_id
     JOIN program_studi ps ON ps.id = sk.program_studi_id
     LEFT JOIN fakultas f ON f.id = ps.fakultas_id
     WHERE k.id = ? LIMIT 1`,
    [kartuId],
  );

  let kaprodiNama = "";
  let kaprodiSignature = null;
  if (psRow?.kaprodi_staff_usr_id) {
    const [[kaprodiRow]] = await queryable.query(
      `SELECT nama FROM staf WHERE usr_id = ? LIMIT 1`,
      [psRow.kaprodi_staff_usr_id],
    );
    kaprodiNama = kaprodiRow?.nama ?? "";
    kaprodiSignature = await getStaffSignature(
      queryable,
      psRow.kaprodi_staff_usr_id,
    );
  }

  return {
    fakultasNama: psRow?.fakultas_nama ?? "",
    nomorSk: skRow?.nomor_surat ?? "",
    tanggalMulai: skRow?.verified_at ? formatKartuDate(skRow.verified_at) : "",
    tanggalSelesaiProposal,
    kaprodiNama,
    kaprodiSignature,
  };
}

async function fetchKartuDenorm(queryable, kartu) {
  const [[row]] = await queryable.query(
    `SELECT m.npm AS npm, m.nama AS nama_mahasiswa, ps.nama AS program_studi_nama,
            sk.judul AS judul_skripsi,
            d1.nama AS pembimbing1_nama, d2.nama AS pembimbing2_nama,
            sd1.dsnTtd AS pembimbing1_signature,
            sd2.dsnTtd AS pembimbing2_signature
     FROM kartu_konsultasi_skripsi k
     JOIN skripsi sk ON sk.id = k.skripsi_id
     JOIN mahasiswa m ON m.npm = sk.npm
     JOIN program_studi ps ON ps.id = sk.program_studi_id
     LEFT JOIN dosen d1 ON d1.nidn = sk.pembimbing1_nidn
     LEFT JOIN dosen d2 ON d2.nidn = sk.pembimbing2_nidn
     LEFT JOIN widya_miko.m_dosen sd1 ON sd1.dsnId = sk.pembimbing1_nidn
     LEFT JOIN widya_miko.m_dosen sd2 ON sd2.dsnId = sk.pembimbing2_nidn
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
    {
      role: "Pembimbing 1",
      nama: kartuFull.pembimbing1_nama,
      signatureImage: kartuFull.pembimbing1_signature,
    },
    {
      role: "Pembimbing 2",
      nama: kartuFull.pembimbing2_nama,
      signatureImage: kartuFull.pembimbing2_signature,
    },
    {
      role: "Kaprodi",
      nama: extra.kaprodiNama,
      signatureImage: extra.kaprodiSignature,
    },
  ]);

  assertKartuKonsultasiSkripsiLogSignatures(logs);

  const outputBuffer = await generateKartuPenulisanSkripsiFTI(
    buildKartuKonsultasiSkripsiPdfData(kartuFull, logs, extra),
  );
  const fileName = buildKartuFileName(
    kartuFull.npm,
    kartuFull.nama_mahasiswa,
    "Kartu Penulisan Skripsi",
  );

  await queryable.query(
    `UPDATE kartu_konsultasi_skripsi
     SET file_content = ?, file_name = ?,
         mime_type = 'application/pdf',
         generated_by_user_id = ?, generated_at = NOW()
     WHERE id = ?`,
    [
      Buffer.from(outputBuffer).toString("base64"),
      fileName,
      generatedByUserId,
      kartuId,
    ],
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
       ) VALUES (?, 'BAB_1', 'PEMBIMBING_2', ?, 'WAITING_SUBMISSION', 0, CURRENT_TIMESTAMP)`,
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
      `SELECT k.id, k.skripsi_id, k.is_completed, k.completed_at, k.file_name, k.mime_type,
              k.generated_at, k.created_at, k.updated_at,
              sk.npm, sk.judul AS judul_skripsi, sk.program_studi_id, sk.jalur,
              sk.pembimbing1_nidn, sk.pembimbing2_nidn,
              m.nama AS nama_mahasiswa, ps.nama AS program_studi_nama,
              d1.nama AS pembimbing1_nama, d2.nama AS pembimbing2_nama,
              (k.file_content IS NOT NULL) AS has_kartu_file
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
       ORDER BY FIELD(chapter_group, 'BAB_1','BAB_2','BAB_3','BAB_4','BAB_5') ASC,
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
    const jenis = await resolveJenis(db, skripsiId);

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
        jenis,
        pausedForSeminar: isPausedForSeminar(jenis, stages),
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
    const uploadError = validateUpload(
      fileContent,
      safeFileName,
      UPLOAD_RULES.SKRIPSI_CHAPTER,
      "File bab",
    );
    if (uploadError) {
      return res.status(400).json({ ok: false, message: uploadError });
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
       ORDER BY FIELD(chapter_group, 'BAB_1','BAB_2','BAB_3','BAB_4','BAB_5') ASC,
                CASE stage WHEN 'PEMBIMBING_2' THEN 1 WHEN 'PEMBIMBING_1' THEN 2 ELSE 3 END ASC
       FOR UPDATE`,
      [kartu.id],
    );

    const resolved = resolveActiveStage(stageRows);
    if (!resolved.stageRow) {
      const jenis = await resolveJenis(conn, skripsiId);
      await conn.rollback();
      txStarted = false;
      return res.status(409).json({
        ok: false,
        message: isPausedForSeminar(jenis, stageRows)
          ? "Konsultasi Bab 1–3 sudah selesai. Bab 4 dibuka setelah revisi seminar proposal selesai."
          : "No active stage to submit to",
      });
    }

    // A file can only be sent when the stage is waiting for one: not while the previous submission
    // is still waiting for review, and not after the stage is finished.
    const activeStage = resolved.stageRow;
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
         s.file_content, s.file_name,
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

    if (!(await canAccessSkripsiConsultation(req, submission))) {
      return res.status(403).json({ ok: false, message: "Forbidden" });
    }

    return res.json({
      ok: true,
      data: {
        file_name: submission.file_name,
        mime_type: mimeFromFileName(submission.file_name),
        file_content: submission.file_content,
      },
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
         rf.file_content, rf.file_name, rf.mime_type,
         sk.npm, sk.pembimbing1_nidn, sk.pembimbing2_nidn, sk.program_studi_id
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

    if (!(await canAccessSkripsiConsultation(req, file))) {
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

    const { decisionStatus, catatanKartu, reviewFile, reviewFileName } =
      req.body || {};

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
        UPLOAD_RULES.SKRIPSI_CHAPTER,
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

    // Lock the kartu before the stage, the same order as submitMyChapter, so a student submit
    // and a review can't deadlock. The kartu id is looked up before the transaction so this
    // plain read doesn't fix the transaction's snapshot.
    const [[stageKartuRow]] = await conn.query(
      `SELECT kartu_konsultasi_skripsi_id AS kartu_id
       FROM konsultasi_skripsi_stage
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
      `SELECT id FROM kartu_konsultasi_skripsi WHERE id = ? FOR UPDATE`,
      [stageKartuRow.kartu_id],
    );

    const [stageRows] = await conn.query(
      `SELECT s.*, k.id AS kartu_id, k.skripsi_id AS kartu_skripsi_id,
              sk.pembimbing1_nidn, sk.pembimbing2_nidn
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

    const jenis = await resolveJenis(conn, stage.kartu_skripsi_id);
    const isSeminar = jenis === JENIS.SEMINAR_BISNIS_DIGITAL;
    const isPhaseEnd =
      stage.stage === "PEMBIMBING_1" &&
      decisionStatus === "ACCEPTED" &&
      stage.chapter_group === lastChapterGroupFor(jenis);

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
            "No signature found in SIMIKO. Please update it in SIMIKO first.",
        });
      }
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
          mimeFromFileName(safeReviewFileName),
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
      if (!isPhaseEnd) {
        const nextChapter = nextChapterGroup(stage.chapter_group);
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
      } else if (isSeminar) {
        // Bab 1–3 card: same template and kartu row, left incomplete (blank Tanggal Selesai) and
        // overwritten by the Bab 1–5 card when Bab 5 is accepted.
        autoFinalizedFile = await generateAndStoreFinalKartuDocx(conn, {
          kartuId: stage.kartu_id,
          skripsiId: stage.kartu_skripsi_id,
          generatedByUserId: req.user.id,
        });
        await ensurePengajuanSidangDraft(
          conn,
          stage.kartu_skripsi_id,
          JENIS.SEMINAR_BISNIS_DIGITAL,
        );
      } else {
        await conn.query(
          `UPDATE kartu_konsultasi_skripsi
           SET is_completed = 1, completed_at = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP
           WHERE id = ?`,
          [stage.kartu_id],
        );
        autoFinalizedFile = await generateAndStoreFinalKartuDocx(conn, {
          kartuId: stage.kartu_id,
          skripsiId: stage.kartu_skripsi_id,
          generatedByUserId: req.user.id,
        });
        await ensurePengajuanSidangDraft(
          conn,
          stage.kartu_skripsi_id,
          JENIS.SKRIPSI,
        );
        await conn.query(
          `UPDATE skripsi
           SET status = 'COMPLETED', completed_at = CURRENT_TIMESTAMP
           WHERE id = ?`,
          [stage.kartu_skripsi_id],
        );
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
        if (isPhaseEnd && isSeminar) {
          await insertNotification(
            conn,
            studentUserId,
            "SKRIPSI_CONSULTATION_SEMINAR_COMPLETED",
            "Konsultasi Bab 1–3 Anda telah selesai. Silakan lanjut ke Pengajuan Sidang Seminar Bisnis Digital.",
            "/student/skripsi-consultations",
          );
        } else if (isPhaseEnd) {
          await insertNotification(
            conn,
            studentUserId,
            "SKRIPSI_CONSULTATION_COMPLETED",
            "Konsultasi skripsi Anda telah selesai",
            "/student/skripsi-consultations",
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
      message: isPhaseEnd
        ? "Review saved and kartu generated"
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

    // The kartu log is the same review list under the field names the kartu uses.
    const logs = reviews.map((r) => ({
      id: r.id,
      chapter_group: r.chapter_group,
      stage: r.stage,
      submission_no: r.submission_no,
      status: r.decision_status,
      catatan_kartu: r.catatan_kartu,
      logged_at: r.reviewed_at,
      has_review_file: r.has_review_file,
      review_file_id: r.review_file_id,
      review_file_name: r.review_file_name,
    }));

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
       ORDER BY FIELD(chapter_group, 'BAB_1','BAB_2','BAB_3','BAB_4','BAB_5') ASC,
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

    const { stage, status, q, tahunAkademik, periodeAkademik } = req.query || {};
    const pagination = parsePagination(req.query);
    const where = ["sk.program_studi_id IN (?)"];
    const params = [programStudiIds];

    if (q && String(q).trim().length > 0) {
      const queryValue = `%${String(q).trim()}%`;
      where.push("(m.nama LIKE ? OR sk.npm LIKE ? OR sk.judul LIKE ?)");
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
         k.id AS kartu_id, k.skripsi_id, sk.npm,
         sk.program_studi_id, sk.pembimbing1_nidn, sk.pembimbing2_nidn,
         k.is_completed, k.completed_at, k.created_at, k.updated_at,
         m.nama AS nama_mahasiswa, ps.nama AS program_studi_nama,
         sk.judul AS judul_skripsi,
         d1.nama AS pembimbing1_nama, d2.nama AS pembimbing2_nama,
         psk.submission_period_id,
         osp.tahun_akademik AS period_tahun_akademik,
         osp.periode_akademik AS period_periode_akademik
       FROM kartu_konsultasi_skripsi k
       JOIN skripsi sk ON sk.id = k.skripsi_id
       JOIN mahasiswa m ON m.npm = sk.npm
       JOIN program_studi ps ON ps.id = sk.program_studi_id
       LEFT JOIN dosen d1 ON d1.nidn = sk.pembimbing1_nidn
       LEFT JOIN dosen d2 ON d2.nidn = sk.pembimbing2_nidn
       LEFT JOIN pengajuan_sk_penelitian psk ON psk.outline_id = sk.outline_id
       LEFT JOIN outline_submission_period osp ON osp.id = psk.submission_period_id
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

    const filteredRows = rows.filter((row) => {
      if (stage && ["PEMBIMBING_2", "PEMBIMBING_1"].includes(stage) && row.active_stage !== stage) return false;
      if (status && ["WAITING_SUBMISSION", "SUBMITTED", "NEED_REVISION", "CONTINUE", "ACCEPTED"].includes(status) && row.active_status !== status) return false;
      return true;
    });
    pagination.totalItems = filteredRows.length;
    const pageRows = pagination.enabled
      ? filteredRows.slice(pagination.offset, pagination.offset + pagination.limit)
      : filteredRows;
    return listResponse(res, { rows: pageRows, pagination });
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

    if (!(await canAccessSkripsiConsultation(req, kartu))) {
      return res.status(403).json({ ok: false, message: "Forbidden" });
    }

    if (!kartu.file_content) {
      return res
        .status(404)
        .json({ ok: false, message: "Final artifact not found" });
    }

    const fileBuffer = Buffer.from(kartu.file_content, "base64");
    res.setHeader("Content-Type", kartu.mime_type ?? "application/pdf");
    res.setHeader(
      "Content-Disposition",
      `attachment; filename="${kartu.file_name ?? "kartu-penulisan-skripsi.pdf"}"`,
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
       ORDER BY FIELD(chapter_group, 'BAB_1','BAB_2','BAB_3','BAB_4','BAB_5') ASC,
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

exports.previewKartuPdf = async (req, res, next) => {
  try {
    const skripsiId = Number(req.params.skripsiId);
    if (!Number.isFinite(skripsiId) || skripsiId <= 0) {
      return res.status(400).json({ ok: false, message: "Invalid skripsiId" });
    }

    const [kartuRows] = await db.query(
      `SELECT k.id, k.skripsi_id, k.is_completed, k.completed_at,
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

    if (!(await canAccessSkripsiConsultation(req, kartu))) {
      return res.status(403).json({ ok: false, message: "Forbidden" });
    }

    const logs = await getKartuLogs(db, kartu.id);
    const extra = await fetchKartuExtra(db, kartu.id, kartu.skripsi_id);
    const kartuFull = await fetchKartuDenorm(db, kartu);
    assertKartuKonsultasiSkripsiLogSignatures(logs);

    const outputBuffer = await generateKartuPenulisanSkripsiFTI(
      buildKartuKonsultasiSkripsiPdfData(kartuFull, logs, extra),
    );
    const fileName = buildKartuFileName(
      kartuFull.npm,
      kartuFull.nama_mahasiswa,
      "Kartu Penulisan Skripsi Preview",
    );

    res.setHeader("Content-Type", "application/pdf");
    res.setHeader("Content-Disposition", `attachment; filename="${fileName}"`);
    res.setHeader("Content-Length", outputBuffer.length);
    return res.send(outputBuffer);
  } catch (err) {
    next(err);
  }
};
