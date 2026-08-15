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

module.exports = {
  createOutline,
  getExistingOutlinesByNpm,
  hasNonRejectedOutline,
  hasActiveSkripsi,
};
