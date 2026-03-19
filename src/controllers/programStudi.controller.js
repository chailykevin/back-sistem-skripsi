const db = require("../db");

exports.getKaprodiNameByProgramStudi = async (req, res, next) => {
  try {
    const programStudiIdRaw = req.body?.programStudiId;
    const programStudiId = Number(programStudiIdRaw);

    if (!Number.isFinite(programStudiId) || programStudiId <= 0) {
      return res.status(400).json({
        ok: false,
        message: "programStudiId is required",
      });
    }

    const [rows] = await db.query(
      `
      SELECT
        ps.nama AS program_studi_nama,
        d.nama AS kaprodi_nama
      FROM program_studi ps
      LEFT JOIN dosen d ON d.nidn = ps.kaprodi_nidn
      WHERE ps.id = ?
      LIMIT 1
      `,
      [programStudiId]
    );

    if (rows.length === 0) {
      return res.status(404).json({
        ok: false,
        message: "Program studi not found",
      });
    }

    return res.json({
      ok: true,
      data: {
        programStudiName: rows[0].program_studi_nama,
        kaprodiName: rows[0].kaprodi_nama ?? null,
      },
    });
  } catch (err) {
    next(err);
  }
};
