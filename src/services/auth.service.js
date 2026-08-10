const jwt = require("jsonwebtoken");
const bcrypt = require("bcrypt");
const db = require("../db"); // mysql2 pool
const {
  sendPasswordResetEmail,
  sendEmailVerificationEmail,
} = require("../utils/email");
const { generateToken, hashToken } = require("../utils/token");
const { getUserRoles } = require("./userRoles.service");
const { resolveResetEmail } = require("./passwordReset.service");
const { CustomError } = require("../errors/customError");

const NO_EMAIL_MESSAGE =
  "Email tidak ditemukan atau belum terverifikasi untuk akun ini. Silakan hubungi IT.";
const RESET_TOKEN_TTL_MS = 60 * 60 * 1000; // 1 hour

function deriveLegacyUserType(roles = []) {
  if (roles.includes("STUDENT")) return "STUDENT";
  if (roles.includes("LECTURER") || roles.includes("KAPRODI"))
    return "LECTURER";
  return roles[0] ?? null;
}

async function login(username, password) {
  const [users] = await db.query(
    `SELECT * FROM users WHERE username = ? AND is_active = 1 LIMIT 1`,
    [username],
  );

  if (users.length === 0) {
    throw new CustomError(401, {
      ok: false,
      message: "Invalid username or password",
    });
  }

  const user = users[0];

  const isMatch = await bcrypt.compare(password, user.password_hash);
  if (!isMatch) {
    throw new CustomError(401, {
      ok: false,
      message: "Invalid username or password",
    });
  }

  const roles = await getUserRoles(user.id);
  const legacyUserType = deriveLegacyUserType(roles);

  // Ambil profil sesuai role (bukan users.user_type)
  let profile = null;

  if (roles.includes("STUDENT")) {
    const [rows] = await db.query(
      `SELECT npm, nama FROM mahasiswa WHERE npm = ? LIMIT 1`,
      [user.npm],
    );
    profile = rows[0] || null;
  }

  if (!profile && (roles.includes("LECTURER") || roles.includes("KAPRODI"))) {
    const [rows] = await db.query(
      `SELECT nidn, nama FROM dosen WHERE nidn = ? LIMIT 1`,
      [user.nidn],
    );
    profile = rows[0] || null;
  }

  const token = jwt.sign(
    {
      sub: String(user.id),
      roles,
      userType: legacyUserType,
    },
    process.env.JWT_SECRET,
    { expiresIn: process.env.JWT_EXPIRES_IN ?? "7d" },
  );

  return {
    token,
    user: {
      id: user.id,
      username: user.username,
      userType: legacyUserType,
      roles,
      profile,
    },
  };
}

async function getUserInformation(userId) {
  const [rows] = await db.query(
    `SELECT id, username, npm, nidn, is_active
           FROM users
           WHERE id = ? AND is_active = 1
           LIMIT 1`,
    [userId],
  );

  if (rows.length === 0) {
    throw new CustomError(401, {
      ok: false,
      message: "Unauthorized",
    });
  }

  const user = rows[0];
  const roles = await getUserRoles(user.id);
  const legacyUserType = deriveLegacyUserType(roles);

  let profile = null;
  if (roles.includes("STUDENT")) {
    const [p] = await db.query(
      `SELECT npm, mahasiswa.nama, mahasiswa.sks, program_studi.nama as programStudi FROM mahasiswa LEFT JOIN program_studi ON mahasiswa.program_studi_id = program_studi.id WHERE npm = ? LIMIT 1`,
      [user.npm],
    );
    profile = p[0] || null;
  }

  if (
    !profile &&
    user.nidn &&
    (roles.includes("LECTURER") ||
      roles.includes("KAPRODI") ||
      roles.includes("DEKAN") ||
      roles.includes("SEKPRODI") ||
      roles.includes("SEKRETARIAT"))
  ) {
    const [p] = await db.query(
      `SELECT nidn, nama FROM dosen WHERE nidn = ? LIMIT 1`,
      [user.nidn],
    );
    profile = p[0] || null;
  }

  return {
    id: user.id,
    username: user.username,
    userType: legacyUserType,
    roles,
    profile,
  };
}

async function forgotPassword(username) {
  const [users] = await db.query(
    `SELECT id, npm, nidn, email FROM users WHERE username = ? AND is_active = 1 LIMIT 1`,
    [username],
  );
  const user = users[0];

  if (!user) {
    return { message: NO_EMAIL_MESSAGE };
  }

  const resolved = await resolveResetEmail(user);
  if (!resolved) {
    return { message: NO_EMAIL_MESSAGE };
  }

  const token = generateToken();
  const tokenHash = hashToken(token);
  const expiresAt = new Date(Date.now() + RESET_TOKEN_TTL_MS);

  await db.query(
    `INSERT INTO password_reset_tokens (user_id, token_hash, expires_at)
           VALUES (?, ?, ?)`,
    [user.id, tokenHash, expiresAt],
  );

  const frontendUrl = process.env.FRONTEND_URL || "http://localhost:3000";
  const resetUrl = `${frontendUrl}/reset-password?token=${token}`;

  try {
    await sendPasswordResetEmail({
      to: resolved.email,
      resetUrl,
      recipientName: resolved.nama,
    });
  } catch (emailErr) {
    console.error("Failed to send password reset email:", emailErr);
  }

  return {
    message: "Tautan reset kata sandi telah dikirim ke email terdaftar.",
  };
}

async function resetPassword(token, newPassword) {
  const tokenHash = hashToken(token);

  const [rows] = await db.query(
    `SELECT id, user_id FROM password_reset_tokens
           WHERE token_hash = ? AND used_at IS NULL AND expires_at > NOW()
           LIMIT 1`,
    [tokenHash],
  );
  const resetRow = rows[0];

  if (!resetRow) {
    throw new CustomError(400, {
      ok: false,
      message: "Tautan reset tidak valid atau sudah kedaluwarsa.",
    });
  }

  const passwordHash = await bcrypt.hash(newPassword, 10);

  const conn = await db.getConnection();
  let txStarted = false;
  try {
    await conn.beginTransaction();
    txStarted = true;

    await conn.query(`UPDATE users SET password_hash = ? WHERE id = ?`, [
      passwordHash,
      resetRow.user_id,
    ]);
    await conn.query(
      `UPDATE password_reset_tokens SET used_at = NOW() WHERE id = ?`,
      [resetRow.id],
    );

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

  return {
    message: "Kata sandi berhasil diubah. Silakan login kembali.",
  };
}

async function verifyEmail(token) {
  const tokenHash = hashToken(token);

  const [rows] = await db.query(
    `SELECT id, npm, email FROM mahasiswa_email_verification_tokens
       WHERE token_hash = ? AND used_at IS NULL AND expires_at > NOW()
       LIMIT 1`,
    [tokenHash],
  );
  const verifyRow = rows[0];

  if (!verifyRow) {
    throw new CustomError(400, {
      ok: false,
      message: "Tautan verifikasi tidak valid atau sudah kedaluwarsa.",
    });
  }

  const conn = await db.getConnection();
  let txStarted = false;
  try {
    await conn.beginTransaction();
    txStarted = true;

    await conn.query(
      `UPDATE mahasiswa SET email_verified_at = NOW()
         WHERE npm = ? AND email = ?`,
      [verifyRow.npm, verifyRow.email],
    );
    await conn.query(
      `UPDATE mahasiswa_email_verification_tokens SET used_at = NOW() WHERE id = ?`,
      [verifyRow.id],
    );

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

  return {
    message: "Email berhasil diverifikasi.",
  };
}

module.exports = {
  login,
  getUserInformation,
  forgotPassword,
  resetPassword,
  verifyEmail,
};
