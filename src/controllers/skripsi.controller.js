"use strict";
const db = require("../db");

async function getStudentNpm(userId) {
  const [rows] = await db.query(
    `SELECT npm FROM users WHERE id = ? AND is_active = 1 LIMIT 1`,
    [userId],
  );
  return rows[0]?.npm ?? null;
}

async function getLecturerNidn(userId) {
  const [rows] = await db.query(
    `SELECT nidn FROM users WHERE id = ? AND is_active = 1 LIMIT 1`,
    [userId],
  );
  return rows[0]?.nidn ?? null;
}

async function getKaprodiProgramStudiIdsByNidn(nidn) {
  const [rows] = await db.query(
    `SELECT id FROM program_studi WHERE kaprodi_nidn = ?`,
    [nidn],
  );
  return rows.map((r) => Number(r.id)).filter((id) => Number.isFinite(id) && id > 0);
}

const SELECT_COLS = `s.id, s.npm, s.judul, s.status, s.program_studi_id,
  ps.nama AS program_studi_nama,
  s.pembimbing1_nidn, d1.nama AS pembimbing1_nama,
  s.pembimbing2_nidn, d2.nama AS pembimbing2_nama,
  m.nama AS nama_mahasiswa,
  s.completed_at, s.created_at, s.updated_at`;

const SELECT_JOINS = `FROM skripsi s
  LEFT JOIN mahasiswa m ON m.npm = s.npm
  LEFT JOIN program_studi ps ON ps.id = s.program_studi_id
  LEFT JOIN dosen d1 ON d1.nidn = s.pembimbing1_nidn
  LEFT JOIN dosen d2 ON d2.nidn = s.pembimbing2_nidn`;

exports.getMySkripsi = async (req, res, next) => {
  try {
    if (req.user.userType !== "STUDENT") {
      return res.status(403).json({ ok: false, message: "Only students can access this endpoint" });
    }
    const npm = await getStudentNpm(req.user.id);
    if (!npm) return res.status(400).json({ ok: false, message: "Mahasiswa tidak valid" });

    const [rows] = await db.query(
      `SELECT ${SELECT_COLS} ${SELECT_JOINS} WHERE s.npm = ? ORDER BY s.created_at DESC`,
      [npm],
    );
    return res.json({ ok: true, data: rows });
  } catch (err) {
    next(err);
  }
};

exports.getLecturerSkripsi = async (req, res, next) => {
  try {
    if (req.user.userType !== "LECTURER") {
      return res.status(403).json({ ok: false, message: "Only lecturers can access this endpoint" });
    }
    const nidn = await getLecturerNidn(req.user.id);
    if (!nidn) return res.status(400).json({ ok: false, message: "Dosen tidak valid" });

    const [rows] = await db.query(
      `SELECT ${SELECT_COLS} ${SELECT_JOINS}
       WHERE s.pembimbing1_nidn = ? OR s.pembimbing2_nidn = ?
       ORDER BY s.created_at DESC`,
      [nidn, nidn],
    );
    return res.json({ ok: true, data: rows });
  } catch (err) {
    next(err);
  }
};

exports.getKaprodiSkripsi = async (req, res, next) => {
  try {
    if (!req.user.hasRole("KAPRODI")) {
      return res.status(403).json({ ok: false, message: "Only kaprodi can access this endpoint" });
    }
    const nidn = await getLecturerNidn(req.user.id);
    if (!nidn) return res.status(400).json({ ok: false, message: "Dosen tidak valid" });

    const programStudiIds = await getKaprodiProgramStudiIdsByNidn(nidn);
    if (programStudiIds.length === 0) {
      return res.status(403).json({ ok: false, message: "You are not assigned as Kaprodi" });
    }

    const [rows] = await db.query(
      `SELECT ${SELECT_COLS} ${SELECT_JOINS}
       WHERE s.program_studi_id IN (?)
       ORDER BY s.created_at DESC`,
      [programStudiIds],
    );
    return res.json({ ok: true, data: rows });
  } catch (err) {
    next(err);
  }
};

exports.getSekretariatSkripsi = async (req, res, next) => {
  try {
    if (!req.user.hasRole("SEKRETARIAT")) {
      return res.status(403).json({ ok: false, message: "Only sekretariat can access this endpoint" });
    }
    const VALID_STATUSES = ["IN_PROGRESS", "COMPLETED"];
    const statusParam = req.query?.status;
    const filterByStatus = statusParam && VALID_STATUSES.includes(statusParam);

    const [rows] = await db.query(
      `SELECT ${SELECT_COLS} ${SELECT_JOINS}
       ${filterByStatus ? "WHERE s.status = ?" : ""}
       ORDER BY s.created_at DESC`,
      filterByStatus ? [statusParam] : [],
    );
    return res.json({ ok: true, data: rows });
  } catch (err) {
    next(err);
  }
};
