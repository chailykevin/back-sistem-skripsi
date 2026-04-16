const db = require("../db");

function mapRoleCodes(raw) {
  if (!raw) return [];
  return String(raw)
    .split(",")
    .map((v) => v.trim())
    .filter(Boolean);
}

exports.listMahasiswa = async (req, res, next) => {
  try {
    const [rows] = await db.query(
      `SELECT
         u.id,
         u.username,
         u.is_active,
         u.npm,
         m.nama AS mahasiswa_nama,
         m.program_studi_id,
         ps.nama AS program_studi_nama,
         GROUP_CONCAT(DISTINCT r.code ORDER BY r.code SEPARATOR ',') AS role_codes
       FROM users u
       INNER JOIN mahasiswa m ON m.npm = u.npm
       LEFT JOIN program_studi ps ON ps.id = m.program_studi_id
       LEFT JOIN user_roles ur ON ur.user_id = u.id AND ur.is_active = 1
       LEFT JOIN roles r ON r.id = ur.role_id AND r.is_active = 1
       WHERE u.is_active = 1
       GROUP BY
         u.id,
         u.username,
         u.is_active,
         u.npm,
         m.nama,
         m.program_studi_id,
         ps.nama
       ORDER BY m.nama ASC`
    );

    const data = rows.map((row) => ({
      id: row.id,
      username: row.username,
      isActive: Boolean(row.is_active),
      npm: row.npm,
      nama: row.mahasiswa_nama,
      programStudiId: row.program_studi_id,
      programStudiNama: row.program_studi_nama,
      roles: mapRoleCodes(row.role_codes),
    }));

    return res.json({ ok: true, data });
  } catch (err) {
    next(err);
  }
};

exports.listDosen = async (req, res, next) => {
  try {
    const [rows] = await db.query(
      `SELECT
         u.id,
         u.username,
         u.is_active,
         u.nidn,
         d.nama AS dosen_nama,
         GROUP_CONCAT(DISTINCT r.code ORDER BY r.code SEPARATOR ',') AS role_codes
       FROM users u
       INNER JOIN dosen d ON d.nidn = u.nidn
       LEFT JOIN user_roles ur ON ur.user_id = u.id AND ur.is_active = 1
       LEFT JOIN roles r ON r.id = ur.role_id AND r.is_active = 1
       WHERE u.is_active = 1
       GROUP BY
         u.id,
         u.username,
         u.is_active,
         u.nidn,
         d.nama
       ORDER BY d.nama ASC`
    );

    const data = rows.map((row) => ({
      id: row.id,
      username: row.username,
      isActive: Boolean(row.is_active),
      nidn: row.nidn,
      nama: row.dosen_nama,
      roles: mapRoleCodes(row.role_codes),
    }));

    return res.json({ ok: true, data });
  } catch (err) {
    next(err);
  }
};
