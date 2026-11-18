const db = require("../db");

// The auth middleware runs on every request; caching the account state for a minute keeps that
// to one small query per user per minute on the small pool. A password change in this process
// clears its entry at once; other instances catch up within the TTL.
const CACHE_TTL_MS = 60 * 1000;
const cache = new Map();

async function getSessionState(userId) {
  const key = String(userId);
  const cached = cache.get(key);
  if (cached && cached.expiresAt > Date.now()) return cached.state;

  const [rows] = await db.query(
    `SELECT is_active, UNIX_TIMESTAMP(password_changed_at) AS password_changed_unix
     FROM users WHERE id = ? LIMIT 1`,
    [userId],
  );
  const row = rows[0];
  const state = row
    ? {
        isActive: Number(row.is_active) === 1,
        passwordChangedUnix:
          row.password_changed_unix == null
            ? null
            : Math.floor(Number(row.password_changed_unix)),
      }
    : null;

  cache.set(key, { state, expiresAt: Date.now() + CACHE_TTL_MS });
  return state;
}

function clearSessionState(userId) {
  cache.delete(String(userId));
}

module.exports = { getSessionState, clearSessionState };
