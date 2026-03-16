const db = require("../db");

exports.list = async (req, res, next) => {
  try {
    const [rows] = await db.query(
      `SELECT nidn, nama
       FROM dosen
       ORDER BY nama ASC`
    );

    return res.json({ ok: true, data: rows });
  } catch (err) {
    next(err);
  }
};
