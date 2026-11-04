const db = require("../db");

exports.getPendingActions = async (req, res, next) => {
  try {
    if (!req.user.hasRole("SEKRETARIAT")) {
      return res
        .status(403)
        .json({ ok: false, message: "Only sekretariat can access this endpoint" });
    }

    const [
      [skPenelitianRows],
      [sidangRows],
      [disposisiSidangRows],
      [skSkripsiLanjutanRows],
    ] = await Promise.all([
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
      // Seminar Bisnis Digital bridge: SK Skripsi forwarded by Kaprodi, waiting to be issued.
      db.query(
        `SELECT COUNT(*) AS c
         FROM pengajuan_sk_skripsi_lanjutan
         WHERE status = 'WAITING_SEKRETARIAT'`,
      ),
    ]);

    const skPenelitian = Number(skPenelitianRows[0]?.c ?? 0);
    const sidang = Number(sidangRows[0]?.c ?? 0);
    const disposisiSidang = Number(disposisiSidangRows[0]?.c ?? 0);
    const skSkripsiLanjutan = Number(skSkripsiLanjutanRows[0]?.c ?? 0);

    return res.json({
      ok: true,
      data: {
        skPenelitian,
        sidang,
        disposisiSidang,
        skSkripsiLanjutan,
        total: skPenelitian + sidang + disposisiSidang + skSkripsiLanjutan,
      },
    });
  } catch (err) {
    next(err);
  }
};
