const db = require("../db");
const kaprodiService = require("../services/kaprodi.service");
const { getStaffUsrId } = require("../utils/identity");

exports.getPendingActions = async (req, res, next) => {
  try {
    if (!req.user.hasRole("KAPRODI")) {
      return res
        .status(403)
        .json({ ok: false, message: "Only kaprodi can access this endpoint" });
    }

    const staffUsrId = await getStaffUsrId(req.user.id);
    if (!staffUsrId) {
      return res
        .status(400)
        .json({ ok: false, message: "Data dosen tidak valid" });
    }

    const data = await kaprodiService.getPendingActionsByRole(staffUsrId);

    return res.json({
      ok: true,
      data,
    });
  } catch (err) {
    next(err);
  }
};
