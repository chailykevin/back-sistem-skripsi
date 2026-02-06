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