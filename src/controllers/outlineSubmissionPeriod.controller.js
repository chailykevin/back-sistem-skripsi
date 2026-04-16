const db = require("../db");
const { getOutlineSubmissionPeriodStatus } = require("../services/outlineSubmissionPeriod.service");

function parseDateInput(raw) {
  if (!raw) return null;
  const date = new Date(raw);
  if (Number.isNaN(date.getTime())) return null;
  return date;
}

function toSqlDateTime(date) {
  const pad = (n) => String(n).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(
    date.getHours()
  )}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`;
}

exports.get = async (req, res, next) => {
  try {
    const status = await getOutlineSubmissionPeriodStatus();
    return res.json({
      ok: true,
      data: status.configured
        ? {
            openAt: status.openAt,
            closeAt: status.closeAt,
            isOpenNow: status.isOpenNow,
          }
        : null,
    });
  } catch (err) {
    if (err?.code === "ER_NO_SUCH_TABLE") {
      return res.status(500).json({
        ok: false,
        message: "outline_submission_period table does not exist. Run SQL migration first.",
      });
    }
    return next(err);
  }
};

exports.upsert = async (req, res, next) => {
  try {
    if (!req.user?.hasRole("ADMIN")) {
      return res.status(403).json({
        ok: false,
        message: "Only admin can update outline submission period",
      });
    }

    const openAtRaw = req.body?.openAt;
    const closeAtRaw = req.body?.closeAt;

    const openAt = parseDateInput(openAtRaw);
    const closeAt = parseDateInput(closeAtRaw);

    if (!openAt || !closeAt) {
      return res.status(400).json({
        ok: false,
        message: "openAt and closeAt must be valid datetime values",
      });
    }

    if (closeAt.getTime() < openAt.getTime()) {
      return res.status(400).json({
        ok: false,
        message: "closeAt must be greater than or equal to openAt",
      });
    }

    const openAtSql = toSqlDateTime(openAt);
    const closeAtSql = toSqlDateTime(closeAt);
    const actorUserId = Number(req.user.id) || null;

    await db.query(
      `INSERT INTO outline_submission_period (
         id,
         open_at,
         close_at,
         created_by_user_id,
         updated_by_user_id
       ) VALUES (1, ?, ?, ?, ?)
       ON DUPLICATE KEY UPDATE
         open_at = VALUES(open_at),
         close_at = VALUES(close_at),
         updated_by_user_id = VALUES(updated_by_user_id)`,
      [openAtSql, closeAtSql, actorUserId, actorUserId]
    );

    const status = await getOutlineSubmissionPeriodStatus();
    return res.json({
      ok: true,
      message: "Outline submission period updated",
      data: {
        openAt: status.openAt,
        closeAt: status.closeAt,
        isOpenNow: status.isOpenNow,
      },
    });
  } catch (err) {
    if (err?.code === "ER_NO_SUCH_TABLE") {
      return res.status(500).json({
        ok: false,
        message: "outline_submission_period table does not exist. Run SQL migration first.",
      });
    }
    return next(err);
  }
};
