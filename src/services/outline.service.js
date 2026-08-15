const db = require("../db");
const { insertNotification } = require("../utils/notify");

async function notifyKaprodiOfOutline(conn, programStudiId, type, message) {
  const [kaprodiUserRows] = await conn.query(
    `SELECT u.id FROM users u
     JOIN user_roles ur ON ur.user_id = u.id
     JOIN roles r ON r.id = ur.role_id
     JOIN program_studi ps ON ps.kaprodi_nidn = u.nidn
     WHERE r.code = 'KAPRODI' AND ur.program_studi_id = ?
     LIMIT 1`,
    [programStudiId],
  );
  if (kaprodiUserRows[0]?.id) {
    await insertNotification(
      conn,
      kaprodiUserRows[0].id,
      type,
      message,
      "/kaprodi/pengajuan-outline/outlines",
    );
  }
}

async function createOutline(
  judul,
  latarBelakang,
  npm,
  programStudiId,
  submissionPeriodId,
  fileOutline,
  fileOutlineName,
  namaMahasiswa,
) {
  const conn = await db.getConnection();
  let txStarted = false;
  try {
    await conn.beginTransaction();
    txStarted = true;

    const [insertResult] = await conn.query(
      `INSERT INTO outline
             (judul, latar_belakang, npm, status, program_studi_id, submission_period_id)
             VALUES (?, ?, ?, 'SUBMITTED', ?, ?)`,
      [judul, latarBelakang, npm, programStudiId, submissionPeriodId],
    );

    const outlineId = insertResult?.insertId ?? null;
    if (outlineId) {
      await conn.query(
        `INSERT INTO outline_submissions
               (outline_id, submission_no, file_content, file_name)
               VALUES (?, 1, ?, ?)`,
        [outlineId, fileOutline, fileOutlineName ?? null],
      );
    }

    await notifyKaprodiOfOutline(
      conn,
      programStudiId,
      "OUTLINE_SUBMITTED",
      `Mahasiswa ${namaMahasiswa} mengajukan outline baru`,
    );

    await conn.commit();
    txStarted = false;
  } catch (err) {
    try {
      if (txStarted) await conn.rollback();
    } catch (_) {}
    throw err;
  } finally {
    conn.release();
  }
}

async function getExistingOutlinesByNpm(npm) {
  return await db.query(
    `SELECT id, status
           FROM outline
           WHERE npm = ?`,
    [npm],
  );
}

async function hasNonRejectedOutline(npm) {
  const [existingOutlines] = await getExistingOutlinesByNpm(npm);
  return existingOutlines.some(
    (outline) => String(outline.status || "").toUpperCase() !== "REJECTED",
  );
}

async function hasActiveSkripsi(npm) {
  const [[activeSkripsi]] = await db.query(
    `SELECT id FROM skripsi WHERE npm = ? AND status = 'IN_PROGRESS' LIMIT 1`,
    [npm],
  );
  return Boolean(activeSkripsi);
}

async function getOutlineDetailById(id, studentNpm) {
  const whereNpm = studentNpm ? "AND o.npm = ?" : "";
  const params = studentNpm ? [id, studentNpm] : [id];

  const [rows] = await db.query(
    `SELECT
       o.id,
       o.judul,
       o.latar_belakang,
       o.npm,
       o.status,
       rev.decision_note,
       o.created_at,
       o.updated_at,
       m.nama AS mahasiswa_nama,
       m.sks AS mahasiswa_sks,
       m.program_studi_id,
       ps.nama AS program_studi_nama,
       sub.file_content AS file_outline_mahasiswa,
       sub.file_name AS file_outline_mahasiswa_name,
       rev.file_content AS file_outline_kaprodi,
       rev.file_name AS file_outline_kaprodi_name,
       sub.submission_no AS file_revision_no,
       sub.submitted_at AS file_updated_at,
       prev_rev.decision_note AS previous_decision_note
     FROM outline o
     INNER JOIN mahasiswa m ON m.npm = o.npm
     INNER JOIN program_studi ps ON ps.id = m.program_studi_id
     LEFT JOIN outline_submissions sub
       ON sub.outline_id = o.id
      AND sub.submission_no = (
        SELECT MAX(submission_no) FROM outline_submissions WHERE outline_id = o.id
      )
     LEFT JOIN outline_reviews rev ON rev.submission_id = sub.id
     LEFT JOIN outline_submissions prev_sub
       ON prev_sub.outline_id = o.id
      AND prev_sub.submission_no = (
        SELECT MAX(submission_no) - 1 FROM outline_submissions WHERE outline_id = o.id
      )
     LEFT JOIN outline_reviews prev_rev ON prev_rev.submission_id = prev_sub.id
     WHERE o.id = ? ${whereNpm}
     LIMIT 1`,
    params,
  );

  return rows[0] ?? null;
}

async function getRejectedOutlinesByNpm(npm, excludeId) {
  const [rows] = await db.query(
    `SELECT
       id,
       judul,
       status,
       created_at,
       updated_at
     FROM outline
     WHERE npm = ?
       AND id <> ?
       AND status = 'REJECTED'
     ORDER BY created_at DESC`,
    [npm, excludeId],
  );
  return rows;
}

async function getLatestOutlineByNpm(npm) {
  const [rows] = await db.query(
    `SELECT
       o.id,
       o.judul,
       o.latar_belakang,
       o.npm,
       o.status,
       rev.decision_note,
       o.created_at,
       o.updated_at,
       m.nama AS mahasiswa_nama,
       m.sks AS mahasiswa_sks,
       m.program_studi_id,
       ps.nama AS program_studi_nama,
       sub.file_content AS file_outline_mahasiswa,
       sub.file_name AS file_outline_mahasiswa_name,
       rev.file_content AS file_outline_kaprodi,
       rev.file_name AS file_outline_kaprodi_name,
       sub.submission_no AS file_revision_no,
       sub.submitted_at AS file_updated_at
     FROM outline o
     INNER JOIN mahasiswa m ON m.npm = o.npm
     INNER JOIN program_studi ps ON ps.id = m.program_studi_id
     LEFT JOIN outline_submissions sub
       ON sub.outline_id = o.id
      AND sub.submission_no = (
        SELECT MAX(submission_no) FROM outline_submissions WHERE outline_id = o.id
      )
     LEFT JOIN outline_reviews rev ON rev.submission_id = sub.id
     WHERE o.npm = ?
     ORDER BY o.updated_at DESC
     LIMIT 1`,
    [npm],
  );

  return rows[0] ?? null;
}

async function getOutlineNpmInProdi(id, programStudiId) {
  const [rows] = await db.query(
    `SELECT o.npm
     FROM outline o
     INNER JOIN mahasiswa m ON m.npm = o.npm
     WHERE o.id = ? AND m.program_studi_id = ?
     LIMIT 1`,
    [id, programStudiId],
  );
  return rows[0]?.npm ?? null;
}

async function getOutlineReviewHistory(id) {
  const [rows] = await db.query(
    `SELECT
       sub.submission_no AS revision_no,
       sub.file_content AS file_outline_mahasiswa,
       sub.file_name AS file_outline_mahasiswa_name,
       rev.file_content AS file_outline_kaprodi,
       rev.file_name AS file_outline_kaprodi_name,
       rev.decision_note,
       sub.submitted_at AS updated_at,
       o.id AS outline_id,
       o.judul,
       o.status
     FROM outline_submissions sub
     INNER JOIN outline o ON o.id = sub.outline_id
     LEFT JOIN outline_reviews rev ON rev.submission_id = sub.id
     WHERE o.id = ?
     ORDER BY sub.submission_no DESC`,
    [id],
  );
  return rows;
}

async function listOutlinesForKaprodi({
  programStudiId,
  status,
  q,
  tahunAkademik,
  periodeAkademik,
}) {
  const where = ["m.program_studi_id = ?"];
  const params = [programStudiId];

  if (status) {
    where.push("o.status = ?");
    params.push(status);
  }
  if (q) {
    where.push("o.judul LIKE ?");
    params.push(`%${q}%`);
  }
  if (tahunAkademik) {
    where.push("osp.tahun_akademik = ?");
    params.push(tahunAkademik);
  }
  if (periodeAkademik) {
    where.push("osp.periode_akademik = ?");
    params.push(periodeAkademik);
  }

  const whereSql = `WHERE ${where.join(" AND ")}`;

  const [rows] = await db.query(
    `SELECT
       o.id,
       o.judul,
       o.status,
       o.created_at,
       o.updated_at,
       o.npm,
       m.nama AS mahasiswa_nama,
       m.sks AS mahasiswa_sks,
       m.program_studi_id,
       o.submission_period_id,
       osp.tahun_akademik AS period_tahun_akademik,
       osp.periode_akademik AS period_periode_akademik
     FROM outline o
     INNER JOIN mahasiswa m ON m.npm = o.npm
     INNER JOIN (
       SELECT npm, MAX(id) AS max_id
       FROM outline
       GROUP BY npm
     ) latest ON latest.npm = o.npm AND latest.max_id = o.id
     LEFT JOIN outline_submission_period osp ON osp.id = o.submission_period_id
     ${whereSql}
     ORDER BY o.created_at DESC`,
    params,
  );

  return rows;
}

module.exports = {
  createOutline,
  getExistingOutlinesByNpm,
  hasNonRejectedOutline,
  hasActiveSkripsi,
  getOutlineDetailById,
  getRejectedOutlinesByNpm,
  getLatestOutlineByNpm,
  getOutlineNpmInProdi,
  getOutlineReviewHistory,
  listOutlinesForKaprodi,
};
