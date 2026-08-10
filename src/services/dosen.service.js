const db = require("../db");

async function listDosen() {
  const [rows] = await db.query(
    `SELECT nidn, nama
       FROM dosen
       ORDER BY nama ASC`,
  );

  return rows;
}

module.exports = { listDosen };
