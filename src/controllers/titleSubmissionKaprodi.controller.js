const db = require("../db");

exports.listForKaprodi = async (req, res, next) => {
  try {
    if (req.user.userType !== "LECTURER") {
      return res.status(403).json({ ok: false, message: "Only Kaprodi" });
    }

    // Ambil nidn dosen dari user
    const [urows] = await db.query(
      `SELECT nidn FROM users WHERE id = ? LIMIT 1`,
      [req.user.id]
    );
    const nidn = urows[0]?.nidn;
    if (!nidn) {
      return res.status(400).json({ ok: false, message: "Dosen tidak valid" });
    }

    const [rows] = await db.query(
      `
      SELECT
        pj.id,
        pj.status,
        pj.submitted_at,
        pj.created_at,
        o.judul AS outline_judul,
        m.npm,
        m.nama AS nama_mahasiswa,
        ps.nama AS program_studi
      FROM pengajuan_judul pj
      INNER JOIN outline o ON o.id = pj.outline_id
      INNER JOIN mahasiswa m ON m.npm = pj.npm
      INNER JOIN program_studi ps ON ps.id = m.program_studi_id
      WHERE ps.kaprodi_nidn = ?
      ORDER BY pj.submitted_at DESC
      `,
      [nidn]
    );

    return res.json({ ok: true, data: rows });
  } catch (err) {
    next(err);
  }
};

exports.review = async (req, res, next) => {
  try {
    if (req.user.userType !== "LECTURER") {
      return res.status(403).json({ ok: false, message: "Only Kaprodi" });
    }

    const id = Number(req.params.id);
    if (!Number.isFinite(id)) {
      return res.status(400).json({ ok: false, message: "Invalid id" });
    }

    const { status, pembimbing1DitapkanNidn, pembimbing2DitapkanNidn, catatanKaprodi } =
      req.body || {};

    if (!["APPROVED", "REJECTED"].includes(status)) {
      return res.status(400).json({ ok: false, message: "Invalid status" });
    }

    // Ambil nidn Kaprodi
    const [urows] = await db.query(
      `SELECT nidn FROM users WHERE id = ? LIMIT 1`,
      [req.user.id]
    );
    const kaprodiNidn = urows[0]?.nidn;
    if (!kaprodiNidn) {
      return res.status(400).json({ ok: false, message: "Dosen tidak valid" });
    }

    // Pastikan pengajuan ini memang milik prodinya Kaprodi
    const [check] = await db.query(
      `
      SELECT pj.id
      FROM pengajuan_judul pj
      INNER JOIN mahasiswa m ON m.npm = pj.npm
      INNER JOIN program_studi ps ON ps.id = m.program_studi_id
      WHERE pj.id = ?
        AND ps.kaprodi_nidn = ?
        AND pj.status = 'SUBMITTED'
      LIMIT 1
      `,
      [id, kaprodiNidn]
    );

    if (check.length === 0) {
      return res.status(404).json({
        ok: false,
        message: "Pengajuan tidak ditemukan / bukan wewenang Anda",
      });
    }

    await db.query(
      `
      UPDATE pengajuan_judul
      SET
        status = ?,
        pembimbing1_ditetapkan_nidn = ?,
        pembimbing2_ditetapkan_nidn = ?,
        catatan_kaprodi = ?,
        disposisi_at = CURRENT_TIMESTAMP,
        decided_by_user_id = ?
      WHERE id = ?
      `,
      [
        status,
        pembimbing1DitapkanNidn ?? null,
        pembimbing2DitapkanNidn ?? null,
        catatanKaprodi ?? null,
        req.user.id,
        id,
      ]
    );

    return res.json({ ok: true, message: "Review saved" });
  } catch (err) {
    next(err);
  }
};