const db = require("../db");

async function getLecturerNidn(userId) {
  const [rows] = await db.query(
    `SELECT nidn FROM users WHERE id = ? AND is_active = 1 LIMIT 1`,
    [userId],
  );
  return rows[0]?.nidn ?? null;
}

async function getKaprodiProgramStudiIdsByNidn(nidn) {
  const [rows] = await db.query(
    `SELECT id FROM program_studi WHERE kaprodi_nidn = ?`,
    [nidn],
  );
  return rows
    .map((row) => Number(row.id))
    .filter((id) => Number.isFinite(id) && id > 0);
}

exports.getPendingActions = async (req, res, next) => {
  try {
    if (!req.user.hasRole("KAPRODI")) {
      return res
        .status(403)
        .json({ ok: false, message: "Only kaprodi can access this endpoint" });
    }

    const nidn = await getLecturerNidn(req.user.id);
    if (!nidn) {
      return res
        .status(400)
        .json({ ok: false, message: "Data dosen tidak valid" });
    }

    const programStudiIds = await getKaprodiProgramStudiIdsByNidn(nidn);
    if (programStudiIds.length === 0) {
      return res.json({
        ok: true,
        data: {
          outline: 0,
          disposisi: 0,
          sidang: 0,
          disposisiSidang: 0,
          total: 0,
        },
      });
    }

    const placeholders = programStudiIds.map(() => "?").join(",");

    const [[outlineRows], [disposisiRows], [sidangRows], [disposisiSidangRows]] =
      await Promise.all([
        db.query(
          `SELECT COUNT(*) AS c
           FROM outline o
           JOIN mahasiswa m ON m.npm = o.npm
           WHERE m.program_studi_id IN (${placeholders}) AND o.status = 'SUBMITTED'`,
          programStudiIds,
        ),
        db.query(
          `SELECT COUNT(*) AS c
           FROM pengajuan_disposisi_pembimbing pj
           JOIN mahasiswa m ON m.npm = pj.npm
           JOIN program_studi ps ON ps.id = m.program_studi_id
           WHERE ps.id IN (${placeholders}) AND pj.status = 'SUBMITTED'`,
          programStudiIds,
        ),
        db.query(
          `SELECT COUNT(*) AS c
           FROM pengajuan_sidang_kaprodi psk
           JOIN pengajuan_sidang ON pengajuan_sidang.id = psk.pengajuan_sidang_id
           JOIN skripsi s ON s.id = pengajuan_sidang.skripsi_id
           JOIN program_studi ps ON ps.id = s.program_studi_id
           WHERE ps.id IN (${placeholders}) AND psk.status = 'SUBMITTED'`,
          programStudiIds,
        ),
        db.query(
          `SELECT COUNT(*) AS c
           FROM pengajuan_sidang ps2
           JOIN skripsi s ON s.id = ps2.skripsi_id
           JOIN program_studi ps ON ps.id = s.program_studi_id
           WHERE ps.id IN (${placeholders}) AND ps2.status = 'WAITING_FOR_DISPOSISI'`,
          programStudiIds,
        ),
      ]);

    const outline = Number(outlineRows[0]?.c ?? 0);
    const disposisi = Number(disposisiRows[0]?.c ?? 0);
    const sidang = Number(sidangRows[0]?.c ?? 0);
    const disposisiSidang = Number(disposisiSidangRows[0]?.c ?? 0);

    return res.json({
      ok: true,
      data: {
        outline,
        disposisi,
        sidang,
        disposisiSidang,
        total: outline + disposisi + sidang + disposisiSidang,
      },
    });
  } catch (err) {
    next(err);
  }
};
