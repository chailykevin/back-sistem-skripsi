const db = require("../db");

module.exports = async (req, res, next) => {
  try {
    const userId = Number(req.user?.id);
    if (!Number.isFinite(userId) || userId <= 0) {
      return res.status(401).json({ ok: false, message: "Unauthorized" });
    }

    const [rows] = await db.query(
      `
      SELECT m.program_studi_id
      FROM users u
      INNER JOIN mahasiswa m ON m.npm = u.npm
      WHERE u.id = ? AND u.is_active = 1
      LIMIT 1
      `,
      [userId]
    );

    const programStudiId = rows[0]?.program_studi_id ?? null;
    if (!programStudiId) {
      return res.status(400).json({
        ok: false,
        message: "Program studi tidak valid",
      });
    }

    req.user.programStudiId = programStudiId;
    next();
  } catch (err) {
    next(err);
  }
};
