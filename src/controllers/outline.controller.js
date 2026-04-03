const db = require("../db");

exports.create = async (req, res, next) => {
  try {
    if (req.user.userType !== "STUDENT") {
      return res.status(403).json({
        ok: false,
        message: "Only students can upload outline",
      });
    }

    const { judul, latarBelakang, fileOutline, fileOutlineName } = req.body;

    if (!judul || !latarBelakang || !fileOutline) {
      return res.status(400).json({
        ok: false,
        message: "Judul, latar belakang, dan file outline wajib diisi",
      });
    }

    // ambil npm mahasiswa dari user login
    const [users] = await db.query(
      `SELECT npm FROM users WHERE id = ? LIMIT 1`,
      [req.user.id]
    );

    if (users.length === 0 || !users[0].npm) {
      return res.status(400).json({
        ok: false,
        message: "Mahasiswa tidak valid",
      });
    }

    const npm = users[0].npm;

    const programStudiId = req.user?.programStudiId ?? null;
    if (!programStudiId) {
      return res.status(400).json({
        ok: false,
        message: "Program studi tidak valid",
      });
    }

    // cek outline sebelumnya untuk npm ini
    const [existingOutlines] = await db.query(
      `SELECT id, status
       FROM outline
       WHERE npm = ?`,
      [npm]
    );

    // boleh lanjut hanya jika belum pernah submit, atau semua outline lama REJECTED
    const hasNonRejected = existingOutlines.some(
      (outline) => String(outline.status || "").toUpperCase() !== "REJECTED"
    );

    if (hasNonRejected) {
      return res.status(400).json({
        ok: false,
        message: "You have an ongoing outline",
      });
    }

    // insert outline
    const [insertResult] = await db.query(
      `INSERT INTO outline
       (judul, latar_belakang, npm, status, program_studi_id)
       VALUES (?, ?, ?, 'SUBMITTED', ?)`,
      [judul, latarBelakang, npm, programStudiId]
    );

    const outlineId = insertResult?.insertId ?? null;
    if (outlineId) {
      await db.query(
        `INSERT INTO outline_files
         (outline_id, revision_no, file_outline_mahasiswa, file_outline_mahasiswa_name)
         VALUES (?, 1, ?, ?)`,
        [outlineId, fileOutline, fileOutlineName ?? null]
      );
    }

    res.status(201).json({
      ok: true,
      message: "Outline berhasil diupload",
    });
  } catch (err) {
    next(err);
  }
};

// Can getById retrieve max 3 latest outlines?
exports.getById = async (req, res, next) => {
  try {
    const id = Number(req.params.id);
    if (!Number.isFinite(id) || id <= 0) {
      return res.status(400).json({ ok: false, message: "Invalid outline id" });
    }

    // Mahasiswa: harus hanya miliknya
    let studentNpm = null;
    if (req.user.userType === "STUDENT") {
      const [urows] = await db.query(
        `SELECT npm FROM users WHERE id = ? LIMIT 1`,
        [req.user.id]
      );
      studentNpm = urows[0]?.npm ?? null;
      if (!studentNpm) {
        return res.status(400).json({ ok: false, message: "Mahasiswa tidak valid" });
      }
    }

    let rows;
    if (req.user.userType === "STUDENT") {
      const [r] = await db.query(
        `SELECT
           o.id,
           o.judul,
           o.latar_belakang,
           o.npm,
           o.status,
           o.decision_note,
           o.decided_at,
           o.decided_by_user_id,
           o.created_at,
           o.updated_at,
           m.nama AS mahasiswa_nama,
           m.program_studi_id,
           ps.nama AS program_studi_nama,
           ofl.file_outline_mahasiswa,
           ofl.file_outline_mahasiswa_name,
           ofl.file_outline_kaprodi,
           ofl.file_outline_kaprodi_name,
           ofl.revision_no AS file_revision_no,
           ofl.updated_at AS file_updated_at
        FROM outline o
        INNER JOIN mahasiswa m ON m.npm = o.npm
        INNER JOIN program_studi ps ON ps.id = m.program_studi_id
        LEFT JOIN outline_files ofl
          ON ofl.outline_id = o.id
         AND ofl.revision_no = (
           SELECT MAX(revision_no) FROM outline_files WHERE outline_id = o.id
          )
         WHERE o.id = ? AND o.npm = ?
         LIMIT 1`,
        [id, studentNpm]
      );
      rows = r;
    } else {
      // Dosen/Kaprodi: boleh lihat semua (sementara)
      const [r] = await db.query(
        `SELECT
           o.id,
           o.judul,
           o.latar_belakang,
           o.npm,
           o.status,
           o.decision_note,
           o.decided_at,
           o.decided_by_user_id,
           o.created_at,
           o.updated_at,
           m.nama AS mahasiswa_nama,
           m.program_studi_id,
           ps.nama AS program_studi_nama,
           ofl.file_outline_mahasiswa,
           ofl.file_outline_mahasiswa_name,
           ofl.file_outline_kaprodi,
           ofl.file_outline_kaprodi_name,
           ofl.revision_no AS file_revision_no,
           ofl.updated_at AS file_updated_at
        FROM outline o
        INNER JOIN mahasiswa m ON m.npm = o.npm
        INNER JOIN program_studi ps ON ps.id = m.program_studi_id
        LEFT JOIN outline_files ofl
          ON ofl.outline_id = o.id
         AND ofl.revision_no = (
           SELECT MAX(revision_no) FROM outline_files WHERE outline_id = o.id
          )
         WHERE o.id = ?
         LIMIT 1`,
        [id]
      );
      rows = r;
    }

    if (!rows || rows.length === 0) {
      return res.status(404).json({ ok: false, message: "Outline not found" });
    }

    if (req.user.userType === "LECTURER") {
      const [otherRows] = await db.query(
        `SELECT
           id,
           judul,
           status,
           created_at,
           updated_at
         FROM outline
         WHERE npm = ?
           AND id <> ?
           AND status = 'REJECTED'
         ORDER BY created_at DESC`,
        [rows[0].npm, id]
      );

      return res.json({
        ok: true,
        data: rows[0],
        relatedOutlines: otherRows,
      });
    }

    return res.json({ ok: true, data: rows[0] });
  } catch (err) {
    next(err);
  }
};

exports.getLatestMine = async (req, res, next) => {
  try {
    if (req.user.userType !== "STUDENT") {
      return res.status(403).json({
        ok: false,
        message: "Only students can access their latest outline",
      });
    }

    const [urows] = await db.query(
      `SELECT npm FROM users WHERE id = ? LIMIT 1`,
      [req.user.id]
    );
    const npm = urows[0]?.npm ?? null;

    if (!npm) {
      return res.status(400).json({ ok: false, message: "Mahasiswa tidak valid" });
    }

    const [rows] = await db.query(
      `SELECT
         o.id,
         o.judul,
         o.latar_belakang,
         o.npm,
         o.status,
         o.decision_note,
         o.decided_at,
         o.decided_by_user_id,
         o.created_at,
         o.updated_at,
         m.nama AS mahasiswa_nama,
         m.program_studi_id,
         ps.nama AS program_studi_nama,
         ofl.file_outline_mahasiswa,
         ofl.file_outline_mahasiswa_name,
         ofl.file_outline_kaprodi,
         ofl.file_outline_kaprodi_name,
         ofl.revision_no AS file_revision_no,
         ofl.updated_at AS file_updated_at
       FROM outline o
       INNER JOIN mahasiswa m ON m.npm = o.npm
       INNER JOIN program_studi ps ON ps.id = m.program_studi_id
       LEFT JOIN outline_files ofl
         ON ofl.outline_id = o.id
        AND ofl.revision_no = (
          SELECT MAX(revision_no) FROM outline_files WHERE outline_id = o.id
        )
       WHERE o.npm = ?
       ORDER BY o.updated_at DESC
       LIMIT 1`,
      [npm]
    );

    if (!rows || rows.length === 0) {
      return res.json({ ok: true, data: null, message: "Outline not found" });
    }

    return res.json({ ok: true, data: rows[0] });
  } catch (err) {
    next(err);
  }
};

exports.listForKaprodi = async (req, res, next) => {
  try {
    // hanya dosen (LECTURER) yang bisa jadi kaprodi
    if (req.user.userType !== "LECTURER") {
      return res.status(403).json({
        ok: false,
        message: "Only lecturers can access this endpoint",
      });
    }

    // ambil nidn dari user login
    const [urows] = await db.query(
      `SELECT nidn FROM users WHERE id = ? AND is_active = 1 LIMIT 1`,
      [req.user.id]
    );

    const nidn = urows[0]?.nidn ?? null;
    if (!nidn) {
      return res.status(403).json({
        ok: false,
        message: "Lecturer not linked to NIDN",
      });
    }

    // cek apakah dia kaprodi prodi tertentu
    const [prodiRows] = await db.query(
      `SELECT id, nama
       FROM program_studi
       WHERE kaprodi_nidn = ?
       LIMIT 1`,
      [nidn]
    );

    if (prodiRows.length === 0) {
      return res.status(403).json({
        ok: false,
        message: "You are not assigned as Kaprodi",
      });
    }

    const programStudiId = prodiRows[0].id;

    // optional filter
    const status = req.query.status ? String(req.query.status) : null;
    const q = req.query.q ? String(req.query.q) : null;

    const where = [];
    const params = [];

    where.push("m.program_studi_id = ?");
    params.push(programStudiId);

    if (status) {
      where.push("o.status = ?");
      params.push(status);
    }

    if (q) {
      where.push("o.judul LIKE ?");
      params.push(`%${q}%`);
    }

    const whereSql = where.length ? `WHERE ${where.join(" AND ")}` : "";

    // ambil list outline (tanpa file_outline)
    const [rows] = await db.query(
      `SELECT
         o.id,
         o.judul,
         o.status,
         o.created_at,
         o.updated_at,
         o.npm,
         m.nama AS mahasiswa_nama,
         m.program_studi_id
       FROM outline o
       INNER JOIN mahasiswa m ON m.npm = o.npm
       ${whereSql}
       ORDER BY o.created_at DESC`,
      params
    );

    return res.json({
      ok: true,
      data: {
        programStudi: prodiRows[0],
        outlines: rows,
      },
    });
  } catch (err) {
    next(err);
  }
};

exports.reviewByKaprodi = async (req, res, next) => {
  try {
    if (req.user.userType !== "LECTURER") {
      return res.status(403).json({
        ok: false,
        message: "Only lecturers can review outlines",
      });
    }

    const outlineId = Number(req.params.id);
    if (!Number.isFinite(outlineId) || outlineId <= 0) {
      return res.status(400).json({ ok: false, message: "Invalid outline id" });
    }

    const { status, decisionNote, kaprodiFileOutline, kaprodiFileOutlineName } = req.body;

    const allowed = ["SUBMITTED", "NEED_REVISION", "REJECTED", "ACCEPTED"];
    if (!status || !allowed.includes(status)) {
      return res.status(400).json({ ok: false, message: "Invalid status" });
    }

    const note = decisionNote ? String(decisionNote).trim() : "";
    const noteRequired = status === "NEED_REVISION" || status === "REJECTED";
    if (noteRequired && note.length === 0) {
      return res.status(400).json({
        ok: false,
        message: "decisionNote is required for NEED_REVISION or REJECTED",
      });
    }

    const kaprodiFile =
      kaprodiFileOutline !== undefined && kaprodiFileOutline !== null
        ? String(kaprodiFileOutline)
        : null;

    // ambil nidn Kaprodi dari user login
    const [urows] = await db.query(
      `SELECT id, nidn
       FROM users
       WHERE id = ? AND is_active = 1
       LIMIT 1`,
      [req.user.id]
    );

    const lecturerUser = urows[0] || null;
    if (!lecturerUser || !lecturerUser.nidn) {
      return res.status(403).json({
        ok: false,
        message: "Lecturer not linked to NIDN",
      });
    }

    // cek prodi yang dia pimpin
    const [prodiRows] = await db.query(
      `SELECT id
       FROM program_studi
       WHERE kaprodi_nidn = ?
       LIMIT 1`,
      [lecturerUser.nidn]
    );

    if (prodiRows.length === 0) {
      return res.status(403).json({
        ok: false,
        message: "You are not assigned as Kaprodi",
      });
    }

    const programStudiId = prodiRows[0].id;

    // pastikan outline milik mahasiswa di prodi tsb
    const [orows] = await db.query(
      `SELECT o.id
       FROM outline o
       INNER JOIN mahasiswa m ON m.npm = o.npm
       WHERE o.id = ? AND m.program_studi_id = ?
       LIMIT 1`,
      [outlineId, programStudiId]
    );

    if (orows.length === 0) {
      return res.status(404).json({
        ok: false,
        message: "Outline not found",
      });
    }

    // Update review Kaprodi (status + decision fields) + optional file
    if (kaprodiFile) {
      await db.query(
        `UPDATE outline
         SET
           status = ?,
           decision_note = ?,
           decided_at = CURRENT_TIMESTAMP,
           decided_by_user_id = ?,
           program_studi_id = ?
         WHERE id = ?`,
        [
          status,
          note.length ? note : null,
          lecturerUser.id,
          programStudiId,
          outlineId,
        ]
      );

      const [revRows] = await db.query(
        `SELECT revision_no
         FROM outline_files
         WHERE outline_id = ?
         ORDER BY revision_no DESC
         LIMIT 1`,
        [outlineId]
      );
      const revisionNo = revRows[0]?.revision_no ?? null;
      if (revisionNo) {
        await db.query(
          `UPDATE outline_files
           SET
             file_outline_kaprodi = ?,
             file_outline_kaprodi_name = ?
           WHERE outline_id = ? AND revision_no = ?`,
          [kaprodiFile, kaprodiFileOutlineName ?? null, outlineId, revisionNo]
        );
      }
    } else {
      await db.query(
        `UPDATE outline
         SET
           status = ?,
           decision_note = ?,
           decided_at = CURRENT_TIMESTAMP,
           decided_by_user_id = ?,
           program_studi_id = ?
         WHERE id = ?`,
        [status, note.length ? note : null, lecturerUser.id, programStudiId, outlineId]
      );
    }

    return res.json({
      ok: true,
      message: "Outline reviewed",
    });
  } catch (err) {
    next(err);
  }
};

exports.resubmit = async (req, res, next) => {
  const conn = await db.getConnection();
  try {
    await conn.beginTransaction();
    if (req.user.userType !== "STUDENT") {
      return res.status(403).json({
        ok: false,
        message: "Only students can resubmit outlines",
      });
    }

    const outlineId = Number(req.params.id);
    if (!Number.isFinite(outlineId) || outlineId <= 0) {
      return res.status(400).json({ ok: false, message: "Invalid outline id" });
    }

    const { judul, latarBelakang, fileOutline, fileOutlineName } = req.body;

    const judulVal = judul !== undefined ? String(judul).trim() : null;
    const latarVal = latarBelakang !== undefined ? String(latarBelakang).trim() : null;
    const fileVal = fileOutline !== undefined ? String(fileOutline) : null;
    const fileNameVal = fileOutlineName !== undefined ? String(fileOutlineName).trim() : null;

    if (
      (judulVal === null || judulVal.length === 0) &&
      (latarVal === null || latarVal.length === 0) &&
      (fileVal === null || fileVal.length === 0) &&
      (fileNameVal === null || fileNameVal.length === 0)
    ) {
      return res.status(400).json({
        ok: false,
        message: "At least one of judul, latarBelakang, or fileOutline must be provided",
      });
    }

    // ambil npm dari user login
    const [urows] = await conn.query(
      `SELECT npm FROM users WHERE id = ? AND is_active = 1 LIMIT 1`,
      [req.user.id]
    );
    const npm = urows[0]?.npm ?? null;

    if (!npm) {
      return res.status(400).json({
        ok: false,
        message: "Mahasiswa tidak valid",
      });
    }

    const programStudiId = req.user?.programStudiId ?? null;
    if (!programStudiId) {
      return res.status(400).json({
        ok: false,
        message: "Program studi tidak valid",
      });
    }

    // pastikan outline milik mahasiswa ini
    const [orows] = await conn.query(
      `SELECT id
       FROM outline
       WHERE id = ? AND npm = ?
       LIMIT 1`,
      [outlineId, npm]
    );

    if (orows.length === 0) {
      return res.status(404).json({
        ok: false,
        message: "Outline not found",
      });
    }

    // build update dinamis (outline metadata)
    const sets = [];
    const params = [];

    if (judulVal !== null && judulVal.length > 0) {
      sets.push("judul = ?");
      params.push(judulVal);
    }
    if (latarVal !== null && latarVal.length > 0) {
      sets.push("latar_belakang = ?");
      params.push(latarVal);
    }
    // keep program_studi_id in sync
    sets.push("program_studi_id = ?");
    params.push(programStudiId);

    // resubmit => status kembali SUBMITTED
    sets.push("status = 'SUBMITTED'");

    sets.push("decision_note = NULL");
    sets.push("decided_at = NULL");
    sets.push("decided_by_user_id = NULL");

    const sql = `UPDATE outline SET ${sets.join(", ")} WHERE id = ?`;
    params.push(outlineId);

    await conn.query(sql, params);

    if (fileVal !== null && fileVal.length > 0) {
      const [revRows] = await conn.query(
        `SELECT MAX(revision_no) AS max_rev
         FROM outline_files
         WHERE outline_id = ?`,
        [outlineId]
      );
      const nextRev = Number(revRows[0]?.max_rev || 0) + 1;
      await conn.query(
        `INSERT INTO outline_files
         (outline_id, revision_no, file_outline_mahasiswa, file_outline_mahasiswa_name)
         VALUES (?, ?, ?, ?)`,
        [outlineId, nextRev, fileVal, fileNameVal ?? null]
      );

      // keep only latest 3 revisions
      await conn.query(
        `DELETE FROM outline_files
         WHERE outline_id = ?
           AND revision_no NOT IN (
             SELECT revision_no FROM (
               SELECT revision_no
               FROM outline_files
               WHERE outline_id = ?
               ORDER BY revision_no DESC
               LIMIT 3
             ) AS t
           )`,
        [outlineId, outlineId]
      );
    }

    await conn.commit();
    return res.json({
      ok: true,
      message: "Outline resubmitted",
    });
  } catch (err) {
    try {
      await conn.rollback();
    } catch (_) {}
    next(err);
  } finally {
    conn.release();
  }
};
