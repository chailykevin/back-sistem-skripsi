const db = require("../db");

async function getOpenPeriod() {
  const [rows] = await db.query(
    `SELECT id, tahun_akademik, periode_akademik, open_at, close_at
     FROM outline_submission_period
     WHERE CURRENT_TIMESTAMP >= open_at AND CURRENT_TIMESTAMP <= close_at
     LIMIT 1`
  );
  if (!rows.length) return null;
  const r = rows[0];
  return {
    id: r.id,
    tahunAkademik: r.tahun_akademik,
    periodeAkademik: r.periode_akademik,
    openAt: r.open_at,
    closeAt: r.close_at,
  };
}

module.exports = { getOpenPeriod };
