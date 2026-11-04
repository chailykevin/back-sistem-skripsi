const { BULAN_ROMAWI } = require("../utils/dates");
const { JENIS, requireJenis } = require("./sidangScope.service");

const KODE_SURAT_BY_JENIS = {
  [JENIS.SKRIPSI]: "Skep-Skripsi",
  [JENIS.SEMINAR_BISNIS_DIGITAL]: "Skep-BD701",
};

// Next SK Penunjukan Pembimbing number for a prodi this month:
// `{seq:03}/{fakultas.kode}/{program_studi.kode}/{Skep-Skripsi|Skep-BD701}/{bulan_romawi}/{tahun}`.
// Skep-Skripsi counts regular Skripsi SKs and the SK Skripsi issued through the Seminar bridge, so both
// share one sequence; Skep-BD701 counts Seminar SKs only. Locking the prodi row serializes concurrent
// issuers, and the counts are locking reads (FOR SHARE) so they see numbers committed while we waited —
// a plain read would use the transaction's older snapshot and hand out a duplicate number.
async function nextNomorSk(conn, { programStudiId, jenisSk, fakultasKode, prodiKode, date = new Date() }) {
  requireJenis(jenisSk);
  const year = date.getFullYear();
  const month = date.getMonth() + 1;

  await conn.query(`SELECT id FROM program_studi WHERE id = ? FOR UPDATE`, [
    programStudiId,
  ]);
  const [[{ seq }]] = await conn.query(
    `SELECT COUNT(*) AS seq
     FROM pengajuan_sk_penelitian psk
     JOIN outline o ON o.id = psk.outline_id
     WHERE o.program_studi_id = ?
       AND psk.jenis_sk = ?
       AND psk.nomor_surat IS NOT NULL
       AND YEAR(psk.completed_at) = ?
       AND MONTH(psk.completed_at) = ?
     FOR SHARE`,
    [programStudiId, jenisSk, year, month],
  );
  let total = Number(seq);
  if (jenisSk === JENIS.SKRIPSI) {
    const [[{ seqLanjutan }]] = await conn.query(
      `SELECT COUNT(*) AS seqLanjutan
       FROM pengajuan_sk_skripsi_lanjutan l
       JOIN skripsi s ON s.id = l.skripsi_id
       WHERE s.program_studi_id = ?
         AND l.nomor_surat IS NOT NULL
         AND YEAR(l.completed_at) = ?
         AND MONTH(l.completed_at) = ?
       FOR SHARE`,
      [programStudiId, year, month],
    );
    total += Number(seqLanjutan);
  }

  return `${String(total + 1).padStart(3, "0")}/${fakultasKode}/${prodiKode}/${KODE_SURAT_BY_JENIS[jenisSk]}/${BULAN_ROMAWI[month - 1]}/${year}`;
}

module.exports = { nextNomorSk };
