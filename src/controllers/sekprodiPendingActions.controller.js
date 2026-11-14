const db = require("../db");
const { getStaffUsrId, getSekprodiProgramStudiIds } = require("../utils/identity");

exports.getPendingActions = async (req, res, next) => {
  try {
    if (!req.user.hasRole("SEKPRODI")) {
      return res
        .status(403)
        .json({ ok: false, message: "Only sekprodi can access this endpoint" });
    }

    const staffUsrId = await getStaffUsrId(req.user.id);
    const programStudiIds = await getSekprodiProgramStudiIds(staffUsrId);

    let pengumpulanBerkasFinal = 0;
    if (programStudiIds.length > 0) {
      const [rows] = await db.query(
        `SELECT COUNT(*) AS c
         FROM pengumpulan_berkas_final pbf
         JOIN skripsi sk ON sk.id = pbf.skripsi_id
         WHERE sk.program_studi_id IN (?) AND pbf.status = 'WAITING_SIGNATURE'`,
        [programStudiIds],
      );
      pengumpulanBerkasFinal = Number(rows[0]?.c ?? 0);
    }

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
