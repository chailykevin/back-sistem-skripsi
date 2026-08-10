const db = require("../db");

async function getUserRoles(userId) {
  const [roleRows] = await db.query(
    `SELECT DISTINCT r.code
     FROM user_roles ur
     INNER JOIN roles r ON r.id = ur.role_id
     WHERE ur.user_id = ?
       AND ur.is_active = 1
       AND r.is_active = 1`,
    [userId],
  );
  return roleRows.map((row) => row.code);
}

module.exports = { getUserRoles };
