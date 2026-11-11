const db = require("../db");

async function getOpenPeriod(queryable = db) {
  const [rows] = await queryable.query(
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

// The first SK Penulisan submission (manual or automatic) needs an open period. A restart after
// GAGAL / JUDUL_DITOLAK gets no extra rule: sidang is held at the end of a semester, and only
// students with Skripsi/Seminar in the current KRS have an active account (SIMIKO sync).
// Returns { period } or { period: null, message }.
async function getSkSubmissionPeriod(queryable) {
  const period = await getOpenPeriod(queryable);
  if (!period) {
    return {
      period: null,
      message: "Periode pengajuan SK Penulisan sedang ditutup atau belum dikonfigurasi.",
    };
  }
  return { period, message: null };
}

module.exports = { getOpenPeriod, getSkSubmissionPeriod };
