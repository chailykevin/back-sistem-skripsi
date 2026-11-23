const { getStudentDashboard } = require("../services/studentDashboard.service");

exports.getDashboard = async (req, res, next) => {
  try {
    if (!req.user.hasRole("STUDENT")) {
      return res.status(403).json({ ok: false, message: "Hanya mahasiswa yang dapat melihat dashboard mahasiswa" });
    }
    const data = await getStudentDashboard(req.user.id);
    if (!data) {
      return res.status(400).json({ ok: false, message: "Mahasiswa tidak valid" });
    }
    return res.json({ ok: true, data });
  } catch (err) {
    next(err);
  }
};
