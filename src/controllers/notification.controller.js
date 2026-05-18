const db = require("../db");

exports.list = async (req, res, next) => {
  try {
    const [rows] = await db.query(
      `SELECT id, type, message, link, is_read, created_at
       FROM notifications
       WHERE user_id = ?
       ORDER BY created_at DESC
       LIMIT 50`,
      [req.user.id]
    );
    res.json({ ok: true, data: rows });
  } catch (err) {
    next(err);
  }
};

exports.markRead = async (req, res, next) => {
  try {
    const [result] = await db.query(
      `UPDATE notifications SET is_read = 1 WHERE id = ? AND user_id = ?`,
      [req.params.id, req.user.id]
    );
    if (result.affectedRows === 0) {
      return res.status(404).json({ ok: false, message: "Notifikasi tidak ditemukan" });
    }
    res.json({ ok: true, data: {} });
  } catch (err) {
    next(err);
  }
};
