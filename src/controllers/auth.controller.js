const authService = require("../services/auth.service");
const passwordResetService = require("../services/passwordReset.service");

exports.login = async (req, res, next) => {
  try {
    const { username, password } = req.body;

    if (!username || !password) {
      return res.status(400).json({
        ok: false,
        message: "Username and password are required",
      });
    }

    const data = await authService.login(username, password);

    return res.json({
      ok: true,
      data,
    });
  } catch (err) {
    next(err);
  }
};

exports.me = async (req, res, next) => {
  try {
    const userId = Number(req.user.id);

    const data = await authService.getUserInformation(userId);

    res.json({
      ok: true,
      data,
    });
  } catch (err) {
    next(err);
  }
};

exports.requestPasswordResetOtp = async (req, res, next) => {
  try {
    const { username } = req.body;
    if (typeof username !== "string" || !username.trim()) {
      return res.status(400).json({ ok: false, message: "Username wajib diisi." });
    }
    const data = await passwordResetService.requestOtp(username, req.ip);
    return res.json({ ok: true, data });
  } catch (err) {
    next(err);
  }
};

exports.verifyPasswordResetOtp = async (req, res, next) => {
  try {
    const { username, otp } = req.body;
    if (typeof username !== "string" || !username.trim()) {
      return res.status(400).json({ ok: false, message: "Username wajib diisi." });
    }
    const data = await passwordResetService.verifyOtp(username, otp);
    return res.json({ ok: true, data });
  } catch (err) {
    next(err);
  }
};

exports.resetPassword = async (req, res, next) => {
  try {
    const { resetToken, newPassword, confirmPassword } = req.body;
    const data = await passwordResetService.resetPassword(
      resetToken,
      newPassword,
      confirmPassword,
      req.ip,
    );
    return res.json({ ok: true, data });
  } catch (err) {
    next(err);
  }
};
