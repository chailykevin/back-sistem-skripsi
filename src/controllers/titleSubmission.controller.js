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

    const programStudiId = req.user?.programStudiId ?? null;
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
      fileTitleSubmission,
      fileTitleSubmissionName,
      fileTranskrip,
      fileTranskripName,
      fileKrs,
      fileKrsName,
      fileMetodologi,
      fileMetodologiName,
    } = req.body || {};

    const [result] = await db.query(
      `INSERT INTO pengajuan_judul (
         outline_id, npm, program_studi_id,
         no_hp, sks_diperoleh,
         pembimbing1_diajukan_nidn, pembimbing2_diajukan_nidn,
         perlu_surat_pengantar, nama_perusahaan,
         file_pengajuan_judul, file_pengajuan_judul_name,
         file_transkrip, file_transkrip_name,
         file_krs, file_krs_name,
         file_metodologi, file_metodologi_name,
         status, submitted_at
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'SUBMITTED', CURRENT_TIMESTAMP)`,
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
        fileTitleSubmission ?? null,
        fileTitleSubmissionName ?? null,
        fileTranskrip ?? null,
        fileTranskripName ?? null,
        fileKrs ?? null,
        fileKrsName ?? null,
        fileMetodologi ?? null,
        fileMetodologiName ?? null,
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
          pj.id,
          pj.outline_id,
          pj.npm,
          pj.no_hp,
          pj.sks_diperoleh,
          pj.pembimbing1_diajukan_nidn,
          pj.pembimbing2_diajukan_nidn,
          pj.perlu_surat_pengantar,
          pj.nama_perusahaan,
          pj.syarat_transkrip,
          pj.syarat_krs,
          pj.syarat_metodologi_nilai_min_c,
          pj.status,
          pj.submitted_at,
          pj.pembimbing1_ditetapkan_nidn,
          pj.pembimbing2_ditetapkan_nidn,
          pj.catatan_kaprodi,
          pj.disposisi_at,
          pj.decided_by_user_id,
          pj.created_at,
          pj.updated_at,
          pj.file_pengajuan_judul,
          pj.file_pengajuan_judul_name,
          pj.file_transkrip,
          pj.file_transkrip_name,
          pj.file_krs,
          pj.file_krs_name,
          pj.file_metodologi,
          pj.file_metodologi_name,

          o.judul AS outline_judul,

          m.nama AS mahasiswa_nama,
          ps.id AS program_studi_id,
          ps.nama AS program_studi_nama,
          dkap.nama AS kaprodi_nama,

          d1.nama AS pembimbing1_diajukan_nama,
          d2.nama AS pembimbing2_diajukan_nama,
          d3.nama AS pembimbing1_ditetapkan_nama,
          d4.nama AS pembimbing2_ditetapkan_nama

        FROM pengajuan_judul pj
        INNER JOIN outline o ON o.id = pj.outline_id
        INNER JOIN mahasiswa m ON m.npm = pj.npm
        INNER JOIN program_studi ps ON ps.id = m.program_studi_id
        LEFT JOIN dosen dkap ON dkap.nidn = ps.kaprodi_nidn

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
          pj.id,
          pj.outline_id,
          pj.npm,
          pj.no_hp,
          pj.sks_diperoleh,
          pj.pembimbing1_diajukan_nidn,
          pj.pembimbing2_diajukan_nidn,
          pj.perlu_surat_pengantar,
          pj.nama_perusahaan,
          pj.syarat_transkrip,
          pj.syarat_krs,
          pj.syarat_metodologi_nilai_min_c,
          pj.status,
          pj.submitted_at,
          pj.pembimbing1_ditetapkan_nidn,
          pj.pembimbing2_ditetapkan_nidn,
          pj.catatan_kaprodi,
          pj.disposisi_at,
          pj.decided_by_user_id,
          pj.created_at,
          pj.updated_at,
          pj.file_pengajuan_judul,
          pj.file_pengajuan_judul_name,
          pj.file_transkrip,
          pj.file_transkrip_name,
          pj.file_krs,
          pj.file_krs_name,
          pj.file_metodologi,
          pj.file_metodologi_name,

          o.judul AS outline_judul,

          m.nama AS mahasiswa_nama,
          ps.id AS program_studi_id,
          ps.nama AS program_studi_nama,
          dkap.nama AS kaprodi_nama,

          d1.nama AS pembimbing1_diajukan_nama,
          d2.nama AS pembimbing2_diajukan_nama,
          d3.nama AS pembimbing1_ditetapkan_nama,
          d4.nama AS pembimbing2_ditetapkan_nama

        FROM pengajuan_judul pj
        INNER JOIN outline o ON o.id = pj.outline_id
        INNER JOIN mahasiswa m ON m.npm = pj.npm
        INNER JOIN program_studi ps ON ps.id = m.program_studi_id
        LEFT JOIN dosen dkap ON dkap.nidn = ps.kaprodi_nidn

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

exports.resubmit = async (req, res, next) => {
  let conn;
  let txStarted = false;
  try {
    if (!req.user || req.user.userType !== "STUDENT") {
      return res.status(403).json({
        ok: false,
        message: "Only students can resubmit title submissions",
      });
    }

    const id = Number(req.params.id);
    if (!Number.isFinite(id) || id <= 0) {
      return res.status(400).json({ ok: false, message: "Invalid title submission id" });
    }

    const {
      noHp,
      sksDiperoleh,
      pembimbing1DiajukanNidn,
      pembimbing2DiajukanNidn,
      perluSuratPengantar,
      namaPerusahaan,
      fileTitleSubmission,
      fileTitleSubmissionName,
      fileTranskrip,
      fileTranskripName,
      fileKrs,
      fileKrsName,
      fileMetodologi,
      fileMetodologiName,
    } = req.body || {};

    const noHpVal = noHp !== undefined && noHp !== null ? String(noHp).trim() : null;
    const sksRaw =
      sksDiperoleh !== undefined && sksDiperoleh !== null ? String(sksDiperoleh).trim() : null;
    let sksVal = null;
    if (sksRaw !== null && sksRaw.length > 0) {
      const parsedSks = Number(sksRaw);
      if (!Number.isFinite(parsedSks)) {
        return res.status(400).json({
          ok: false,
          message: "sksDiperoleh must be a valid number",
        });
      }
      sksVal = parsedSks;
    }
    const pembimbing1Val =
      pembimbing1DiajukanNidn !== undefined && pembimbing1DiajukanNidn !== null
        ? String(pembimbing1DiajukanNidn).trim()
        : null;
    const pembimbing2Val =
      pembimbing2DiajukanNidn !== undefined && pembimbing2DiajukanNidn !== null
        ? String(pembimbing2DiajukanNidn).trim()
        : null;
    const perluSuratProvided = perluSuratPengantar !== undefined;
    const namaPerusahaanVal =
      namaPerusahaan !== undefined && namaPerusahaan !== null
        ? String(namaPerusahaan).trim()
        : null;
    const fileTitleSubmissionVal =
      fileTitleSubmission !== undefined && fileTitleSubmission !== null
        ? String(fileTitleSubmission)
        : null;
    const fileTitleSubmissionNameVal =
      fileTitleSubmissionName !== undefined && fileTitleSubmissionName !== null
        ? String(fileTitleSubmissionName).trim()
        : null;
    const fileTranskripVal =
      fileTranskrip !== undefined && fileTranskrip !== null ? String(fileTranskrip) : null;
    const fileTranskripNameVal =
      fileTranskripName !== undefined && fileTranskripName !== null
        ? String(fileTranskripName).trim()
        : null;
    const fileKrsVal = fileKrs !== undefined && fileKrs !== null ? String(fileKrs) : null;
    const fileKrsNameVal =
      fileKrsName !== undefined && fileKrsName !== null ? String(fileKrsName).trim() : null;
    const fileMetodologiVal =
      fileMetodologi !== undefined && fileMetodologi !== null ? String(fileMetodologi) : null;
    const fileMetodologiNameVal =
      fileMetodologiName !== undefined && fileMetodologiName !== null
        ? String(fileMetodologiName).trim()
        : null;

    const hasMeaningfulUpdate =
      (noHpVal !== null && noHpVal.length > 0) ||
      sksVal !== null ||
      (pembimbing1Val !== null && pembimbing1Val.length > 0) ||
      (pembimbing2Val !== null && pembimbing2Val.length > 0) ||
      perluSuratProvided ||
      (namaPerusahaanVal !== null && namaPerusahaanVal.length > 0) ||
      (fileTitleSubmissionVal !== null && fileTitleSubmissionVal.length > 0) ||
      (fileTranskripVal !== null && fileTranskripVal.length > 0) ||
      (fileKrsVal !== null && fileKrsVal.length > 0) ||
      (fileMetodologiVal !== null && fileMetodologiVal.length > 0);

    if (!hasMeaningfulUpdate) {
      return res.status(400).json({
        ok: false,
        message: "At least one meaningful field must be provided",
      });
    }

    if (
      pembimbing1Val &&
      pembimbing2Val &&
      pembimbing1Val.length > 0 &&
      pembimbing1Val === pembimbing2Val
    ) {
      return res.status(400).json({
        ok: false,
        message: "Pembimbing 1 and Pembimbing 2 cannot be the same",
      });
    }

    if (
      perluSuratProvided &&
      Boolean(perluSuratPengantar) &&
      (!namaPerusahaanVal || namaPerusahaanVal.length === 0)
    ) {
      return res.status(400).json({
        ok: false,
        message: "namaPerusahaan is required when perluSuratPengantar is true",
      });
    }

    const npm = await getStudentNpm(req.user.id);
    if (!npm) {
      return res.status(400).json({ ok: false, message: "Mahasiswa tidak valid" });
    }

    conn = await db.getConnection();
    await conn.beginTransaction();
    txStarted = true;

    const [rows] = await conn.query(
      `SELECT id, status
       FROM pengajuan_judul
       WHERE id = ? AND npm = ?
       LIMIT 1
       FOR UPDATE`,
      [id, npm]
    );

    if (rows.length === 0) {
      await conn.rollback();
      txStarted = false;
      return res.status(404).json({
        ok: false,
        message: "Title submission not found",
      });
    }

    const currentStatus = String(rows[0].status || "").toUpperCase();
    if (!["REJECTED", "NEED_REVISION"].includes(currentStatus)) {
      await conn.rollback();
      txStarted = false;
      return res.status(409).json({
        ok: false,
        message: "Title submission status is not eligible for resubmit",
      });
    }

    const sets = [];
    const params = [];

    if (noHpVal !== null && noHpVal.length > 0) {
      sets.push("no_hp = ?");
      params.push(noHpVal);
    }
    if (sksVal !== null) {
      sets.push("sks_diperoleh = ?");
      params.push(sksVal);
    }
    if (pembimbing1Val !== null && pembimbing1Val.length > 0) {
      sets.push("pembimbing1_diajukan_nidn = ?");
      params.push(pembimbing1Val);
    }
    if (pembimbing2Val !== null && pembimbing2Val.length > 0) {
      sets.push("pembimbing2_diajukan_nidn = ?");
      params.push(pembimbing2Val);
    }
    if (perluSuratProvided) {
      sets.push("perlu_surat_pengantar = ?");
      params.push(Boolean(perluSuratPengantar) ? 1 : 0);
      if (!Boolean(perluSuratPengantar)) {
        sets.push("nama_perusahaan = NULL");
      }
    }
    if (
      namaPerusahaanVal !== null &&
      namaPerusahaanVal.length > 0 &&
      (!perluSuratProvided || Boolean(perluSuratPengantar))
    ) {
      sets.push("nama_perusahaan = ?");
      params.push(namaPerusahaanVal);
    }
    if (fileTitleSubmissionVal !== null && fileTitleSubmissionVal.length > 0) {
      sets.push("file_pengajuan_judul = ?");
      params.push(fileTitleSubmissionVal);
      if (fileTitleSubmissionNameVal !== null && fileTitleSubmissionNameVal.length > 0) {
        sets.push("file_pengajuan_judul_name = ?");
        params.push(fileTitleSubmissionNameVal);
      }
    }
    if (fileTranskripVal !== null && fileTranskripVal.length > 0) {
      sets.push("file_transkrip = ?");
      params.push(fileTranskripVal);
      if (fileTranskripNameVal !== null && fileTranskripNameVal.length > 0) {
        sets.push("file_transkrip_name = ?");
        params.push(fileTranskripNameVal);
      }
    }
    if (fileKrsVal !== null && fileKrsVal.length > 0) {
      sets.push("file_krs = ?");
      params.push(fileKrsVal);
      if (fileKrsNameVal !== null && fileKrsNameVal.length > 0) {
        sets.push("file_krs_name = ?");
        params.push(fileKrsNameVal);
      }
    }
    if (fileMetodologiVal !== null && fileMetodologiVal.length > 0) {
      sets.push("file_metodologi = ?");
      params.push(fileMetodologiVal);
      if (fileMetodologiNameVal !== null && fileMetodologiNameVal.length > 0) {
        sets.push("file_metodologi_name = ?");
        params.push(fileMetodologiNameVal);
      }
    }

    sets.push("status = 'SUBMITTED'");
    sets.push("submitted_at = CURRENT_TIMESTAMP");
    sets.push("disposisi_at = NULL");
    sets.push("catatan_kaprodi = NULL");
    sets.push("decided_by_user_id = NULL");
    sets.push("pembimbing1_ditetapkan_nidn = NULL");
    sets.push("pembimbing2_ditetapkan_nidn = NULL");
    sets.push("updated_at = CURRENT_TIMESTAMP");

    const sql = `UPDATE pengajuan_judul SET ${sets.join(", ")} WHERE id = ?`;
    params.push(id);
    await conn.query(sql, params);

    await conn.commit();
    txStarted = false;

    return res.json({
      ok: true,
      message: "Title submission resubmitted",
    });
  } catch (err) {
    try {
      if (conn && txStarted) {
        await conn.rollback();
      }
    } catch (_) {}
    next(err);
  } finally {
    if (conn) {
      conn.release();
    }
  }
};
