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

exports.createDraft = async (req, res, next) => {
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
    } = req.body || {};

    const [result] = await db.query(
      `INSERT INTO pengajuan_judul (
         outline_id, npm,
         no_hp, sks_diperoleh,
         pembimbing1_diajukan_nidn, pembimbing2_diajukan_nidn,
         perlu_surat_pengantar, nama_perusahaan,
         syarat_transkrip, syarat_krs, syarat_metodologi_nilai_min_c,
         status
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'DRAFT')`,
      [
        outlineId,
        npm,
        noHp ?? null,
        sksDiperoleh ?? null,
        pembimbing1DiajukanNidn ?? null,
        pembimbing2DiajukanNidn ?? null,
        perluSuratPengantar ? 1 : 0,
        namaPerusahaan ?? null,
        syaratTranskrip ? 1 : 0,
        syaratKrs ? 1 : 0,
        syaratMetodologiNilaiMinC ? 1 : 0,
      ]
    );

    return res.status(201).json({
      ok: true,
      message: "Draft created",
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

exports.submit = async (req, res, next) => {
  try {
    if (req.user.userType !== "STUDENT") {
      return res.status(403).json({ ok: false, message: "Only students" });
    }

    const npm = await getStudentNpm(req.user.id);
    if (!npm) {
      return res.status(400).json({ ok: false, message: "Mahasiswa tidak valid" });
    }

    const id = Number(req.params.id);
    if (!Number.isFinite(id) || id <= 0) {
      return res.status(400).json({ ok: false, message: "Invalid id" });
    }

    // Pastikan milik mahasiswa dan masih DRAFT
    const [rows] = await db.query(
      `SELECT id
       FROM pengajuan_judul
       WHERE id = ? AND npm = ? AND status = 'DRAFT'
       LIMIT 1`,
      [id, npm]
    );

    if (rows.length === 0) {
      return res.status(404).json({
        ok: false,
        message: "Draft not found (or already submitted)",
      });
    }

    // Minimal validation ringan sebelum submit (silakan tambah jika perlu)
    // Contoh: wajib isi SKS + checklist 3 syarat
    const [checkRows] = await db.query(
      `SELECT
         sks_diperoleh,
         syarat_transkrip, syarat_krs, syarat_metodologi_nilai_min_c
       FROM pengajuan_judul
       WHERE id = ? LIMIT 1`,
      [id]
    );

    const d = checkRows[0];
    if (
      d?.sks_diperoleh === null ||
      d?.syarat_transkrip !== 1 ||
      d?.syarat_krs !== 1 ||
      d?.syarat_metodologi_nilai_min_c !== 1
    ) {
      return res.status(400).json({
        ok: false,
        message: "Administrative requirements are not complete",
      });
    }

    await db.query(
      `UPDATE pengajuan_judul
       SET status = 'SUBMITTED', submitted_at = CURRENT_TIMESTAMP
       WHERE id = ?`,
      [id]
    );

    return res.json({ ok: true, message: "Submitted" });
  } catch (err) {
    next(err);
  }
};

exports.updateDraft = async (req, res, next) => {
  try {
    if (req.user.userType !== "STUDENT") {
      return res.status(403).json({ ok: false, message: "Only students" });
    }

    const id = Number(req.params.id);
    if (!Number.isFinite(id) || id <= 0) {
      return res.status(400).json({ ok: false, message: "Invalid id" });
    }

    // Ambil npm mahasiswa dari user
    const [urows] = await db.query(
      `SELECT npm FROM users WHERE id = ? AND is_active = 1 LIMIT 1`,
      [req.user.id]
    );
    const npm = urows[0]?.npm;
    if (!npm) {
      return res.status(400).json({ ok: false, message: "Mahasiswa tidak valid" });
    }

    // Pastikan draft ini milik mahasiswa & masih DRAFT
    const [rows] = await db.query(
      `SELECT id
       FROM pengajuan_judul
       WHERE id = ? AND npm = ? AND status = 'DRAFT'
       LIMIT 1`,
      [id, npm]
    );

    if (rows.length === 0) {
      return res.status(404).json({
        ok: false,
        message: "Draft not found or already submitted",
      });
    }

    // Ambil field yang boleh diupdate
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
    } = req.body || {};

    // Bangun query UPDATE secara dinamis (hanya field yang dikirim)
    const fields = [];
    const values = [];

    const push = (sql, val) => {
      fields.push(sql);
      values.push(val);
    };

    if (noHp !== undefined) push("no_hp = ?", noHp);
    if (sksDiperoleh !== undefined) push("sks_diperoleh = ?", sksDiperoleh);
    if (pembimbing1DiajukanNidn !== undefined)
      push("pembimbing1_diajukan_nidn = ?", pembimbing1DiajukanNidn);
    if (pembimbing2DiajukanNidn !== undefined)
      push("pembimbing2_diajukan_nidn = ?", pembimbing2DiajukanNidn);
    if (perluSuratPengantar !== undefined)
      push("perlu_surat_pengantar = ?", perluSuratPengantar ? 1 : 0);
    if (namaPerusahaan !== undefined)
      push("nama_perusahaan = ?", namaPerusahaan);
    if (syaratTranskrip !== undefined)
      push("syarat_transkrip = ?", syaratTranskrip ? 1 : 0);
    if (syaratKrs !== undefined)
      push("syarat_krs = ?", syaratKrs ? 1 : 0);
    if (syaratMetodologiNilaiMinC !== undefined)
      push("syarat_metodologi_nilai_min_c = ?", syaratMetodologiNilaiMinC ? 1 : 0);

    if (fields.length === 0) {
      return res.status(400).json({
        ok: false,
        message: "No fields to update",
      });
    }

    await db.query(
      `
      UPDATE pengajuan_judul
      SET ${fields.join(", ")}
      WHERE id = ?
      `,
      [...values, id]
    );

    return res.json({ ok: true, message: "Draft updated" });
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
