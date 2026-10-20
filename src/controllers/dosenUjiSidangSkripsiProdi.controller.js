const db = require("../db");
const service = require("../services/dosenUjiSidangSkripsiProdi.service");
const { parsePagination, buildPagination } = require("../utils/pagination");

function parseOptionalPositiveInteger(value) {
  if (value === undefined || value === null || value === "") return null;
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : NaN;
}

function parseRole(value) {
  if (value === undefined || value === null || value === "") return null;
  const role = String(value).trim().toUpperCase();
  return service.PENGUJI_ROLES.includes(role) ? role : NaN;
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

async function getStudentNpm(userId) {
  const [rows] = await db.query(
    `SELECT npm FROM users WHERE id = ? AND is_active = 1 LIMIT 1`,
    [userId],
  );
  return rows[0]?.npm ?? null;
}

async function getLecturerNidn(userId) {
  const [rows] = await db.query(
    `SELECT COALESCE(nidn, staff_usr_id) AS nidn FROM users WHERE id = ? AND is_active = 1 LIMIT 1`,
    [userId],
  );
  return rows[0]?.nidn ?? null;
}

async function getKaprodiProgramStudiIdsByNidn(nidn) {
  const [rows] = await db.query(
    `SELECT id FROM program_studi WHERE COALESCE(kaprodi_nidn, kaprodi_staff_usr_id) = ?`,
    [nidn],
  );
  return rows
    .map((row) => Number(row.id))
    .filter((id) => Number.isFinite(id) && id > 0);
}

async function requireAdminProdi(req, res) {
  if (!req.user.hasRole("ADMIN")) {
    res.status(403).json({
      ok: false,
      message: "Only Admin can manage sidang skripsi examiner eligibility",
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
    return res.status(409).json({
      ok: false,
      message:
        "Dosen is already an eligible examiner for this role and program studi",
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
        message: "Only Admin can manage sidang skripsi examiner eligibility",
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

    const role = parseRole(req.query?.role);

    if (Number.isNaN(homeProgramStudiId) || Number.isNaN(programStudiId)) {
      return res.status(400).json({
        ok: false,
        message: "Program studi filter is invalid",
      });
    }
    if (Number.isNaN(role)) {
      return res.status(400).json({
        ok: false,
        message: "role harus 'PENGUJI_1' atau 'PENGUJI_2'",
      });
    }

    const { dosen, programStudi, totalItems } = await service.getManagementData(
      {
        q,
        homeProgramStudiId,
        programStudiId,
        role,
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
    const role = parseRole(req.query?.role);
    if (Number.isNaN(role)) {
      return res.status(400).json({
        ok: false,
        message: "role harus 'PENGUJI_1' atau 'PENGUJI_2'",
      });
    }
    const data = await service.listByProgramStudiId(programStudiId, { role });
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
    const role = parseRole(req.body?.role);
    if (!role) {
      return res.status(400).json({
        ok: false,
        message: "role harus 'PENGUJI_1' atau 'PENGUJI_2'",
      });
    }
    const [result] = await db.query(
      `INSERT INTO dosen_uji_sidang_skripsi_prodi (dosen_nidn, program_studi_id, role) VALUES (?, ?, ?)`,
      [dosenNidn, programStudiId, role],
    );
    return res.status(201).json({
      ok: true,
      data: {
        idDosenUjiSidangSkripsiProdi: result.insertId,
        dosenNidn,
        programStudiId,
        role,
      },
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
        .json({ ok: false, message: "Invalid examiner eligibility id" });
    }
    if (!dosenNidn)
      return res
        .status(400)
        .json({ ok: false, message: "dosenNidn is required" });
    const role = parseRole(req.body?.role);
    if (Number.isNaN(role)) {
      return res.status(400).json({
        ok: false,
        message: "role harus 'PENGUJI_1' atau 'PENGUJI_2'",
      });
    }
    const [result] = await db.query(
      `UPDATE dosen_uji_sidang_skripsi_prodi SET dosen_nidn = ?, role = COALESCE(?, role)
        WHERE id_dosen_uji_sidang_skripsi_prodi = ? AND program_studi_id = ?`,
      [dosenNidn, role, id, programStudiId],
    );
    if (result.affectedRows === 0) {
      return res
        .status(404)
        .json({ ok: false, message: "Examiner eligibility not found" });
    }
    return res.json({
      ok: true,
      data: { idDosenUjiSidangSkripsiProdi: id, dosenNidn, programStudiId, role },
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
        .json({ ok: false, message: "Invalid examiner eligibility id" });
    }
    const [result] = await db.query(
      `DELETE FROM dosen_uji_sidang_skripsi_prodi
        WHERE id_dosen_uji_sidang_skripsi_prodi = ? AND program_studi_id = ?`,
      [id, programStudiId],
    );
    if (result.affectedRows === 0) {
      return res
        .status(404)
        .json({ ok: false, message: "Examiner eligibility not found" });
    }
    return res.json({ ok: true });
  } catch (err) {
    next(err);
  }
};

exports.listEligible = async (req, res, next) => {
  try {
    const isStudent = req.user.hasRole("STUDENT");
    const isKaprodi = req.user.hasRole("KAPRODI");
    if (!isStudent && !isKaprodi) {
      return res.status(403).json({
        ok: false,
        message: "Only students or Kaprodi can access this endpoint",
      });
    }

    const skripsiId = Number(req.query?.skripsiId);
    if (!Number.isInteger(skripsiId) || skripsiId <= 0) {
      return res
        .status(400)
        .json({ ok: false, message: "skripsiId is required" });
    }

    const [[skripsi]] = await db.query(
      `SELECT npm, program_studi_id, pembimbing1_nidn, pembimbing2_nidn
         FROM skripsi WHERE id = ? LIMIT 1`,
      [skripsiId],
    );
    if (!skripsi) {
      return res
        .status(404)
        .json({ ok: false, message: "Skripsi tidak ditemukan" });
    }

    let allowed = false;
    if (isStudent) {
      const npm = await getStudentNpm(req.user.id);
      allowed = Boolean(npm) && npm === skripsi.npm;
    }
    if (!allowed && isKaprodi) {
      const nidn = await getLecturerNidn(req.user.id);
      const kaprodiProgramStudiIds = nidn
        ? await getKaprodiProgramStudiIdsByNidn(nidn)
        : [];
      allowed = kaprodiProgramStudiIds.includes(
        Number(skripsi.program_studi_id),
      );
    }
    if (!allowed) {
      return res
        .status(403)
        .json({ ok: false, message: "Anda tidak memiliki akses ke skripsi ini" });
    }

    const data = await service.listEligibleByRole(skripsi.program_studi_id, [
      skripsi.pembimbing1_nidn,
      skripsi.pembimbing2_nidn,
    ]);
    return res.json({ ok: true, data });
  } catch (err) {
    next(err);
  }
};
