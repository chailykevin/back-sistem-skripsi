const { insertNotification } = require("../utils/notify");

// Seminar Bisnis Digital → Skripsi bridge: when the Seminar revisi completes (JUDUL_DITERIMA), a
// request goes to Kaprodi automatically. The SK Skripsi will carry the new title if the Seminar
// sidang set one ("Judul perlu diubah"), otherwise the current title. Existence-guarded.
async function createSkSkripsiLanjutanRequest(conn, { skripsiId, seminarSidangId }) {
  const [[existing]] = await conn.query(
    `SELECT id FROM pengajuan_sk_skripsi_lanjutan WHERE skripsi_id = ? LIMIT 1`,
    [skripsiId],
  );
  if (existing) return existing.id;

  const [[row]] = await conn.query(
    `SELECT s.judul, s.program_studi_id, sd.judul_baru, m.nama AS nama_mahasiswa
     FROM skripsi s
     JOIN sidang sd ON sd.id = ?
     JOIN mahasiswa m ON m.npm = s.npm
     WHERE s.id = ? LIMIT 1`,
    [seminarSidangId, skripsiId],
  );
  const [ins] = await conn.query(
    `INSERT INTO pengajuan_sk_skripsi_lanjutan
       (skripsi_id, seminar_sidang_id, status, judul_seminar, judul_skripsi)
     VALUES (?, ?, 'WAITING_KAPRODI', ?, ?)`,
    [skripsiId, seminarSidangId, row.judul, row.judul_baru ?? row.judul],
  );

  const [kaprodiUsers] = await conn.query(
    `SELECT u.id FROM users u
     JOIN user_roles ur ON ur.user_id = u.id AND ur.is_active = 1
     JOIN roles r ON r.id = ur.role_id
     JOIN program_studi ps ON ps.kaprodi_staff_usr_id = u.staff_usr_id
     WHERE r.code = 'KAPRODI' AND ps.id = ? AND u.is_active = 1`,
    [row.program_studi_id],
  );
  for (const ku of kaprodiUsers) {
    await insertNotification(
      conn,
      ku.id,
      "SK_SKRIPSI_LANJUTAN_WAITING_KAPRODI",
      `Revisi seminar proposal ${row.nama_mahasiswa} telah selesai. Teruskan ke Sekretariat untuk penerbitan SK Skripsi.`,
      `/kaprodi/sk-skripsi-lanjutan/${skripsiId}`,
    );
  }
  return ins.insertId;
}

module.exports = { createSkSkripsiLanjutanRequest };
