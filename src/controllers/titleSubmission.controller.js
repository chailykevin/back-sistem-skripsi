const db = require("../db");

async function getStudentNpm(userId) {
  const [urows] = await db.query(
    `SELECT npm
     FROM users
     WHERE id = ? AND is_active = 1
     LIMIT 1`,
    [userId]
  );
  return urows[0]?.npm ?? null;
}

// Create Formulir Pengajuan Judul Skripsi
exports.createTitleSubmission = async (req, res, next) => {
  try {
    if (req.user.userType !== "STUDENT") {
      return res.status(403).json({ ok: false, message: "Only students" });
    }

    const npm = await getStudentNpm(req.user.id);
    if (!npm) {
      return res.status(400).json({ ok: false, message: "Mahasiswa tidak valid" });
    }

    const outlineId = Number(req.body.outlineId);
    if (!Number.isFinite(outlineId) || outlineId <= 0) {
      return res.status(400).json({ ok: false, message: "outlineId invalid" });
    }

    // Pastikan outline milik mahasiswa dan sudah ACCEPTED (sesuai workflow kamu)
    const [orows] = await db.query(
      `SELECT id
       FROM outline
       WHERE id = ? AND npm = ? AND status = 'ACCEPTED'
       LIMIT 1`,
      [outlineId, npm]
    );
    if (orows.length === 0) {
      return res.status(400).json({
        ok: false,
        message: "Outline not found or not ACCEPTED",
      });
    }

    // Ambil program studi mahasiswa
    const [mrows] = await db.query(
      `SELECT program_studi_id
       FROM mahasiswa
       WHERE npm = ?
       LIMIT 1`,
      [npm]
    );
    const programStudiId = mrows[0]?.program_studi_id ?? null;
    if (!programStudiId) {
      return res.status(400).json({ ok: false, message: "Program studi tidak valid" });
    }

    // Cegah duplikasi pengajuan untuk outline yang sama
    const [existing] = await db.query(
      `SELECT id, status
       FROM pengajuan_judul
       WHERE outline_id = ? AND npm = ?
       LIMIT 1`,
      [outlineId, npm]
    );
    if (existing.length > 0) {
      return res.status(409).json({
        ok: false,
        message: "Title submission already exists for this outline",
        data: existing[0],
      });
    }

    const {
      noHp,
      sksDiperoleh,
      pembimbing1DiajukanNidn,
      pembimbing2DiajukanNidn,
      perluSuratPengantar,
      namaPerusahaan,
      syaratTranskrip,
      syaratKrs,
      syaratMetodologiNilaiMinC,
      fileTitleSubmission,
      fileTitleSubmissionName,
    } = req.body || {};

    const [result] = await db.query(
      `INSERT INTO pengajuan_judul (
         outline_id, npm, program_studi_id,
         no_hp, sks_diperoleh,
         pembimbing1_diajukan_nidn, pembimbing2_diajukan_nidn,
         perlu_surat_pengantar, nama_perusahaan,
         syarat_transkrip, syarat_krs, syarat_metodologi_nilai_min_c,
         file_pengajuan_judul, file_pengajuan_judul_name,
         status, submitted_at
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'SUBMITTED', CURRENT_TIMESTAMP)`,
      [
        outlineId,
        npm,
        programStudiId,
        noHp ?? null,
        sksDiperoleh ?? null,
        pembimbing1DiajukanNidn ?? null,
        pembimbing2DiajukanNidn ?? null,
        perluSuratPengantar ? 1 : 0,
        namaPerusahaan ?? null,
        syaratTranskrip ? 1 : 0,
        syaratKrs ? 1 : 0,
        syaratMetodologiNilaiMinC ? 1 : 0,
        fileTitleSubmission ?? null,
        fileTitleSubmissionName ?? null,
      ]
    );

    return res.status(201).json({
      ok: true,
      message: "Created",
      data: { id: result.insertId },
    });
  } catch (err) {
    next(err);
  }
};

exports.listMine = async (req, res, next) => {
  try {
    if (req.user.userType !== "STUDENT") {
      return res.status(403).json({ ok: false, message: "Only students" });
    }

    const npm = await getStudentNpm(req.user.id);
    if (!npm) {
      return res.status(400).json({ ok: false, message: "Mahasiswa tidak valid" });
    }

    // Join outline untuk ambil judul (karena judul ada di outline)
    const [rows] = await db.query(
      `SELECT
         pj.id,
         pj.outline_id,
         pj.status,
         pj.submitted_at,
         pj.created_at,
         pj.updated_at,
         o.judul AS outline_judul
       FROM pengajuan_judul pj
       INNER JOIN outline o ON o.id = pj.outline_id
       WHERE pj.npm = ?
       ORDER BY pj.created_at DESC`,
      [npm]
    );

    return res.json({ ok: true, data: rows });
  } catch (err) {
    next(err);
  }
};

exports.getLatestMine = async (req, res, next) => {
  try {
    if (req.user.userType !== "STUDENT") {
      return res.status(403).json({
        ok: false,
        message: "Only students can access their latest title submission",
      });
    }

    const npm = await getStudentNpm(req.user.id);
    if (!npm) {
      return res.status(400).json({ ok: false, message: "Mahasiswa tidak valid" });
    }

    const [rows] = await db.query(
      `SELECT
         pj.*,
         o.judul AS outline_judul,
         m.nama AS mahasiswa_nama,
         ps.id AS program_studi_id,
         ps.nama AS program_studi_nama,
         d1.nama AS pembimbing1_diajukan_nama,
         d2.nama AS pembimbing2_diajukan_nama,
         d3.nama AS pembimbing1_ditetapkan_nama,
         d4.nama AS pembimbing2_ditetapkan_nama
       FROM pengajuan_judul pj
       INNER JOIN outline o ON o.id = pj.outline_id
       INNER JOIN mahasiswa m ON m.npm = pj.npm
       INNER JOIN program_studi ps ON ps.id = m.program_studi_id
       LEFT JOIN dosen d1 ON d1.nidn = pj.pembimbing1_diajukan_nidn
       LEFT JOIN dosen d2 ON d2.nidn = pj.pembimbing2_diajukan_nidn
       LEFT JOIN dosen d3 ON d3.nidn = pj.pembimbing1_ditetapkan_nidn
       LEFT JOIN dosen d4 ON d4.nidn = pj.pembimbing2_ditetapkan_nidn
       WHERE pj.npm = ?
       ORDER BY pj.updated_at DESC, pj.id DESC
       LIMIT 1`,
      [npm]
    );

    if (!rows || rows.length === 0) {
      return res.json({
        ok: true,
        data: null,
        message: "Title submission not found",
      });
    }

    return res.json({ ok: true, data: rows[0] });
  } catch (err) {
    next(err);
  }
};

exports.getById = async (req, res, next) => {
  try {
    const id = Number(req.params.id);
    if (!Number.isFinite(id) || id <= 0) {
      return res.status(400).json({ ok: false, message: "Invalid id" });
    }

    // STUDENT: hanya boleh lihat miliknya
    if (req.user.userType === "STUDENT") {
      const [urows] = await db.query(
        `SELECT npm FROM users WHERE id = ? AND is_active = 1 LIMIT 1`,
        [req.user.id]
      );
      const npm = urows[0]?.npm;
      if (!npm) {
        return res.status(400).json({ ok: false, message: "Mahasiswa tidak valid" });
      }

      const [rows] = await db.query(
        `
        SELECT
          pj.*,

          o.judul AS outline_judul,

          m.nama AS mahasiswa_nama,
          ps.id AS program_studi_id,
          ps.nama AS program_studi_nama,

          d1.nama AS pembimbing1_diajukan_nama,
          d2.nama AS pembimbing2_diajukan_nama,
          d3.nama AS pembimbing1_ditetapkan_nama,
          d4.nama AS pembimbing2_ditetapkan_nama

        FROM pengajuan_judul pj
        INNER JOIN outline o ON o.id = pj.outline_id
        INNER JOIN mahasiswa m ON m.npm = pj.npm
        INNER JOIN program_studi ps ON ps.id = m.program_studi_id

        LEFT JOIN dosen d1 ON d1.nidn = pj.pembimbing1_diajukan_nidn
        LEFT JOIN dosen d2 ON d2.nidn = pj.pembimbing2_diajukan_nidn
        LEFT JOIN dosen d3 ON d3.nidn = pj.pembimbing1_ditetapkan_nidn
        LEFT JOIN dosen d4 ON d4.nidn = pj.pembimbing2_ditetapkan_nidn

        WHERE pj.id = ? AND pj.npm = ?
        LIMIT 1
        `,
        [id, npm]
      );

      if (rows.length === 0) {
        return res.status(404).json({ ok: false, message: "Not found" });
      }

      return res.json({ ok: true, data: rows[0] });
    }

    // LECTURER (Kaprodi): hanya boleh pengajuan dari prodinya
    if (req.user.userType === "LECTURER") {
      const [urows] = await db.query(
        `SELECT nidn FROM users WHERE id = ? AND is_active = 1 LIMIT 1`,
        [req.user.id]
      );
      const nidn = urows[0]?.nidn;
      if (!nidn) {
        return res.status(400).json({ ok: false, message: "Dosen tidak valid" });
      }

      const [rows] = await db.query(
        `
        SELECT
          pj.*,

          o.judul AS outline_judul,

          m.nama AS mahasiswa_nama,
          ps.id AS program_studi_id,
          ps.nama AS program_studi_nama,

          d1.nama AS pembimbing1_diajukan_nama,
          d2.nama AS pembimbing2_diajukan_nama,
          d3.nama AS pembimbing1_ditetapkan_nama,
          d4.nama AS pembimbing2_ditetapkan_nama

        FROM pengajuan_judul pj
        INNER JOIN outline o ON o.id = pj.outline_id
        INNER JOIN mahasiswa m ON m.npm = pj.npm
        INNER JOIN program_studi ps ON ps.id = m.program_studi_id

        LEFT JOIN dosen d1 ON d1.nidn = pj.pembimbing1_diajukan_nidn
        LEFT JOIN dosen d2 ON d2.nidn = pj.pembimbing2_diajukan_nidn
        LEFT JOIN dosen d3 ON d3.nidn = pj.pembimbing1_ditetapkan_nidn
        LEFT JOIN dosen d4 ON d4.nidn = pj.pembimbing2_ditetapkan_nidn

        WHERE pj.id = ?
          AND ps.kaprodi_nidn = ?
        LIMIT 1
        `,
        [id, nidn]
      );

      if (rows.length === 0) {
        return res.status(404).json({ ok: false, message: "Not found" });
      }

      return res.json({ ok: true, data: rows[0] });
    }

    return res.status(403).json({ ok: false, message: "Forbidden" });
  } catch (err) {
    next(err);
  }
};
