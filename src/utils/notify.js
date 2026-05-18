async function insertNotification(conn, userId, type, message, link) {
  if (!userId) return;
  await conn.query(
    `INSERT INTO notifications (user_id, type, message, link) VALUES (?, ?, ?, ?)`,
    [userId, type, message, link]
  );
}

module.exports = { insertNotification };
