const db = require("../db");

async function getLecturerNidn(userId) {
  const [rows] = await db.query(
    `SELECT nidn FROM users WHERE id = ? AND is_active = 1 LIMIT 1`,
    [userId],
  );
  return rows[0]?.nidn ?? null;
}

exports.getPendingActions = async (req, res, next) => {
  try {
    if (!req.user.hasRole("LECTURER")) {
      return res
        .status(403)
        .json({ ok: false, message: "Only lecturers can access this endpoint" });
    }

    const nidn = await getLecturerNidn(req.user.id);
    if (!nidn) {
      return res
        .status(400)
        .json({ ok: false, message: "Data dosen tidak valid" });
    }

    const [
      [outlineConsultationRows],
      [skripsiConsultationRows],
      [sidangPenilaianRows],
      [sidangNotulenRows],
      [sidangHasilRows],
      [revisiPascaSidangRows],
      [pengumpulanBerkasFinalRows],
    ] = await Promise.all([
      db.query(
        `SELECT COUNT(*) AS c
         FROM konsultasi_outline_stage s
         WHERE s.pembimbing_nidn = ? AND s.current_status IN ('SUBMITTED', 'IN_REVIEW')`,
        [nidn],
      ),
      db.query(
        `SELECT COUNT(*) AS c
         FROM konsultasi_skripsi_stage s
         WHERE s.pembimbing_nidn = ? AND s.current_status IN ('SUBMITTED', 'IN_REVIEW')`,
        [nidn],
      ),
      db.query(
        `SELECT COUNT(*) AS c
         FROM sidang_penilaian sp
         JOIN sidang si ON si.id = sp.sidang_id
         JOIN skripsi sk ON sk.id = si.skripsi_id
         LEFT JOIN pengajuan_sidang_kaprodi psk ON psk.pengajuan_sidang_id = si.pengajuan_sidang_id
         WHERE si.status = 'ONGOING'
           AND sp.submitted_at IS NULL
           AND (
             (sp.role = 'PEMBIMBING_1' AND sk.pembimbing1_nidn = ?) OR
             (sp.role = 'PEMBIMBING_2' AND sk.pembimbing2_nidn = ?) OR
             (sp.role = 'PENGUJI_1' AND psk.penguji1_nidn = ?) OR
             (sp.role = 'PENGUJI_2' AND psk.penguji2_nidn = ?)
           )`,
        [nidn, nidn, nidn, nidn],
      ),
      db.query(
        `SELECT COUNT(*) AS c
         FROM sidang_notulen sn
         JOIN sidang si ON si.id = sn.sidang_id
         LEFT JOIN pengajuan_sidang_kaprodi psk ON psk.pengajuan_sidang_id = si.pengajuan_sidang_id
         WHERE si.status = 'ONGOING'
           AND sn.submitted_at IS NULL
           AND (
             (sn.role = 'PENGUJI_1' AND psk.penguji1_nidn = ?) OR
             (sn.role = 'PENGUJI_2' AND psk.penguji2_nidn = ?)
           )`,
        [nidn, nidn],
      ),
      db.query(
        `SELECT COUNT(*) AS c
         FROM sidang si
         JOIN skripsi sk ON sk.id = si.skripsi_id
         WHERE si.status = 'ONGOING'
           AND sk.pembimbing1_nidn = ?
           AND (SELECT COUNT(*) FROM sidang_penilaian sp WHERE sp.sidang_id = si.id AND sp.submitted_at IS NOT NULL) = 4
           AND NOT EXISTS (
             SELECT 1 FROM sidang_hasil_penilaian shp
             WHERE shp.sidang_id = si.id AND shp.submitted_at IS NOT NULL
           )`,
        [nidn],
      ),
      db.query(
        `SELECT COUNT(*) AS c
         FROM revisi_pasca_sidang_stages st
         JOIN users u ON u.id = st.user_id
         WHERE u.nidn = ? AND st.current_status = 'SUBMITTED'`,
        [nidn],
      ),
      db.query(
        `SELECT COUNT(*) AS c
         FROM pengumpulan_berkas_final_confirmations c
         JOIN pengumpulan_berkas_final p ON p.id = c.pengumpulan_id
         JOIN users u ON u.id = c.user_id
         WHERE u.nidn = ? AND c.confirmed_at IS NULL AND p.status != 'DRAFT'`,
        [nidn],
      ),
    ]);

    const outlineConsultation = Number(outlineConsultationRows[0]?.c ?? 0);
    const skripsiConsultation = Number(skripsiConsultationRows[0]?.c ?? 0);
    const sidang =
      Number(sidangPenilaianRows[0]?.c ?? 0) +
      Number(sidangNotulenRows[0]?.c ?? 0) +
      Number(sidangHasilRows[0]?.c ?? 0);
    const revisiPascaSidang = Number(revisiPascaSidangRows[0]?.c ?? 0);
    const pengumpulanBerkasFinal = Number(pengumpulanBerkasFinalRows[0]?.c ?? 0);

    return res.json({
      ok: true,
      data: {
        outlineConsultation,
        skripsiConsultation,
        sidang,
        revisiPascaSidang,
        pengumpulanBerkasFinal,
        total:
          outlineConsultation +
          skripsiConsultation +
          sidang +
          revisiPascaSidang +
          pengumpulanBerkasFinal,
      },
    });
  } catch (err) {
    next(err);
  }
};
