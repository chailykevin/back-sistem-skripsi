const db = require("../db");

async function resolveResetEmail(user) {
  if (user.npm) {
    const [rows] = await db.query(
      `SELECT email, email_verified_at, nama FROM mahasiswa WHERE npm = ? LIMIT 1`,
      [user.npm],
    );
    const mhs = rows[0];
    if (!mhs || !mhs.email || !mhs.email_verified_at) return null;
    return { email: mhs.email, nama: mhs.nama };
  }

  if (user.nidn) {
    const [rows] = await db.query(
      `SELECT email, nama FROM dosen WHERE nidn = ? LIMIT 1`,
      [user.nidn],
    );
    const dsn = rows[0];
    if (!dsn || !dsn.email) return null;
    return { email: dsn.email, nama: dsn.nama };
  }

  if (user.email) {
    return { email: user.email, nama: null };
  }

  return null;
}

module.exports = { resolveResetEmail };
