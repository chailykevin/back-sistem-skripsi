const db = require("../db");

module.exports = async (req, res, next) => {
  try {
    const userId = Number(req.user?.id);
    if (!Number.isFinite(userId) || userId <= 0) {
      return res.status(401).json({ ok: false, message: "Unauthorized" });
    }

    let rows;
    if (req.user.hasRole("STUDENT")) {
      [rows] = await db.query(
        `SELECT m.program_studi_id
           FROM users u
           INNER JOIN mahasiswa m ON m.npm = u.npm
          WHERE u.id = ? AND u.is_active = 1
          LIMIT 1`,
        [userId],
      );
    } else if (req.user.hasRole("KAPRODI")) {
      [rows] = await db.query(
        `SELECT ps.id AS program_studi_id
           FROM users u
           INNER JOIN program_studi ps
             ON COALESCE(ps.kaprodi_nidn, ps.kaprodi_staff_usr_id) =
                COALESCE(u.nidn, u.staff_usr_id)
          WHERE u.id = ? AND u.is_active = 1
          LIMIT 1`,
        [userId],
      );
    } else {
      return res.status(403).json({
        ok: false,
        message: "Only students or Kaprodi can access this endpoint",
      });
    }

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
