const db = require("../db");

exports.create = async (req, res, next) => {
  try {
    // hanya mahasiswa
    if (req.user.userType !== "STUDENT") {
      return res.status(403).json({
        ok: false,
        message: "Only students can upload outline",
      });
    }

    const { judul, latarBelakang, fileOutline } = req.body;

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

    // insert outline
    await db.query(
      `INSERT INTO outline
       (judul, latar_belakang, file_outline, npm, status)
       VALUES (?, ?, ?, ?, 'SUBMITTED')`,
      [judul, latarBelakang, fileOutline, npm]
    );

    res.status(201).json({
      ok: true,
      message: "Outline berhasil diupload",
    });
  } catch (err) {
    next(err);
  }
};

exports.listMine = async (req, res, next) => {
  try {
    if (req.user.userType !== "STUDENT") {
      return res.status(403).json({
        ok: false,
        message: "Only students can access their outlines",
      });
    }

    // ambil npm dari user login
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

    // ambil list outline (tanpa file_outline)
    const [rows] = await db.query(
      `SELECT 
         id,
         judul,
         status,
         created_at,
         updated_at
       FROM outline
       WHERE npm = ?
       ORDER BY created_at DESC`,
      [npm]
    );

    res.json({
      ok: true,
      data: rows,
    });
  } catch (err) {
    next(err);
  }
};

exports.getById = async (req, res, next) => {
  try {
    const id = Number(req.params.id);
    if (!Number.isFinite(id) || id <= 0) {
      return res.status(400).json({
        ok: false,
        message: "Invalid outline id",
      });
    }

    // Ambil user context (npm jika mahasiswa)
    let studentNpm = null;
    if (req.user.userType === "STUDENT") {
      const [urows] = await db.query(
        `SELECT npm FROM users WHERE id = ? LIMIT 1`,
        [req.user.id]
      );
      studentNpm = urows[0]?.npm ?? null;

      if (!studentNpm) {
        return res.status(400).json({
          ok: false,
          message: "Mahasiswa tidak valid",
        });
      }
    }

    // Query outline
    // - Mahasiswa: wajib cocok npm
    // - Dosen: bebas (sementara)
    let rows;
    if (req.user.userType === "STUDENT") {
      const [r] = await db.query(
        `SELECT 
           id,
           judul,
           latar_belakang,
           file_outline,
           npm,
           status,
           created_at,
           updated_at
         FROM outline
         WHERE id = ? AND npm = ?
         LIMIT 1`,
        [id, studentNpm]
      );
      rows = r;
    } else {
      const [r] = await db.query(
        `SELECT 
           id,
           judul,
           latar_belakang,
           file_outline,
           npm,
           status,
           created_at,
           updated_at
         FROM outline
         WHERE id = ?
         LIMIT 1`,
        [id]
      );
      rows = r;
    }

    if (!rows || rows.length === 0) {
      return res.status(404).json({
        ok: false,
        message: "Outline not found",
      });
    }

    const outline = rows[0];

    return res.json({
      ok: true,
      data: outline,
    });
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

    const { status, decisionNote, kaprodiFileOutline } = req.body;

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
           kaprodi_file_outline = ?,
           kaprodi_file_uploaded_at = CURRENT_TIMESTAMP,
           kaprodi_file_uploaded_by_user_id = ?
         WHERE id = ?`,
        [
          status,
          note.length ? note : null,
          lecturerUser.id,
          kaprodiFile,
          lecturerUser.id,
          outlineId,
        ]
      );
    } else {
      await db.query(
        `UPDATE outline
         SET
           status = ?,
           decision_note = ?,
           decided_at = CURRENT_TIMESTAMP,
           decided_by_user_id = ?
         WHERE id = ?`,
        [status, note.length ? note : null, lecturerUser.id, outlineId]
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
