const bcrypt = require("bcrypt");
const db = require("../db");

exports.changeMyPassword = async (req, res, next) => {
  try {
    const { currentPassword, newPassword } = req.body;

    if (!currentPassword || !newPassword) {
      return res.status(400).json({
        ok: false,
        message: "currentPassword and newPassword are required",
      });
    }
    if (String(newPassword).length < 6) {
      return res.status(400).json({
        ok: false,
        message: "Kata sandi baru minimal 6 karakter.",
      });
    }

    const [rows] = await db.query(
      `SELECT password_hash FROM users WHERE id = ? AND is_active = 1 LIMIT 1`,
      [req.user.id],
    );
    const user = rows[0];
    if (!user) {
      return res.status(401).json({ ok: false, message: "Unauthorized" });
    }

    const isMatch = await bcrypt.compare(currentPassword, user.password_hash);
    if (!isMatch) {
      return res.status(400).json({
        ok: false,
        message: "Kata sandi saat ini salah.",
      });
    }

    const passwordHash = await bcrypt.hash(newPassword, 10);
    await db.query(`UPDATE users SET password_hash = ? WHERE id = ?`, [
      passwordHash,
      req.user.id,
    ]);

    return res.json({
      ok: true,
      data: { message: "Kata sandi berhasil diubah." },
    });
  } catch (err) {
    next(err);
  }
};
