const db = require("../db");

// Only mahasiswa (npm) and dosen (nidn) use their own identifiers. Every other role holder —
// Kaprodi, Sekprodi, Dekan, Sekretariat, ... — is a staff account identified by users.staff_usr_id,
// and program_studi/fakultas point at them through the *_staff_usr_id columns.

async function getStudentNpm(userId) {
  const [rows] = await db.query(
    `SELECT npm FROM users WHERE id = ? AND is_active = 1 LIMIT 1`,
    [userId],
  );
  return rows[0]?.npm ?? null;
}

// NIDN only: a staff id must never match pembimbing*/penguji* columns.
async function getLecturerNidn(userId) {
  const [rows] = await db.query(
    `SELECT nidn FROM users WHERE id = ? AND is_active = 1 LIMIT 1`,
    [userId],
  );
  return rows[0]?.nidn ?? null;
}

async function getStaffUsrId(userId) {
  const [rows] = await db.query(
    `SELECT staff_usr_id FROM users WHERE id = ? AND is_active = 1 LIMIT 1`,
    [userId],
  );
  return rows[0]?.staff_usr_id ?? null;
}

async function getKaprodiProgramStudiIds(staffUsrId) {
  if (!staffUsrId) return [];
  const [rows] = await db.query(
    `SELECT id FROM program_studi WHERE kaprodi_staff_usr_id = ?`,
    [staffUsrId],
  );
  return rows
    .map((row) => Number(row.id))
    .filter((id) => Number.isFinite(id) && id > 0);
}

module.exports = {
  getStudentNpm,
  getLecturerNidn,
  getStaffUsrId,
  getKaprodiProgramStudiIds,
};
