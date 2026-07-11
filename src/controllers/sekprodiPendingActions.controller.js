const db = require("../db");

exports.getPendingActions = async (req, res, next) => {
  try {
    if (!req.user.hasRole("SEKPRODI")) {
      return res
        .status(403)
        .json({ ok: false, message: "Only sekprodi can access this endpoint" });
    }

    const [[userRow]] = await db.query(
      `SELECT nidn FROM users WHERE id = ? AND is_active = 1 LIMIT 1`,
      [req.user.id],
    );
    const nidn = userRow?.nidn ?? null;
    if (!nidn) {
      return res
        .status(400)
        .json({ ok: false, message: "Data dosen tidak valid" });
    }

    const [rows] = await db.query(
      `SELECT COUNT(*) AS c
       FROM pengumpulan_berkas_final pbf
       JOIN skripsi sk ON sk.id = pbf.skripsi_id
       JOIN program_studi ps ON ps.id = sk.program_studi_id
       WHERE ps.sekprodi_nidn = ? AND pbf.status = 'WAITING_SIGNATURE'`,
      [nidn],
    );

    const pengumpulanBerkasFinal = Number(rows[0]?.c ?? 0);

    return res.json({
      ok: true,
      data: {
        pengumpulanBerkasFinal,
        total: pengumpulanBerkasFinal,
      },
    });
  } catch (err) {
    next(err);
  }
};
