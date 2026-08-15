const db = require("../db");
const kaprodiService = require("../services/kaprodi.service");

async function getLecturerNidn(userId) {
  const [rows] = await db.query(
    `SELECT nidn FROM users WHERE id = ? AND is_active = 1 LIMIT 1`,
    [userId],
  );
  return rows[0]?.nidn ?? null;
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

    const data = await kaprodiService.getPendingActionsByRole(nidn);

    return res.json({
      ok: true,
      data,
    });
  } catch (err) {
    next(err);
  }
};
