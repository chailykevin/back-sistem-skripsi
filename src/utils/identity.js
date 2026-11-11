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

// Active KAPRODI accounts heading a program studi — the recipients of "new submission" notifications.
async function getKaprodiUserIds(queryable, programStudiId) {
  const [rows] = await queryable.query(
    `SELECT DISTINCT u.id FROM users u
     JOIN user_roles ur ON ur.user_id = u.id AND ur.is_active = 1
     JOIN roles r ON r.id = ur.role_id AND r.code = 'KAPRODI'
     JOIN program_studi ps ON ps.kaprodi_staff_usr_id = u.staff_usr_id
     WHERE ps.id = ? AND u.is_active = 1`,
    [programStudiId],
  );
  return rows.map((row) => row.id);
}

async function isKaprodiOfProgramStudi(userId, programStudiId) {
  const programStudiIds = await getKaprodiProgramStudiIds(
    await getStaffUsrId(userId),
  );
  return programStudiIds.includes(Number(programStudiId));
}

module.exports = {
  getStudentNpm,
  getLecturerNidn,
  getStaffUsrId,
  getKaprodiProgramStudiIds,
  getKaprodiUserIds,
  isKaprodiOfProgramStudi,
};
