const passwordResetService = require("../services/passwordReset.service");
const authService = require("../services/auth.service");

exports.changeMyPassword = async (req, res, next) => {
  try {
    const { currentPassword, newPassword, confirmPassword } = req.body;

    await passwordResetService.changePassword(
      Number(req.user.id),
      currentPassword,
      newPassword,
      confirmPassword,
      req.ip,
    );

    // Every other session is now logged out; this device keeps working with a fresh token.
    const token = await authService.issueTokenAfterPasswordChange(Number(req.user.id));

    return res.json({
      ok: true,
      data: { message: "Kata sandi berhasil diubah.", token },
    });
  } catch (err) {
    next(err);
  }
};
