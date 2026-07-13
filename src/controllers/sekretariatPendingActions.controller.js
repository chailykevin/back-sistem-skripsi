const db = require("../db");

exports.getPendingActions = async (req, res, next) => {
  try {
    if (!req.user.hasRole("SEKRETARIAT")) {
      return res
        .status(403)
        .json({ ok: false, message: "Only sekretariat can access this endpoint" });
    }

    const [[skPenelitianRows], [sidangRows], [disposisiSidangRows]] = await Promise.all([
      db.query(
        `SELECT COUNT(*) AS c
         FROM pengajuan_sk_penelitian
         WHERE status = 'SUBMITTED'`,
      ),
      db.query(
        `SELECT COUNT(*) AS c
         FROM pengajuan_sidang
         WHERE status = 'SUBMITTED'`,
      ),
      db.query(
        `SELECT COUNT(*) AS c
         FROM pengajuan_sidang
         WHERE status = 'WAITING_FOR_SURAT'`,
      ),
    ]);

    const skPenelitian = Number(skPenelitianRows[0]?.c ?? 0);
    const sidang = Number(sidangRows[0]?.c ?? 0);
    const disposisiSidang = Number(disposisiSidangRows[0]?.c ?? 0);

    return res.json({
      ok: true,
      data: {
        skPenelitian,
        sidang,
        disposisiSidang,
        total: skPenelitian + sidang + disposisiSidang,
      },
    });
  } catch (err) {
    next(err);
  }
};
