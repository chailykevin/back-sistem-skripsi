const { getOpenPeriod } = require("../services/sidangSubmissionPeriod.service");

module.exports = async (req, res, next) => {
  try {
    const period = await getOpenPeriod();
    if (!period) {
      return res.status(409).json({
        ok: false,
        message: "Tidak ada periode pengajuan sidang yang sedang dibuka.",
      });
    }
    req.openSidangPeriod = period;
    return next();
  } catch (err) {
    if (err?.code === "ER_NO_SUCH_TABLE") {
      return res.status(500).json({
        ok: false,
        message: "sidang_submission_period table does not exist. Run SQL migration first.",
      });
    }
    return next(err);
  }
};
