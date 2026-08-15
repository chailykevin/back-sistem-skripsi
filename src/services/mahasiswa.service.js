const db = require("../db");

async function getNpmByUserId(userId) {
  const [users] = await db.query(
    `SELECT npm FROM users WHERE id = ? AND is_active = 1 LIMIT 1`,
    [userId],
  );

  return users[0]?.npm ?? null;
}

async function getMahasiswaNameByNpm(npm) {
  const [mahasiswaRows] = await db.query(
    `SELECT m.nama FROM mahasiswa m WHERE m.npm = ? LIMIT 1`,
    [npm],
  );
  return mahasiswaRows[0]?.nama ?? npm;
}

module.exports = { getNpmByUserId, getMahasiswaNameByNpm };
