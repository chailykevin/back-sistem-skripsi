const MIME_DOCX =
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document";

async function upsertSystemFile(conn, pengajuanSidangId, fileType, row) {
  await conn.query(
    `DELETE FROM pengajuan_sidang_files WHERE pengajuan_sidang_id = ? AND file_type = ?`,
    [pengajuanSidangId, fileType],
  );
  await conn.query(
    `INSERT INTO pengajuan_sidang_files
       (pengajuan_sidang_id, file_type, file_name, mime_type, file_content, source, status)
     VALUES (?, ?, ?, ?, ?, 'SYSTEM', 'VERIFIED')`,
    [pengajuanSidangId, fileType, row.file_name, row.mime_type, row.file_content],
  );
}

// Non-fatal: each file is skipped silently if its source doesn't exist yet.
async function attachSidangSystemFiles(conn, pengajuanSidangId, skripsiId) {
  const [[kartuSkripsi]] = await conn.query(
    `SELECT file_content, file_name, mime_type FROM kartu_konsultasi_skripsi WHERE skripsi_id = ? LIMIT 1`,
    [skripsiId],
  );
  if (kartuSkripsi?.file_content) {
    await upsertSystemFile(conn, pengajuanSidangId, "KARTU_KONSULTASI_SKRIPSI", {
      ...kartuSkripsi,
      mime_type: kartuSkripsi.mime_type ?? MIME_DOCX,
    });
  }

  const skFileQuery = `SELECT f.file_content, f.file_name, f.mime_type
     FROM pengajuan_sk_penelitian_files f
     INNER JOIN pengajuan_sk_penelitian psk ON psk.id = f.pengajuan_sk_penelitian_id
     WHERE psk.outline_id = (SELECT outline_id FROM skripsi WHERE id = ? LIMIT 1)
       AND f.file_type = ?
     ORDER BY f.created_at DESC LIMIT 1`;

  const [[skPembimbingRow]] = await conn.query(skFileQuery, [
    skripsiId,
    "SK_PENUNJUKAN_PEMBIMBING",
  ]);
  if (skPembimbingRow) {
    await upsertSystemFile(conn, pengajuanSidangId, "SK_PENUNJUKAN_PEMBIMBING", {
      ...skPembimbingRow,
      mime_type: skPembimbingRow.mime_type ?? null,
    });
  }

  const [[suratPenyelesaianRow]] = await conn.query(skFileQuery, [
    skripsiId,
    "SURAT_PENYELESAIAN_SKRIPSI",
  ]);
  if (suratPenyelesaianRow) {
    await upsertSystemFile(
      conn,
      pengajuanSidangId,
      "SURAT_PERNYATAAN_PENYELESAIAN",
      { ...suratPenyelesaianRow, mime_type: suratPenyelesaianRow.mime_type ?? null },
    );
  }
}

module.exports = { attachSidangSystemFiles };
