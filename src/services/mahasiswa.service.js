const db = require("../db");

async function getNpmByUserId(userId) {
  const [users] = await db.query(`SELECT npm FROM users WHERE id = ? LIMIT 1`, [
    userId,
  ]);

  return users;
}

async function getMahasiswaNameByNpm(npm) {
  const [mahasiswaRows] = await db.query(
    `SELECT m.nama FROM mahasiswa m WHERE m.npm = ? LIMIT 1`,
    [npm],
  );
  return mahasiswaRows[0]?.nama ?? npm;
}

module.exports = { getNpmByUserId, getMahasiswaNameByNpm };
