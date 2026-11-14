const db = require("../db");
const { getLecturerNidn } = require("../utils/identity");

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
      [sidangStartRows],
      [sidangPenilaianRows],
      [sidangNotulenRows],
      [sidangHasilRows],
      [revisiPascaSidangRows],
      [pengumpulanBerkasFinalRows],
    ] = await Promise.all([
      db.query(
        `SELECT COUNT(*) AS c
         FROM konsultasi_outline_stage s
         WHERE s.pembimbing_nidn = ? AND s.current_status = 'SUBMITTED'`,
        [nidn],
      ),
      db.query(
        `SELECT COUNT(*) AS c
         FROM konsultasi_skripsi_stage s
         WHERE s.pembimbing_nidn = ? AND s.current_status = 'SUBMITTED'`,
        [nidn],
      ),
      db.query(
        `SELECT COUNT(*) AS c
         FROM sidang si
         JOIN skripsi sk ON sk.id = si.skripsi_id
         WHERE si.status = 'SCHEDULED'
           AND sk.pembimbing1_nidn = ?`,
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
           -- "Every row submitted" rather than fixed counts: a Seminar sidang has 3 penilaian and 1 notulen.
           AND NOT EXISTS (SELECT 1 FROM sidang_penilaian sp WHERE sp.sidang_id = si.id AND sp.submitted_at IS NULL)
           AND NOT EXISTS (SELECT 1 FROM sidang_notulen sn2 WHERE sn2.sidang_id = si.id AND sn2.submitted_at IS NULL)
           AND NOT EXISTS (
             SELECT 1 FROM sidang_hasil_penilaian shp
             WHERE shp.sidang_id = si.id AND shp.submitted_at IS NOT NULL
           )`,
        [nidn],
      ),
      db.query(
        `SELECT COUNT(*) AS c
         FROM revisi_pasca_sidang_stages st
         JOIN revisi_pasca_sidang rps ON rps.id = st.revisi_id
         JOIN sidang si ON si.id = rps.sidang_id
         JOIN skripsi sk ON sk.id = si.skripsi_id
         LEFT JOIN pengajuan_sidang_kaprodi psk ON psk.pengajuan_sidang_id = si.pengajuan_sidang_id
         WHERE st.current_status = 'SUBMITTED'
           -- the stage's signer is whoever holds that role's NIDN; st.user_id can be NULL
           AND CASE st.signer_role
                 WHEN 'PENGUJI_2' THEN psk.penguji2_nidn
                 WHEN 'PENGUJI_1' THEN psk.penguji1_nidn
                 WHEN 'PEMBIMBING_2' THEN sk.pembimbing2_nidn
                 WHEN 'PEMBIMBING_1' THEN sk.pembimbing1_nidn
               END = ?`,
        [nidn],
      ),
      db.query(
        `SELECT COUNT(*) AS c
         FROM pengumpulan_berkas_final_confirmations c
         JOIN pengumpulan_berkas_final p ON p.id = c.pengumpulan_id
         JOIN skripsi sk ON sk.id = p.skripsi_id
         LEFT JOIN sidang si ON si.id = (SELECT MAX(id) FROM sidang WHERE skripsi_id = p.skripsi_id AND jenis = 'SKRIPSI')
         LEFT JOIN pengajuan_sidang_kaprodi psk ON psk.pengajuan_sidang_id = si.pengajuan_sidang_id
         WHERE c.confirmed_at IS NULL AND p.status != 'DRAFT'
           -- the recipient is whoever holds that role's NIDN; c.user_id can be NULL
           AND CASE c.recipient_role
                 WHEN 'PEMBIMBING_1' THEN sk.pembimbing1_nidn
                 WHEN 'PEMBIMBING_2' THEN sk.pembimbing2_nidn
                 WHEN 'PENGUJI_1' THEN psk.penguji1_nidn
                 WHEN 'PENGUJI_2' THEN psk.penguji2_nidn
               END = ?`,
        [nidn],
      ),
    ]);

    const outlineConsultation = Number(outlineConsultationRows[0]?.c ?? 0);
    const skripsiConsultation = Number(skripsiConsultationRows[0]?.c ?? 0);
    const sidang =
      Number(sidangStartRows[0]?.c ?? 0) +
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
