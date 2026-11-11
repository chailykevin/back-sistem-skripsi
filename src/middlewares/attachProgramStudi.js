const db = require("../db");
const { getStaffUsrId, getKaprodiProgramStudiIds } = require("../utils/identity");

module.exports = async (req, res, next) => {
  try {
    const userId = Number(req.user?.id);
    if (!Number.isFinite(userId) || userId <= 0) {
      return res.status(401).json({ ok: false, message: "Sesi tidak valid. Silakan login ulang." });
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
      // A Kaprodi may head several prodi: ?programStudiId= picks one of their own, else the first.
      const ids = await getKaprodiProgramStudiIds(await getStaffUsrId(userId));
      const requested = Number(req.query?.programStudiId);
      const programStudiId =
        Number.isFinite(requested) && requested > 0
          ? (ids.includes(requested) ? requested : null)
          : (ids[0] ?? null);
      rows = [{ program_studi_id: programStudiId }];
    } else {
      return res.status(403).json({
        ok: false,
        message: "Hanya mahasiswa atau Kaprodi yang dapat mengakses fitur ini",
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
