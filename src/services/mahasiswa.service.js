const db = require("../db");
const { getStudentNpm } = require("../utils/identity");

async function getMahasiswaNameByNpm(npm) {
  const [mahasiswaRows] = await db.query(
    `SELECT m.nama FROM mahasiswa m WHERE m.npm = ? LIMIT 1`,
    [npm],
  );
  return mahasiswaRows[0]?.nama ?? npm;
}

module.exports = { getNpmByUserId: getStudentNpm, getMahasiswaNameByNpm };
