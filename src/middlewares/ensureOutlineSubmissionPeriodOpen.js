const { getOutlineSubmissionPeriodStatus } = require("../services/outlineSubmissionPeriod.service");

module.exports = async (req, res, next) => {
  try {
    const status = await getOutlineSubmissionPeriodStatus();

    if (!status.configured) {
      return res.status(409).json({
        ok: false,
        message: "Outline submission period is not configured",
      });
    }

    if (!status.isOpenNow) {
      return res.status(409).json({
        ok: false,
        message: "Outline submission period is closed",
        data: {
          openAt: status.openAt,
          closeAt: status.closeAt,
        },
      });
    }

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
