const db = require("../db");

async function getOutlineSubmissionPeriodStatus(queryable = db) {
  const [rows] = await queryable.query(
    `SELECT
       open_at,
       close_at,
       CASE
         WHEN CURRENT_TIMESTAMP >= open_at AND CURRENT_TIMESTAMP <= close_at THEN 1
         ELSE 0
       END AS is_open_now
     FROM outline_submission_period
     WHERE id = 1
     LIMIT 1`
  );

  const row = rows[0] ?? null;
  if (!row) {
    return {
      configured: false,
      isOpenNow: false,
      openAt: null,
      closeAt: null,
    };
  }

  return {
    configured: true,
    isOpenNow: Boolean(row.is_open_now),
    openAt: row.open_at,
    closeAt: row.close_at,
  };
}

module.exports = {
  getOutlineSubmissionPeriodStatus,
};
