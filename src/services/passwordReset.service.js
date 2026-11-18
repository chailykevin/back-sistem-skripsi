const crypto = require("crypto");
const db = require("../db");
const { CustomError } = require("../errors/customError");
const { generateToken, hashToken } = require("../utils/token");
const {
  sendPasswordResetOtpEmail,
  sendPasswordChangedEmail,
} = require("../utils/email");
const {
  CONTACT_IT,
  validateNewPassword,
  resolveAccount,
  verifyCurrentPassword,
  writePassword,
} = require("./simikoPassword.service");
const { clearSessionState } = require("./authSession.service");

const OTP_TTL_MINUTES = 10;
const RESET_TOKEN_TTL_MINUTES = 10;
const OTP_MAX_ATTEMPTS = 5;
const RESEND_COOLDOWN_SECONDS = 60;
const MAX_OTPS_PER_USER_PER_HOUR = 5;
const MAX_OTPS_PER_IP_PER_HOUR = 20;

const fail = (status, message, extra = {}) =>
  new CustomError(status, { ok: false, message, ...extra });

// Keyed by the user so the same 6 digits never hash the same for two accounts, and by a server
// secret so a leaked table can't be brute-forced offline in a million guesses.
function hashOtp(userId, otp) {
  const secret = process.env.OTP_SECRET || process.env.JWT_SECRET;
  return crypto
    .createHmac("sha256", secret)
    .update(`${userId}:${otp}`)
    .digest("hex");
}

function maskEmail(email) {
  const [local, domain] = String(email).split("@");
  if (!domain) return email;
  const visible =
    local.length <= 2
      ? local[0]
      : `${local[0]}${"*".repeat(Math.max(local.length - 2, 1))}${local[local.length - 1]}`;
  return `${visible}@${domain}`;
}

// Turns a resolved account into the error a reset request should get, if any.
function assertResettable(account) {
  if (account.status === "NOT_FOUND") {
    throw fail(404, "Username tidak ditemukan.");
  }
  if (account.status === "DISABLED") {
    throw fail(403, "Akun Anda dinonaktifkan. Silakan hubungi IT.");
  }
  if (account.resetBlock || !account.sourceId || !account.email) {
    throw fail(400, account.resetBlock || CONTACT_IT);
  }
}

async function logChange(conn, account, method, ip) {
  await conn.query(
    `INSERT INTO password_change_log (user_id, username, account_type, method, request_ip)
     VALUES (?, ?, ?, ?, ?)`,
    [account.userId, account.username, account.kind, method, ip ?? null],
  );
}

async function notifyChanged(account, method) {
  if (!account.email) return;
  try {
    await sendPasswordChangedEmail({
      to: account.email,
      recipientName: account.nama,
      method,
    });
  } catch (err) {
    console.error("Failed to send password changed email:", err);
  }
}

async function requestOtp(username, ip) {
  const account = await resolveAccount(db, username);
  assertResettable(account);

  const [[limits]] = await db.query(
    `SELECT
       (SELECT GREATEST(0, ? - TIMESTAMPDIFF(SECOND, MAX(created_at), NOW()))
          FROM password_reset_otps WHERE user_id = ?) AS wait_seconds,
       (SELECT COUNT(*) FROM password_reset_otps
          WHERE user_id = ? AND created_at > NOW() - INTERVAL 1 HOUR) AS user_count,
       (SELECT COUNT(*) FROM password_reset_otps
          WHERE request_ip = ? AND created_at > NOW() - INTERVAL 1 HOUR) AS ip_count`,
    [RESEND_COOLDOWN_SECONDS, account.userId, account.userId, ip ?? ""],
  );
  const waitSeconds = Number(limits.wait_seconds ?? 0);
  if (waitSeconds > 0) {
    throw fail(
      429,
      `Tunggu ${waitSeconds} detik sebelum meminta kode baru.`,
      { retryAfterSeconds: waitSeconds },
    );
  }
  if (
    Number(limits.user_count) >= MAX_OTPS_PER_USER_PER_HOUR ||
    Number(limits.ip_count) >= MAX_OTPS_PER_IP_PER_HOUR
  ) {
    throw fail(
      429,
      "Terlalu banyak permintaan kode. Silakan coba lagi dalam 1 jam.",
    );
  }

  const otp = String(crypto.randomInt(0, 1_000_000)).padStart(6, "0");

  // Only the newest code is valid.
  await db.query(
    `UPDATE password_reset_otps SET used_at = NOW()
     WHERE user_id = ? AND used_at IS NULL`,
    [account.userId],
  );
  const [insert] = await db.query(
    `INSERT INTO password_reset_otps (user_id, email, otp_hash, expires_at, request_ip)
     VALUES (?, ?, ?, NOW() + INTERVAL ? MINUTE, ?)`,
    [account.userId, account.email, hashOtp(account.userId, otp), OTP_TTL_MINUTES, ip ?? null],
  );

  try {
    await sendPasswordResetOtpEmail({
      to: account.email,
      otp,
      recipientName: account.nama,
      expiresInMinutes: OTP_TTL_MINUTES,
    });
  } catch (err) {
    console.error("Failed to send password reset OTP:", err);
    // An unsent code must not count towards the cooldown or the hourly limit.
    await db.query(`DELETE FROM password_reset_otps WHERE id = ?`, [insert.insertId]);
    throw fail(502, "Gagal mengirim email kode. Silakan coba lagi nanti.");
  }

  return {
    maskedEmail: maskEmail(account.email),
    expiresInSeconds: OTP_TTL_MINUTES * 60,
    resendAfterSeconds: RESEND_COOLDOWN_SECONDS,
  };
}

async function verifyOtp(username, otp) {
  const code = String(otp ?? "").trim();
  if (!/^\d{6}$/.test(code)) {
    throw fail(400, "Kode OTP harus 6 digit angka.");
  }

  const account = await resolveAccount(db, username);
  assertResettable(account);

  const conn = await db.getConnection();
  let txStarted = false;
  try {
    await conn.beginTransaction();
    txStarted = true;

    const [rows] = await conn.query(
      `SELECT id, otp_hash, attempts, expires_at > NOW() AS is_fresh
       FROM password_reset_otps
       WHERE user_id = ? AND used_at IS NULL AND verified_at IS NULL
       ORDER BY id DESC LIMIT 1
       FOR UPDATE`,
      [account.userId],
    );
    const row = rows[0];
    if (!row || !Number(row.is_fresh)) {
      throw fail(400, "Kode OTP tidak valid atau sudah kedaluwarsa. Silakan minta kode baru.");
    }
    if (Number(row.attempts) >= OTP_MAX_ATTEMPTS) {
      throw fail(400, "Terlalu banyak percobaan. Silakan minta kode baru.");
    }

    const matches = crypto.timingSafeEqual(
      Buffer.from(row.otp_hash, "hex"),
      Buffer.from(hashOtp(account.userId, code), "hex"),
    );

    if (!matches) {
      const attempts = Number(row.attempts) + 1;
      await conn.query(
        `UPDATE password_reset_otps SET attempts = ? WHERE id = ?`,
        [attempts, row.id],
      );
      await conn.commit();
      txStarted = false;
      const left = OTP_MAX_ATTEMPTS - attempts;
      throw fail(
        400,
        left > 0
          ? `Kode OTP salah. Sisa percobaan: ${left}.`
          : "Kode OTP salah. Batas percobaan habis, silakan minta kode baru.",
      );
    }

    const resetToken = generateToken();
    await conn.query(
      `UPDATE password_reset_otps
       SET verified_at = NOW(), reset_token_hash = ?,
           reset_token_expires_at = NOW() + INTERVAL ? MINUTE
       WHERE id = ?`,
      [hashToken(resetToken), RESET_TOKEN_TTL_MINUTES, row.id],
    );
    await conn.commit();
    txStarted = false;

    return { resetToken, expiresInSeconds: RESET_TOKEN_TTL_MINUTES * 60 };
  } catch (err) {
    try {
      if (txStarted) await conn.rollback();
    } catch (_) {}
    throw err;
  } finally {
    conn.release();
  }
}

async function resetPassword(resetToken, newPassword, confirmPassword, ip) {
  if (typeof resetToken !== "string" || !resetToken) {
    throw fail(400, "Sesi atur ulang kata sandi tidak valid. Silakan ulangi dari awal.");
  }
  const invalid = validateNewPassword(newPassword, confirmPassword);
  if (invalid) throw fail(400, invalid);

  const conn = await db.getConnection();
  let txStarted = false;
  let account;
  try {
    await conn.beginTransaction();
    txStarted = true;

    const [rows] = await conn.query(
      `SELECT o.id, u.username
       FROM password_reset_otps o
       JOIN users u ON u.id = o.user_id
       WHERE o.reset_token_hash = ? AND o.used_at IS NULL
         AND o.reset_token_expires_at > NOW()
       LIMIT 1
       FOR UPDATE`,
      [hashToken(resetToken)],
    );
    const row = rows[0];
    if (!row) {
      throw fail(400, "Sesi atur ulang kata sandi sudah kedaluwarsa. Silakan ulangi dari awal.");
    }

    account = await resolveAccount(conn, row.username);
    assertResettable(account);

    if (!(await writePassword(conn, account, newPassword))) {
      throw fail(400, CONTACT_IT);
    }
    await conn.query(`UPDATE users SET password_changed_at = NOW() WHERE id = ?`, [
      account.userId,
    ]);
    await conn.query(`UPDATE password_reset_otps SET used_at = NOW() WHERE id = ?`, [
      row.id,
    ]);
    await logChange(conn, account, "RESET", ip);

    await conn.commit();
    txStarted = false;
  } catch (err) {
    try {
      if (txStarted) await conn.rollback();
    } catch (_) {}
    throw err;
  } finally {
    conn.release();
  }

  clearSessionState(account.userId);
  await notifyChanged(account, "RESET");

  return { message: "Kata sandi berhasil diubah. Silakan login dengan kata sandi baru." };
}

// Returns the account so the caller can issue a fresh token for the current device.
async function changePassword(userId, currentPassword, newPassword, confirmPassword, ip) {
  if (typeof currentPassword !== "string" || !currentPassword) {
    throw fail(400, "Kata sandi saat ini wajib diisi.");
  }
  const invalid = validateNewPassword(newPassword, confirmPassword);
  if (invalid) throw fail(400, invalid);

  const [users] = await db.query(`SELECT username FROM users WHERE id = ? LIMIT 1`, [
    userId,
  ]);
  if (!users[0]) throw fail(401, "Unauthorized");

  const account = await resolveAccount(db, users[0].username);
  if (account.status !== "FOUND") throw fail(401, "Unauthorized");
  if (!account.sourceId) throw fail(400, CONTACT_IT);

  if (!(await verifyCurrentPassword(db, account, currentPassword))) {
    throw fail(400, "Kata sandi saat ini salah.");
  }
  if (currentPassword.trim() === newPassword) {
    throw fail(400, "Kata sandi baru harus berbeda dari kata sandi saat ini.");
  }

  const conn = await db.getConnection();
  let txStarted = false;
  try {
    await conn.beginTransaction();
    txStarted = true;

    if (!(await writePassword(conn, account, newPassword))) {
      throw fail(400, CONTACT_IT);
    }
    await conn.query(`UPDATE users SET password_changed_at = NOW() WHERE id = ?`, [
      account.userId,
    ]);
    await logChange(conn, account, "CHANGE", ip);

    await conn.commit();
    txStarted = false;
  } catch (err) {
    try {
      if (txStarted) await conn.rollback();
    } catch (_) {}
    throw err;
  } finally {
    conn.release();
  }

  clearSessionState(account.userId);
  await notifyChanged(account, "CHANGE");
  return account;
}

module.exports = { requestOtp, verifyOtp, resetPassword, changePassword };
