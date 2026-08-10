const authService = require("../services/auth.service");

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

exports.forgotPassword = async (req, res, next) => {
  try {
    const { username } = req.body;

    if (!username) {
      return res
        .status(400)
        .json({ ok: false, message: "Username is required" });
    }

    const data = await authService.forgotPassword(username);

    return res.json({
      ok: true,
      data,
    });
  } catch (err) {
    next(err);
  }
};

exports.resetPassword = async (req, res, next) => {
  try {
    const { token, newPassword } = req.body;

    if (!token || !newPassword) {
      return res
        .status(400)
        .json({ ok: false, message: "Token and newPassword are required" });
    }
    if (String(newPassword).length < 6) {
      return res.status(400).json({
        ok: false,
        message: "Kata sandi baru minimal 6 karakter.",
      });
    }

    const data = await authService.resetPassword(token, newPassword);

    return res.json({
      ok: true,
      data,
    });
  } catch (err) {
    next(err);
  }
};

exports.verifyEmail = async (req, res, next) => {
  try {
    const { token } = req.body;
    if (!token) {
      return res.status(400).json({ ok: false, message: "Token is required" });
    }

    const data = await authService.verifyEmail(token);

    return res.json({
      ok: true,
      data,
    });
  } catch (err) {
    next(err);
  }
};
