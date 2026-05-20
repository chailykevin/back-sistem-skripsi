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

const SELECT_COLS = `id, npm, judul, status, program_studi_id, program_studi_nama,
  pembimbing1_nidn, pembimbing1_nama, pembimbing2_nidn, pembimbing2_nama,
  nama_mahasiswa, completed_at, created_at, updated_at`;

exports.getMySkripsi = async (req, res, next) => {
  try {
    if (req.user.userType !== "STUDENT") {
      return res.status(403).json({ ok: false, message: "Only students can access this endpoint" });
    }
    const npm = await getStudentNpm(req.user.id);
    if (!npm) return res.status(400).json({ ok: false, message: "Mahasiswa tidak valid" });

    const [rows] = await db.query(
      `SELECT ${SELECT_COLS} FROM skripsi WHERE npm = ? ORDER BY created_at DESC`,
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
      `SELECT ${SELECT_COLS} FROM skripsi
       WHERE pembimbing1_nidn = ? OR pembimbing2_nidn = ?
       ORDER BY created_at DESC`,
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
      `SELECT ${SELECT_COLS} FROM skripsi
       WHERE program_studi_id IN (?)
       ORDER BY created_at DESC`,
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
      `SELECT ${SELECT_COLS} FROM skripsi
       ${filterByStatus ? "WHERE status = ?" : ""}
       ORDER BY created_at DESC`,
      filterByStatus ? [statusParam] : [],
    );
    return res.json({ ok: true, data: rows });
  } catch (err) {
    next(err);
  }
};
