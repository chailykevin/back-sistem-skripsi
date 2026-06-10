const db = require("../db");

function parseDateInput(raw) {
  if (!raw) return null;
  const date = new Date(raw);
  if (Number.isNaN(date.getTime())) return null;
  return date;
}

function toSqlDateTime(date) {
  const pad = (n) => String(n).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`;
}

function isOpenNow(openAt, closeAt) {
  const now = Date.now();
  return now >= new Date(openAt).getTime() && now <= new Date(closeAt).getTime();
}

function formatRow(r) {
  return {
    id: r.id,
    tahunAkademik: r.tahun_akademik,
    periodeAkademik: r.periode_akademik,
    openAt: r.open_at,
    closeAt: r.close_at,
    isOpenNow: isOpenNow(r.open_at, r.close_at),
    createdAt: r.created_at,
    updatedAt: r.updated_at,
  };
}

function validatePeriodFields({ openAt, closeAt, tahunAkademik, periodeAkademik }, requireAll = true) {
  if (requireAll) {
    if (!openAt || !closeAt || !tahunAkademik || !periodeAkademik) {
      return "openAt, closeAt, tahunAkademik, and periodeAkademik are required";
    }
  }

  let openDate, closeDate;
  if (openAt !== undefined) {
    openDate = parseDateInput(openAt);
    if (!openDate) return "openAt must be a valid datetime";
  }
  if (closeAt !== undefined) {
    closeDate = parseDateInput(closeAt);
    if (!closeDate) return "closeAt must be a valid datetime";
  }
  if (openDate && closeDate && closeDate.getTime() < openDate.getTime()) {
    return "closeAt must be greater than or equal to openAt";
  }
  if (periodeAkademik !== undefined && !["GANJIL", "GENAP"].includes(periodeAkademik)) {
    return "periodeAkademik must be GANJIL or GENAP";
  }
  if (tahunAkademik !== undefined) {
    const trimmed = String(tahunAkademik).trim();
    if (!/^\d{4}\/\d{4}$/.test(trimmed)) {
      return 'tahunAkademik must be in format "YYYY/YYYY" (e.g. "2024/2025")';
    }
  }
  return null;
}

exports.list = async (req, res, next) => {
  try {
    const [rows] = await db.query(
      `SELECT id, tahun_akademik, periode_akademik, open_at, close_at, created_at, updated_at
       FROM sidang_submission_period
       ORDER BY open_at DESC`
    );
    return res.json({ ok: true, data: rows.map(formatRow) });
  } catch (err) {
    if (err?.code === "ER_NO_SUCH_TABLE") {
      return res.status(500).json({
        ok: false,
        message: "sidang_submission_period table does not exist. Run SQL migration first.",
      });
    }
    return next(err);
  }
};

exports.create = async (req, res, next) => {
  try {
    if (!req.user?.hasRole("ADMIN")) {
      return res.status(403).json({ ok: false, message: "Only admin can create sidang submission periods" });
    }

    const { openAt, closeAt, tahunAkademik, periodeAkademik } = req.body ?? {};
    const validationError = validatePeriodFields({ openAt, closeAt, tahunAkademik, periodeAkademik }, true);
    if (validationError) {
      return res.status(400).json({ ok: false, message: validationError });
    }

    const actorUserId = Number(req.user.id) || null;
    const [result] = await db.query(
      `INSERT INTO sidang_submission_period
         (tahun_akademik, periode_akademik, open_at, close_at, created_by_user_id, updated_by_user_id)
       VALUES (?, ?, ?, ?, ?, ?)`,
      [
        String(tahunAkademik).trim(),
        periodeAkademik,
        toSqlDateTime(parseDateInput(openAt)),
        toSqlDateTime(parseDateInput(closeAt)),
        actorUserId,
        actorUserId,
      ]
    );

    const [rows] = await db.query(
      `SELECT id, tahun_akademik, periode_akademik, open_at, close_at, created_at, updated_at
       FROM sidang_submission_period WHERE id = ?`,
      [result.insertId]
    );

    return res.status(201).json({ ok: true, message: "Sidang submission period created", data: formatRow(rows[0]) });
  } catch (err) {
    return next(err);
  }
};

exports.getById = async (req, res, next) => {
  try {
    const id = Number(req.params.id);
    if (!Number.isFinite(id) || id <= 0) {
      return res.status(400).json({ ok: false, message: "Invalid id" });
    }

    const [rows] = await db.query(
      `SELECT id, tahun_akademik, periode_akademik, open_at, close_at, created_at, updated_at
       FROM sidang_submission_period WHERE id = ?`,
      [id]
    );
    if (!rows.length) {
      return res.status(404).json({ ok: false, message: "Sidang submission period not found" });
    }
    return res.json({ ok: true, data: formatRow(rows[0]) });
  } catch (err) {
    return next(err);
  }
};

exports.update = async (req, res, next) => {
  try {
    if (!req.user?.hasRole("ADMIN")) {
      return res.status(403).json({ ok: false, message: "Only admin can update sidang submission periods" });
    }

    const id = Number(req.params.id);
    if (!Number.isFinite(id) || id <= 0) {
      return res.status(400).json({ ok: false, message: "Invalid id" });
    }

    const { openAt, closeAt, tahunAkademik, periodeAkademik } = req.body ?? {};
    if (openAt === undefined && closeAt === undefined && tahunAkademik === undefined && periodeAkademik === undefined) {
      return res.status(400).json({ ok: false, message: "At least one field must be provided" });
    }

    const validationError = validatePeriodFields({ openAt, closeAt, tahunAkademik, periodeAkademik }, false);
    if (validationError) {
      return res.status(400).json({ ok: false, message: validationError });
    }

    const [existing] = await db.query(
      `SELECT id, open_at, close_at FROM sidang_submission_period WHERE id = ?`,
      [id]
    );
    if (!existing.length) {
      return res.status(404).json({ ok: false, message: "Sidang submission period not found" });
    }

    // Cross-validate openAt/closeAt when only one is provided
    const resolvedOpen = openAt !== undefined ? parseDateInput(openAt) : new Date(existing[0].open_at);
    const resolvedClose = closeAt !== undefined ? parseDateInput(closeAt) : new Date(existing[0].close_at);
    if (resolvedClose.getTime() < resolvedOpen.getTime()) {
      return res.status(400).json({ ok: false, message: "closeAt must be greater than or equal to openAt" });
    }

    const sets = [];
    const params = [];

    if (tahunAkademik !== undefined) {
      sets.push("tahun_akademik = ?");
      params.push(String(tahunAkademik).trim());
    }
    if (periodeAkademik !== undefined) {
      sets.push("periode_akademik = ?");
      params.push(periodeAkademik);
    }
    sets.push("open_at = ?", "close_at = ?");
    params.push(toSqlDateTime(resolvedOpen), toSqlDateTime(resolvedClose));
    sets.push("updated_by_user_id = ?");
    params.push(Number(req.user.id) || null);
    params.push(id);

    await db.query(`UPDATE sidang_submission_period SET ${sets.join(", ")} WHERE id = ?`, params);

    const [rows] = await db.query(
      `SELECT id, tahun_akademik, periode_akademik, open_at, close_at, created_at, updated_at
       FROM sidang_submission_period WHERE id = ?`,
      [id]
    );
    return res.json({ ok: true, message: "Sidang submission period updated", data: formatRow(rows[0]) });
  } catch (err) {
    return next(err);
  }
};

exports.remove = async (req, res, next) => {
  try {
    if (!req.user?.hasRole("ADMIN")) {
      return res.status(403).json({ ok: false, message: "Only admin can delete sidang submission periods" });
    }

    const id = Number(req.params.id);
    if (!Number.isFinite(id) || id <= 0) {
      return res.status(400).json({ ok: false, message: "Invalid id" });
    }

    const [existing] = await db.query(
      `SELECT id FROM sidang_submission_period WHERE id = ?`,
      [id]
    );
    if (!existing.length) {
      return res.status(404).json({ ok: false, message: "Sidang submission period not found" });
    }

    await db.query(`DELETE FROM sidang_submission_period WHERE id = ?`, [id]);
    return res.json({ ok: true, message: "Sidang submission period deleted" });
  } catch (err) {
    return next(err);
  }
};
