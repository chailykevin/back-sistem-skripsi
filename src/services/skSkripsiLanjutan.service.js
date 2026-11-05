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

// The end of the Seminar phase (Pembimbing 1 approves the Seminar revisi, JUDUL_DITERIMA): the SK
// Skripsi request goes to Kaprodi, the Seminar's new title becomes the skripsi title, and Bab 4
// opens right away; the SK Skripsi is processed in parallel and only gates Pengajuan Sidang Skripsi.
// Call it after anything that must still print the original title (the Halaman Pengesahan Seminar).
async function finishSeminarPhase(conn, { skripsiId, seminarSidangId }) {
  await createSkSkripsiLanjutanRequest(conn, { skripsiId, seminarSidangId });

  const [[row]] = await conn.query(
    `SELECT s.npm, s.judul, s.pembimbing2_nidn, sd.judul_baru,
            k.id AS kartu_id, u.id AS student_user_id
     FROM skripsi s
     JOIN sidang sd ON sd.id = ?
     LEFT JOIN kartu_konsultasi_skripsi k ON k.skripsi_id = s.id
     LEFT JOIN users u ON u.npm = s.npm AND u.is_active = 1
     WHERE s.id = ? LIMIT 1`,
    [seminarSidangId, skripsiId],
  );

  if (row.judul_baru && row.judul_baru !== row.judul) {
    await conn.query(
      `UPDATE skripsi SET judul = ?, updated_at = NOW() WHERE id = ?`,
      [row.judul_baru, skripsiId],
    );
  }

  // Open Bab 4: the review flow creates each next stage, but Bab 3 ended the Seminar phase.
  if (row.kartu_id) {
    await conn.query(
      `INSERT INTO konsultasi_skripsi_stage (
         kartu_konsultasi_skripsi_id, chapter_group, stage,
         pembimbing_nidn, current_status, current_submission_no, started_at
       )
       SELECT ?, 'BAB_4', 'PEMBIMBING_2', ?, 'WAITING_SUBMISSION', 0, CURRENT_TIMESTAMP
       FROM DUAL
       WHERE NOT EXISTS (
         SELECT 1 FROM konsultasi_skripsi_stage
         WHERE kartu_konsultasi_skripsi_id = ? AND chapter_group = 'BAB_4' AND stage = 'PEMBIMBING_2'
       )`,
      [row.kartu_id, row.pembimbing2_nidn, row.kartu_id],
    );
  }

  if (row.student_user_id) {
    await insertNotification(
      conn,
      row.student_user_id,
      "KONSULTASI_BAB_4_DIBUKA",
      "Revisi seminar proposal selesai. Konsultasi Bab 4 sudah dibuka; SK Skripsi Anda sedang diproses oleh Kaprodi dan Sekretariat.",
      "/student/skripsi-consultations",
    );
  }
}

module.exports = { finishSeminarPhase };
