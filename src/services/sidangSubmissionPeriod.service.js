const db = require("../db");
const { requireJenis } = require("./sidangScope.service");

// Skripsi and Seminar Bisnis Digital each have their own windows; at most one per jenis is open.
async function getOpenPeriod(jenis) {
  const [rows] = await db.query(
    `SELECT id, tahun_akademik, periode_akademik, open_at, close_at
     FROM sidang_submission_period
     WHERE jenis = ? AND CURRENT_TIMESTAMP >= open_at AND CURRENT_TIMESTAMP <= close_at
     LIMIT 1`,
    [requireJenis(jenis)],
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
