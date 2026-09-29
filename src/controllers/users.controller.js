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
         m.sks AS mahasiswa_sks,
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
      sks: row.mahasiswa_sks,
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
         d.nidn,
         d.nama AS dosen_nama,
         MAX(CASE WHEN u.nidn IS NOT NULL THEN u.is_active ELSE 0 END) AS is_active,
         GROUP_CONCAT(DISTINCT r.code ORDER BY r.code SEPARATOR ',') AS role_codes
       FROM dosen d
       LEFT JOIN users u ON u.nidn = d.nidn
       LEFT JOIN user_roles ur ON ur.user_id = u.id AND ur.is_active = 1
       LEFT JOIN roles r ON r.id = ur.role_id AND r.is_active = 1 AND u.is_active = 1
       GROUP BY
         d.nidn,
         d.nama
       ORDER BY d.nama ASC`
    );

    const data = rows.map((row) => ({
      nidn: row.nidn,
      nama: row.dosen_nama,
      isActive: Boolean(row.is_active),
      roles: mapRoleCodes(row.role_codes),
    }));

    return res.json({ ok: true, data });
  } catch (err) {
    next(err);
  }
};

exports.listStaf = async (req, res, next) => {
  try {
    const [rows] = await db.query(
      `SELECT
         u.id,
         u.username,
         u.is_active,
         s.usr_id,
         s.nama AS staf_nama,
         GROUP_CONCAT(DISTINCT r.code ORDER BY r.code SEPARATOR ',') AS role_codes,
         GROUP_CONCAT(DISTINCT ps.nama ORDER BY ps.nama SEPARATOR ',') AS program_studi_nama,
         GROUP_CONCAT(DISTINCT f.nama ORDER BY f.nama SEPARATOR ',') AS fakultas_nama
       FROM staf s
       INNER JOIN users u ON u.staff_usr_id = s.usr_id
       INNER JOIN user_roles ur ON ur.user_id = u.id AND ur.is_active = 1
       INNER JOIN roles r ON r.id = ur.role_id AND r.is_active = 1
       LEFT JOIN program_studi ps ON ps.id = ur.program_studi_id
       LEFT JOIN fakultas f ON f.dekan_staff_usr_id = s.usr_id
       WHERE r.code IN ('KAPRODI', 'SEKPRODI', 'DEKAN', 'LPPM', 'PERPUSTAKAAN_STAFF', 'SEKRETARIAT')
       GROUP BY u.id, u.username, u.is_active, s.usr_id, s.nama
       ORDER BY s.nama ASC`,
    );

    const data = rows.map((row) => ({
      id: row.id,
      usrId: row.usr_id,
      username: row.username,
      nama: row.staf_nama,
      isActive: Boolean(row.is_active),
      roles: mapRoleCodes(row.role_codes),
      programStudiNama: row.program_studi_nama ?? null,
      fakultasNama: row.fakultas_nama ?? null,
    }));

    return res.json({ ok: true, data });
  } catch (err) {
    next(err);
  }
};
