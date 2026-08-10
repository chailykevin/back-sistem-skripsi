const dosenService = require("../services/dosen.service");

exports.list = async (req, res, next) => {
  try {
    const data = await dosenService.listDosen();

    return res.json({ ok: true, data });
  } catch (err) {
    next(err);
  }
};
