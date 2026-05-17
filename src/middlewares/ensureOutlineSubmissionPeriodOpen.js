const { getOpenPeriod } = require("../services/outlineSubmissionPeriod.service");

module.exports = async (req, res, next) => {
  try {
    const period = await getOpenPeriod();
    if (!period) {
      return res.status(409).json({
        ok: false,
        message: "Outline submission period is closed or not configured",
      });
    }
    req.openPeriod = period;
    return next();
  } catch (err) {
    if (err?.code === "ER_NO_SUCH_TABLE") {
      return res.status(500).json({
        ok: false,
        message: "outline_submission_period table does not exist. Run SQL migration first.",
      });
    }
    return next(err);
  }
};
