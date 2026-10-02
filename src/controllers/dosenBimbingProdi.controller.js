const db = require("../db");
const service = require("../services/dosenBimbingProdi.service");
const { parsePagination, buildPagination } = require("../utils/pagination");

function parseOptionalPositiveInteger(value) {
  if (value === undefined || value === null || value === "") return null;
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : NaN;
}

function getRequestedProgramStudiId(req) {
  const raw =
    req.params?.programStudiId ??
    req.body?.programStudiId ??
    req.query?.programStudiId;
  const id = Number(raw);
  return Number.isInteger(id) && id > 0 ? id : null;
}

async function programStudiExists(programStudiId) {
  const [rows] = await db.query(
    `SELECT id FROM program_studi WHERE id = ? LIMIT 1`,
    [programStudiId],
  );
  return rows.length > 0;
}

async function requireAdminProdi(req, res) {
  if (!req.user.hasRole("ADMIN")) {
    res.status(403).json({
      ok: false,
      message: "Only Admin can manage supervisor eligibility",
    });
    return null;
  }

  const requestedProgramStudiId = getRequestedProgramStudiId(req);
  if (!requestedProgramStudiId) {
    res.status(400).json({ ok: false, message: "programStudiId is required" });
    return null;
  }
  if (!(await programStudiExists(requestedProgramStudiId))) {
    res.status(404).json({ ok: false, message: "Program studi not found" });
    return null;
  }
  return requestedProgramStudiId;
}

function handleWriteError(err, res, next) {
  if (err.code === "ER_DUP_ENTRY") {
    return res
      .status(409)
      .json({
        ok: false,
        message: "Dosen is already eligible for this program studi",
      });
  }
  if (err.code === "ER_NO_REFERENCED_ROW_2") {
    return res.status(400).json({ ok: false, message: "Dosen tidak valid" });
  }
  return next(err);
}

exports.listAll = async (req, res, next) => {
  try {
    if (!req.user.hasRole("ADMIN")) {
      return res.status(403).json({
        ok: false,
        message: "Only Admin can manage supervisor eligibility",
      });
    }
    const pagination = parsePagination(req.query);
    const q = String(req.query?.q ?? "").trim() || null;
    const homeProgramStudiId = parseOptionalPositiveInteger(
      req.query?.homeProgramStudiId,
    );
    const programStudiId = parseOptionalPositiveInteger(
      req.query?.programStudiId,
    );

    if (Number.isNaN(homeProgramStudiId) || Number.isNaN(programStudiId)) {
      return res.status(400).json({
        ok: false,
        message: "Program studi filter is invalid",
      });
    }

    const { dosen, programStudi, totalItems } = await service.getManagementData(
      {
        q,
        homeProgramStudiId,
        programStudiId,
        limit: pagination.limit,
        offset: pagination.offset,
      },
    );

    return res.json({
      ok: true,
      data: { dosen, programStudi },
      pagination: buildPagination({ ...pagination, totalItems }),
    });
  } catch (err) {
    next(err);
  }
};

exports.listByProgramStudi = async (req, res, next) => {
  try {
    const programStudiId = await requireAdminProdi(req, res);
    if (!programStudiId) return;
    const data = await service.listByProgramStudiId(programStudiId);
    return res.json({ ok: true, data });
  } catch (err) {
    next(err);
  }
};

exports.add = async (req, res, next) => {
  try {
    const programStudiId = await requireAdminProdi(req, res);
    if (!programStudiId) return;
    const dosenNidn = String(req.body?.dosenNidn ?? "").trim();
    if (!dosenNidn)
      return res
        .status(400)
        .json({ ok: false, message: "dosenNidn is required" });
    const [result] = await db.query(
      `INSERT INTO dosen_bimbing_prodi (dosen_nidn, program_studi_id) VALUES (?, ?)`,
      [dosenNidn, programStudiId],
    );
    return res.status(201).json({
      ok: true,
      data: { idDosenBimbingProdi: result.insertId, dosenNidn, programStudiId },
    });
  } catch (err) {
    return handleWriteError(err, res, next);
  }
};

exports.update = async (req, res, next) => {
  try {
    const programStudiId = await requireAdminProdi(req, res);
    if (!programStudiId) return;
    const id = Number(req.params.id);
    const dosenNidn = String(req.body?.dosenNidn ?? "").trim();
    if (!Number.isInteger(id) || id <= 0) {
      return res
        .status(400)
        .json({ ok: false, message: "Invalid supervisor eligibility id" });
    }
    if (!dosenNidn)
      return res
        .status(400)
        .json({ ok: false, message: "dosenNidn is required" });
    const [result] = await db.query(
      `UPDATE dosen_bimbing_prodi SET dosen_nidn = ?
        WHERE id_dosen_bimbing_prodi = ? AND program_studi_id = ?`,
      [dosenNidn, id, programStudiId],
    );
    if (result.affectedRows === 0) {
      return res
        .status(404)
        .json({ ok: false, message: "Supervisor eligibility not found" });
    }
    return res.json({
      ok: true,
      data: { idDosenBimbingProdi: id, dosenNidn, programStudiId },
    });
  } catch (err) {
    return handleWriteError(err, res, next);
  }
};

exports.remove = async (req, res, next) => {
  try {
    const programStudiId = await requireAdminProdi(req, res);
    if (!programStudiId) return;
    const id = Number(req.params.id);
    if (!Number.isInteger(id) || id <= 0) {
      return res
        .status(400)
        .json({ ok: false, message: "Invalid supervisor eligibility id" });
    }
    const [result] = await db.query(
      `DELETE FROM dosen_bimbing_prodi
        WHERE id_dosen_bimbing_prodi = ? AND program_studi_id = ?`,
      [id, programStudiId],
    );
    if (result.affectedRows === 0) {
      return res
        .status(404)
        .json({ ok: false, message: "Supervisor eligibility not found" });
    }
    return res.json({ ok: true });
  } catch (err) {
    next(err);
  }
};

exports.listForStudent = async (req, res, next) => {
  try {
    if (!req.user.hasRole("STUDENT")) {
      return res
        .status(403)
        .json({ ok: false, message: "Only students can access this endpoint" });
    }
    const programStudiId = req.user.programStudiId;
    if (!programStudiId) {
      return res
        .status(400)
        .json({ ok: false, message: "Program studi tidak valid" });
    }
    const data = await service.listByProgramStudiId(programStudiId);
    return res.json({ ok: true, data });
  } catch (err) {
    next(err);
  }
};
