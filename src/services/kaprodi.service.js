const db = require("../db");
const { getKaprodiProgramStudiIds } = require("../utils/identity");

async function getPendingActionsByRole(staffUsrId) {
  const programStudiIds = await getKaprodiProgramStudiIds(staffUsrId);

  if (programStudiIds.length === 0) {
    return {
      outline: 0,
      disposisi: 0,
      sidang: 0,
      disposisiSidang: 0,
      skSkripsiLanjutan: 0,
      total: 0,
      oldestDays: {
        outline: null,
        disposisi: null,
        sidang: null,
        disposisiSidang: null,
        skSkripsiLanjutan: null,
      },
    };
  }

  const placeholders = programStudiIds.map(() => "?").join(",");

  const [
    [outlineRows],
    [disposisiRows],
    [sidangRows],
    [disposisiSidangRows],
    [skSkripsiLanjutanRows],
  ] = await Promise.all([
    db.query(
      `SELECT COUNT(*) AS c, TIMESTAMPDIFF(DAY, MIN(o.updated_at), NOW()) AS oldest
         FROM outline o
         JOIN mahasiswa m ON m.npm = o.npm
         WHERE m.program_studi_id IN (${placeholders}) AND o.status = 'SUBMITTED'`,
      programStudiIds,
    ),
    db.query(
      `SELECT COUNT(*) AS c, TIMESTAMPDIFF(DAY, MIN(pj.updated_at), NOW()) AS oldest
         FROM pengajuan_disposisi_pembimbing pj
         JOIN mahasiswa m ON m.npm = pj.npm
         JOIN program_studi ps ON ps.id = m.program_studi_id
         WHERE ps.id IN (${placeholders}) AND pj.status = 'SUBMITTED'`,
      programStudiIds,
    ),
    db.query(
      `SELECT COUNT(*) AS c, TIMESTAMPDIFF(DAY, MIN(psk.updated_at), NOW()) AS oldest
         FROM pengajuan_sidang_kaprodi psk
         JOIN pengajuan_sidang ON pengajuan_sidang.id = psk.pengajuan_sidang_id
         JOIN skripsi s ON s.id = pengajuan_sidang.skripsi_id
         JOIN program_studi ps ON ps.id = s.program_studi_id
         WHERE ps.id IN (${placeholders}) AND psk.status = 'SUBMITTED'`,
      programStudiIds,
    ),
    db.query(
      `SELECT COUNT(*) AS c, TIMESTAMPDIFF(DAY, MIN(ps2.updated_at), NOW()) AS oldest
         FROM pengajuan_sidang ps2
         JOIN skripsi s ON s.id = ps2.skripsi_id
         JOIN program_studi ps ON ps.id = s.program_studi_id
         WHERE ps.id IN (${placeholders}) AND ps2.status = 'WAITING_FOR_DISPOSISI'`,
      programStudiIds,
    ),
    // Seminar Bisnis Digital bridge: completed Seminar revisi waiting for Kaprodi to forward.
    db.query(
      `SELECT COUNT(*) AS c, TIMESTAMPDIFF(DAY, MIN(l.created_at), NOW()) AS oldest
         FROM pengajuan_sk_skripsi_lanjutan l
         JOIN skripsi s ON s.id = l.skripsi_id
         WHERE s.program_studi_id IN (${placeholders}) AND l.status = 'WAITING_KAPRODI'`,
      programStudiIds,
    ),
  ]);

  const outline = Number(outlineRows[0]?.c ?? 0);
  const disposisi = Number(disposisiRows[0]?.c ?? 0);
  const sidang = Number(sidangRows[0]?.c ?? 0);
  const disposisiSidang = Number(disposisiSidangRows[0]?.c ?? 0);
  const skSkripsiLanjutan = Number(skSkripsiLanjutanRows[0]?.c ?? 0);
  const oldest = (rows) => (rows[0]?.oldest == null ? null : Number(rows[0].oldest));

  return {
    outline,
    disposisi,
    sidang,
    disposisiSidang,
    skSkripsiLanjutan,
    total: outline + disposisi + sidang + disposisiSidang + skSkripsiLanjutan,
    oldestDays: {
      outline: oldest(outlineRows),
      disposisi: oldest(disposisiRows),
      sidang: oldest(sidangRows),
      disposisiSidang: oldest(disposisiSidangRows),
      skSkripsiLanjutan: oldest(skSkripsiLanjutanRows),
    },
  };
}

module.exports = { getPendingActionsByRole };
