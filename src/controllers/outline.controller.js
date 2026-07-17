const db = require("../db");
const { insertNotification } = require("../utils/notify");

exports.create = async (req, res, next) => {
  try {
    if (!req.user.hasRole("STUDENT")) {
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

    if (String(judul).trim().length < 5) {
      return res.status(400).json({
        ok: false,
        message: "Judul minimal 5 karakter",
      });
    }

    if (String(judul).trim().length > 255) {
      return res.status(400).json({
        ok: false,
        message: "Judul maksimal 255 karakter",
      });
    }

    if (String(latarBelakang).trim().length > 1500) {
      return res.status(400).json({
        ok: false,
        message: "Latar belakang maksimal 1500 karakter",
      });
    }

    // ambil npm mahasiswa dari user login
    const [users] = await db.query(
      `SELECT npm FROM users WHERE id = ? LIMIT 1`,
      [req.user.id],
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
      [npm],
    );

    // boleh lanjut hanya jika belum pernah submit, atau semua outline lama REJECTED
    const hasNonRejected = existingOutlines.some(
      (outline) => String(outline.status || "").toUpperCase() !== "REJECTED",
    );

    if (hasNonRejected) {
      return res.status(400).json({
        ok: false,
        message: "You have an ongoing outline",
      });
    }

    // block if student has an active IN_PROGRESS skripsi
    const [[activeSkripsi]] = await db.query(
      `SELECT id FROM skripsi WHERE npm = ? AND status = 'IN_PROGRESS' LIMIT 1`,
      [npm],
    );
    if (activeSkripsi) {
      return res.status(409).json({
        ok: false,
        message: "Anda masih memiliki skripsi yang sedang berjalan.",
      });
    }

    const submissionPeriodId = req.openPeriod?.id ?? null;

    const [mahasiswaRows] = await db.query(
      `SELECT m.nama FROM mahasiswa m WHERE m.npm = ? LIMIT 1`,
      [npm],
    );
    const namaMahasiswa = mahasiswaRows[0]?.nama ?? npm;

    const conn = await db.getConnection();
    let txStarted = false;
    try {
      await conn.beginTransaction();
      txStarted = true;

      const [insertResult] = await conn.query(
        `INSERT INTO outline
         (judul, latar_belakang, npm, status, program_studi_id, submission_period_id)
         VALUES (?, ?, ?, 'SUBMITTED', ?, ?)`,
        [judul, latarBelakang, npm, programStudiId, submissionPeriodId],
      );

      const outlineId = insertResult?.insertId ?? null;
      if (outlineId) {
        await conn.query(
          `INSERT INTO outline_submissions
           (outline_id, submission_no, file_content, file_name)
           VALUES (?, 1, ?, ?)`,
          [outlineId, fileOutline, fileOutlineName ?? null],
        );
      }

      const [kaprodiUserRows] = await conn.query(
        `SELECT u.id FROM users u
         JOIN user_roles ur ON ur.user_id = u.id
         JOIN roles r ON r.id = ur.role_id
         JOIN program_studi ps ON ps.kaprodi_nidn = u.nidn
         WHERE r.code = 'KAPRODI' AND ur.program_studi_id = ?
         LIMIT 1`,
        [programStudiId],
      );
      if (kaprodiUserRows[0]?.id) {
        await insertNotification(
          conn,
          kaprodiUserRows[0].id,
          "OUTLINE_SUBMITTED",
          `Mahasiswa ${namaMahasiswa} mengajukan outline baru`,
          "/kaprodi/pengajuan-outline/outlines",
        );
      }

      await conn.commit();
      txStarted = false;
    } catch (err) {
      try {
        if (txStarted) await conn.rollback();
      } catch (_) {}
      throw err;
    } finally {
      conn.release();
    }

    res.status(201).json({
      ok: true,
      message: "Outline berhasil diupload",
    });
  } catch (err) {
    next(err);
  }
};

exports.getById = async (req, res, next) => {
  try {
    const id = Number(req.params.id);
    if (!Number.isFinite(id) || id <= 0) {
      return res.status(400).json({ ok: false, message: "Invalid outline id" });
    }

    // Mahasiswa: harus hanya miliknya
    let studentNpm = null;
    if (req.user.hasRole("STUDENT")) {
      const [urows] = await db.query(
        `SELECT npm FROM users WHERE id = ? LIMIT 1`,
        [req.user.id],
      );
      studentNpm = urows[0]?.npm ?? null;
      if (!studentNpm) {
        return res
          .status(400)
          .json({ ok: false, message: "Mahasiswa tidak valid" });
      }
    }

    let rows;
    if (req.user.hasRole("STUDENT")) {
      const [r] = await db.query(
        `SELECT
           o.id,
           o.judul,
           o.latar_belakang,
           o.npm,
           o.status,
           rev.decision_note,
           o.created_at,
           o.updated_at,
           m.nama AS mahasiswa_nama,
           m.sks AS mahasiswa_sks,
           m.program_studi_id,
           ps.nama AS program_studi_nama,
           sub.file_content AS file_outline_mahasiswa,
           sub.file_name AS file_outline_mahasiswa_name,
           rev.file_content AS file_outline_kaprodi,
           rev.file_name AS file_outline_kaprodi_name,
           sub.submission_no AS file_revision_no,
           sub.submitted_at AS file_updated_at,
           prev_rev.decision_note AS previous_decision_note
         FROM outline o
         INNER JOIN mahasiswa m ON m.npm = o.npm
         INNER JOIN program_studi ps ON ps.id = m.program_studi_id
         LEFT JOIN outline_submissions sub
           ON sub.outline_id = o.id
          AND sub.submission_no = (
            SELECT MAX(submission_no) FROM outline_submissions WHERE outline_id = o.id
          )
         LEFT JOIN outline_reviews rev ON rev.submission_id = sub.id
         LEFT JOIN outline_submissions prev_sub
           ON prev_sub.outline_id = o.id
          AND prev_sub.submission_no = (
            SELECT MAX(submission_no) - 1 FROM outline_submissions WHERE outline_id = o.id
          )
         LEFT JOIN outline_reviews prev_rev ON prev_rev.submission_id = prev_sub.id
         WHERE o.id = ? AND o.npm = ?
         LIMIT 1`,
        [id, studentNpm],
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
           rev.decision_note,
           o.created_at,
           o.updated_at,
           m.nama AS mahasiswa_nama,
           m.sks AS mahasiswa_sks,
           m.program_studi_id,
           ps.nama AS program_studi_nama,
           sub.file_content AS file_outline_mahasiswa,
           sub.file_name AS file_outline_mahasiswa_name,
           rev.file_content AS file_outline_kaprodi,
           rev.file_name AS file_outline_kaprodi_name,
           sub.submission_no AS file_revision_no,
           sub.submitted_at AS file_updated_at,
           prev_rev.decision_note AS previous_decision_note
         FROM outline o
         INNER JOIN mahasiswa m ON m.npm = o.npm
         INNER JOIN program_studi ps ON ps.id = m.program_studi_id
         LEFT JOIN outline_submissions sub
           ON sub.outline_id = o.id
          AND sub.submission_no = (
            SELECT MAX(submission_no) FROM outline_submissions WHERE outline_id = o.id
          )
         LEFT JOIN outline_reviews rev ON rev.submission_id = sub.id
         LEFT JOIN outline_submissions prev_sub
           ON prev_sub.outline_id = o.id
          AND prev_sub.submission_no = (
            SELECT MAX(submission_no) - 1 FROM outline_submissions WHERE outline_id = o.id
          )
         LEFT JOIN outline_reviews prev_rev ON prev_rev.submission_id = prev_sub.id
         WHERE o.id = ?
         LIMIT 1`,
        [id],
      );
      rows = r;
    }

    if (!rows || rows.length === 0) {
      return res.status(404).json({ ok: false, message: "Outline not found" });
    }

    if (req.user.hasRole("LECTURER", "KAPRODI")) {
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
        [rows[0].npm, id],
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
    if (!req.user.hasRole("STUDENT")) {
      return res.status(403).json({
        ok: false,
        message: "Only students can access their latest outline",
      });
    }

    const [urows] = await db.query(
      `SELECT npm FROM users WHERE id = ? LIMIT 1`,
      [req.user.id],
    );
    const npm = urows[0]?.npm ?? null;

    if (!npm) {
      return res
        .status(400)
        .json({ ok: false, message: "Mahasiswa tidak valid" });
    }

    const [rows] = await db.query(
      `SELECT
         o.id,
         o.judul,
         o.latar_belakang,
         o.npm,
         o.status,
         rev.decision_note,
         o.created_at,
         o.updated_at,
         m.nama AS mahasiswa_nama,
         m.sks AS mahasiswa_sks,
         m.program_studi_id,
         ps.nama AS program_studi_nama,
         sub.file_content AS file_outline_mahasiswa,
         sub.file_name AS file_outline_mahasiswa_name,
         rev.file_content AS file_outline_kaprodi,
         rev.file_name AS file_outline_kaprodi_name,
         sub.submission_no AS file_revision_no,
         sub.submitted_at AS file_updated_at
       FROM outline o
       INNER JOIN mahasiswa m ON m.npm = o.npm
       INNER JOIN program_studi ps ON ps.id = m.program_studi_id
       LEFT JOIN outline_submissions sub
         ON sub.outline_id = o.id
        AND sub.submission_no = (
          SELECT MAX(submission_no) FROM outline_submissions WHERE outline_id = o.id
        )
       LEFT JOIN outline_reviews rev ON rev.submission_id = sub.id
       WHERE o.npm = ?
       ORDER BY o.updated_at DESC
       LIMIT 1`,
      [npm],
    );

    if (!rows || rows.length === 0) {
      return res.json({ ok: true, data: null, message: "Outline not found" });
    }

    return res.json({ ok: true, data: rows[0] });
  } catch (err) {
    next(err);
  }
};

exports.getReviewHistory = async (req, res, next) => {
  try {
    const id = Number(req.params.id);
    if (!Number.isFinite(id) || id <= 0) {
      return res.status(400).json({ ok: false, message: "Invalid outline id" });
    }

    // access check
    let targetNpm = null;
    if (req.user.hasRole("STUDENT")) {
      const [urows] = await db.query(
        `SELECT npm FROM users WHERE id = ? LIMIT 1`,
        [req.user.id],
      );
      targetNpm = urows[0]?.npm ?? null;
      if (!targetNpm) {
        return res
          .status(400)
          .json({ ok: false, message: "Mahasiswa tidak valid" });
      }
    }

    if (req.user.hasRole("LECTURER", "KAPRODI")) {
      const [urows] = await db.query(
        `SELECT nidn FROM users WHERE id = ? AND is_active = 1 LIMIT 1`,
        [req.user.id],
      );
      const nidn = urows[0]?.nidn ?? null;
      if (!nidn) {
        return res
          .status(400)
          .json({ ok: false, message: "Dosen tidak valid" });
      }

      const [prodiRows] = await db.query(
        `SELECT id FROM program_studi WHERE kaprodi_nidn = ? LIMIT 1`,
        [nidn],
      );
      if (prodiRows.length === 0) {
        return res.status(403).json({
          ok: false,
          message: "You are not assigned as Kaprodi",
        });
      }

      const [orows] = await db.query(
        `SELECT o.npm
         FROM outline o
         INNER JOIN mahasiswa m ON m.npm = o.npm
         WHERE o.id = ? AND m.program_studi_id = ?
         LIMIT 1`,
        [id, prodiRows[0].id],
      );
      if (orows.length === 0) {
        return res
          .status(404)
          .json({ ok: false, message: "Outline not found" });
      }
      targetNpm = orows[0].npm;
    }

    const [rows] = await db.query(
      `SELECT
         sub.submission_no AS revision_no,
         sub.file_content AS file_outline_mahasiswa,
         sub.file_name AS file_outline_mahasiswa_name,
         rev.file_content AS file_outline_kaprodi,
         rev.file_name AS file_outline_kaprodi_name,
         rev.decision_note,
         sub.submitted_at AS updated_at,
         o.id AS outline_id,
         o.judul,
         o.status
       FROM outline_submissions sub
       INNER JOIN outline o ON o.id = sub.outline_id
       LEFT JOIN outline_reviews rev ON rev.submission_id = sub.id
       WHERE o.id = ?
       ORDER BY sub.submission_no DESC`,
      [id],
    );

    return res.json({ ok: true, data: rows });
  } catch (err) {
    next(err);
  }
};

exports.listForKaprodi = async (req, res, next) => {
  try {
    // hanya dosen (LECTURER) yang bisa jadi kaprodi
    if (!req.user.hasRole("LECTURER", "KAPRODI")) {
      return res.status(403).json({
        ok: false,
        message: "Only lecturers can access this endpoint",
      });
    }

    // ambil nidn dari user login
    const [urows] = await db.query(
      `SELECT nidn FROM users WHERE id = ? AND is_active = 1 LIMIT 1`,
      [req.user.id],
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
      [nidn],
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

    // ambil list outline: hanya latest per mahasiswa
    const [rows] = await db.query(
      `SELECT
         o.id,
         o.judul,
         o.status,
         o.created_at,
         o.updated_at,
         o.npm,
         m.nama AS mahasiswa_nama,
         m.sks AS mahasiswa_sks,
         m.program_studi_id,
         o.submission_period_id,
         osp.tahun_akademik AS period_tahun_akademik,
         osp.periode_akademik AS period_periode_akademik
       FROM outline o
       INNER JOIN mahasiswa m ON m.npm = o.npm
       INNER JOIN (
         SELECT npm, MAX(id) AS max_id
         FROM outline
         GROUP BY npm
       ) latest ON latest.npm = o.npm AND latest.max_id = o.id
       LEFT JOIN outline_submission_period osp ON osp.id = o.submission_period_id
       ${whereSql}
       ORDER BY o.created_at DESC`,
      params,
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
    if (!req.user.hasRole("LECTURER", "KAPRODI")) {
      return res.status(403).json({
        ok: false,
        message: "Only lecturers can review outlines",
      });
    }

    const outlineId = Number(req.params.id);
    if (!Number.isFinite(outlineId) || outlineId <= 0) {
      return res.status(400).json({ ok: false, message: "Invalid outline id" });
    }

    const { status, decisionNote, kaprodiFileOutline, kaprodiFileOutlineName } =
      req.body;

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
      [req.user.id],
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
      [lecturerUser.nidn],
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
      [outlineId, programStudiId],
    );

    if (orows.length === 0) {
      return res.status(404).json({
        ok: false,
        message: "Outline not found",
      });
    }

    await db.query(
      `UPDATE outline SET status = ?, program_studi_id = ? WHERE id = ?`,
      [status, programStudiId, outlineId],
    );

    // find latest submission then upsert review
    const [[latestSub]] = await db.query(
      `SELECT id FROM outline_submissions
       WHERE outline_id = ?
       ORDER BY submission_no DESC
       LIMIT 1`,
      [outlineId],
    );

    if (latestSub) {
      await db.query(
        `INSERT INTO outline_reviews (submission_id, decision_note, file_content, file_name, reviewed_at)
         VALUES (?, ?, ?, ?, NOW())
         ON DUPLICATE KEY UPDATE
           decision_note = VALUES(decision_note),
           file_content  = VALUES(file_content),
           file_name     = VALUES(file_name),
           reviewed_at   = VALUES(reviewed_at)`,
        [
          latestSub.id,
          note.length ? note : null,
          kaprodiFile,
          kaprodiFile ? (kaprodiFileOutlineName ?? null) : null,
        ],
      );
    }

    if (status !== "SUBMITTED") {
      const [oStudentRows] = await db.query(
        `SELECT u.id, m.nama FROM outline o
         JOIN mahasiswa m ON m.npm = o.npm
         JOIN users u ON u.npm = o.npm
         WHERE o.id = ? LIMIT 1`,
        [outlineId],
      );
      const studentUserId = oStudentRows[0]?.id ?? null;
      if (studentUserId) {
        const typeMap = {
          NEED_REVISION: "OUTLINE_NEED_REVISION",
          REJECTED: "OUTLINE_REJECTED",
          ACCEPTED: "OUTLINE_ACCEPTED",
        };
        const msgMap = {
          NEED_REVISION: "Outline Anda memerlukan revisi",
          REJECTED: "Outline Anda ditolak",
          ACCEPTED: "Outline Anda diterima",
        };
        await db.query(
          `INSERT INTO notifications (user_id, type, message, link) VALUES (?, ?, ?, ?)`,
          [
            studentUserId,
            typeMap[status],
            msgMap[status],
            "/student/pengajuan-outline",
          ],
        );
      }
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
    if (!req.user.hasRole("STUDENT")) {
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
    const latarVal =
      latarBelakang !== undefined ? String(latarBelakang).trim() : null;
    const fileVal = fileOutline !== undefined ? String(fileOutline) : null;
    const fileNameVal =
      fileOutlineName !== undefined ? String(fileOutlineName).trim() : null;

    if (
      (judulVal === null || judulVal.length === 0) &&
      (latarVal === null || latarVal.length === 0) &&
      (fileVal === null || fileVal.length === 0) &&
      (fileNameVal === null || fileNameVal.length === 0)
    ) {
      return res.status(400).json({
        ok: false,
        message:
          "At least one of judul, latarBelakang, or fileOutline must be provided",
      });
    }

    if (judulVal !== null && judulVal.length > 0 && judulVal.length < 5) {
      return res.status(400).json({
        ok: false,
        message: "Judul minimal 5 karakter",
      });
    }

    if (judulVal !== null && judulVal.length > 255) {
      return res.status(400).json({
        ok: false,
        message: "Judul maksimal 255 karakter",
      });
    }

    if (latarVal !== null && latarVal.length > 1500) {
      return res.status(400).json({
        ok: false,
        message: "Latar belakang maksimal 1500 karakter",
      });
    }

    // ambil npm dari user login
    const [urows] = await conn.query(
      `SELECT npm FROM users WHERE id = ? AND is_active = 1 LIMIT 1`,
      [req.user.id],
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
      [outlineId, npm],
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

    const sql = `UPDATE outline SET ${sets.join(", ")} WHERE id = ?`;
    params.push(outlineId);

    await conn.query(sql, params);

    if (fileVal !== null && fileVal.length > 0) {
      const [[maxRow]] = await conn.query(
        `SELECT MAX(submission_no) AS max_sub
         FROM outline_submissions
         WHERE outline_id = ?`,
        [outlineId],
      );
      const nextSub = Number(maxRow?.max_sub || 0) + 1;
      await conn.query(
        `INSERT INTO outline_submissions
         (outline_id, submission_no, file_content, file_name)
         VALUES (?, ?, ?, ?)`,
        [outlineId, nextSub, fileVal, fileNameVal ?? null],
      );
    }

    const [mRows] = await conn.query(
      `SELECT m.nama FROM mahasiswa m WHERE m.npm = ? LIMIT 1`,
      [npm],
    );
    const namaMahasiswa = mRows[0]?.nama ?? npm;

    const [kaprodiUserRows] = await conn.query(
      `SELECT u.id FROM users u
       JOIN user_roles ur ON ur.user_id = u.id
       JOIN roles r ON r.id = ur.role_id
       JOIN program_studi ps ON ps.kaprodi_nidn = u.nidn
       WHERE r.code = 'KAPRODI' AND ur.program_studi_id = ?
       LIMIT 1`,
      [programStudiId],
    );
    if (kaprodiUserRows[0]?.id) {
      await insertNotification(
        conn,
        kaprodiUserRows[0].id,
        "OUTLINE_RESUBMITTED",
        `Mahasiswa ${namaMahasiswa} mengajukan ulang outline`,
        "/kaprodi/pengajuan-outline/outlines",
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
