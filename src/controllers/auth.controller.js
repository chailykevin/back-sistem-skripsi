const jwt = require("jsonwebtoken");
const bcrypt = require("bcrypt");
const crypto = require("crypto");
const db = require("../db"); // mysql2 pool
const {
  sendPasswordResetEmail,
  sendEmailVerificationEmail,
} = require("../utils/email");

const RESET_TOKEN_TTL_MS = 60 * 60 * 1000; // 1 hour

function generateToken() {
  return crypto.randomBytes(32).toString("base64url");
}

function hashToken(token) {
  return crypto.createHash("sha256").update(token).digest("hex");
}

function deriveLegacyUserType(roles = []) {
  if (roles.includes("STUDENT")) return "STUDENT";
  if (roles.includes("LECTURER") || roles.includes("KAPRODI"))
    return "LECTURER";
  return roles[0] ?? null;
}

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

exports.login = async (req, res, next) => {
  try {
    const { username, password } = req.body;

    if (!username || !password) {
      return res.status(400).json({
        ok: false,
        message: "Username and password are required",
      });
    }

    const [users] = await db.query(
      `SELECT * FROM users WHERE username = ? AND is_active = 1 LIMIT 1`,
      [username],
    );

    if (users.length === 0) {
      return res.status(401).json({
        ok: false,
        message: "Invalid username or password",
      });
    }

    const user = users[0];

    const isMatch = await bcrypt.compare(password, user.password_hash);
    if (!isMatch) {
      return res.status(401).json({
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

    return res.json({
      ok: true,
      data: {
        token,
        user: {
          id: user.id,
          username: user.username,
          userType: legacyUserType,
          roles,
          profile,
        },
      },
    });
  } catch (err) {
    next(err);
  }
};

exports.me = async (req, res, next) => {
  try {
    const userId = Number(req.user.id);

    const [rows] = await db.query(
      `SELECT id, username, npm, nidn, is_active
       FROM users
       WHERE id = ? AND is_active = 1
       LIMIT 1`,
      [userId],
    );

    if (rows.length === 0) {
      return res.status(401).json({ ok: false, message: "Unauthorized" });
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

    res.json({
      ok: true,
      data: {
        id: user.id,
        username: user.username,
        userType: legacyUserType,
        roles,
        profile,
      },
    });
  } catch (err) {
    next(err);
  }
};

async function resolveResetEmail(user) {
  if (user.npm) {
    const [rows] = await db.query(
      `SELECT email, email_verified_at, nama FROM mahasiswa WHERE npm = ? LIMIT 1`,
      [user.npm],
    );
    const mhs = rows[0];
    if (!mhs || !mhs.email || !mhs.email_verified_at) return null;
    return { email: mhs.email, nama: mhs.nama };
  }

  if (user.nidn) {
    const [rows] = await db.query(
      `SELECT email, nama FROM dosen WHERE nidn = ? LIMIT 1`,
      [user.nidn],
    );
    const dsn = rows[0];
    if (!dsn || !dsn.email) return null;
    return { email: dsn.email, nama: dsn.nama };
  }

  if (user.email) {
    return { email: user.email, nama: null };
  }

  return null;
}

exports.forgotPassword = async (req, res, next) => {
  try {
    const { username } = req.body;
    if (!username) {
      return res
        .status(400)
        .json({ ok: false, message: "Username is required" });
    }

    const NO_EMAIL_MESSAGE =
      "Email tidak ditemukan atau belum terverifikasi untuk akun ini. Silakan hubungi IT.";

    const [users] = await db.query(
      `SELECT id, npm, nidn, email FROM users WHERE username = ? AND is_active = 1 LIMIT 1`,
      [username],
    );
    const user = users[0];

    if (!user) {
      return res.json({
        ok: true,
        data: { message: NO_EMAIL_MESSAGE },
      });
    }

    const resolved = await resolveResetEmail(user);
    if (!resolved) {
      return res.json({
        ok: true,
        data: { message: NO_EMAIL_MESSAGE },
      });
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

    return res.json({
      ok: true,
      data: {
        message:
          "Tautan reset kata sandi telah dikirim ke email terdaftar.",
      },
    });
  } catch (err) {
    next(err);
  }
};

exports.resetPassword = async (req, res, next) => {
  try {
    const { token, newPassword } = req.body;
    if (!token || !newPassword) {
      return res
        .status(400)
        .json({ ok: false, message: "Token and newPassword are required" });
    }
    if (String(newPassword).length < 6) {
      return res.status(400).json({
        ok: false,
        message: "Kata sandi baru minimal 6 karakter.",
      });
    }

    const tokenHash = hashToken(token);

    const [rows] = await db.query(
      `SELECT id, user_id FROM password_reset_tokens
       WHERE token_hash = ? AND used_at IS NULL AND expires_at > NOW()
       LIMIT 1`,
      [tokenHash],
    );
    const resetRow = rows[0];

    if (!resetRow) {
      return res.status(400).json({
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

    return res.json({
      ok: true,
      data: { message: "Kata sandi berhasil diubah. Silakan login kembali." },
    });
  } catch (err) {
    next(err);
  }
};

exports.verifyEmail = async (req, res, next) => {
  try {
    const { token } = req.body;
    if (!token) {
      return res.status(400).json({ ok: false, message: "Token is required" });
    }

    const tokenHash = hashToken(token);

    const [rows] = await db.query(
      `SELECT id, npm, email FROM mahasiswa_email_verification_tokens
       WHERE token_hash = ? AND used_at IS NULL AND expires_at > NOW()
       LIMIT 1`,
      [tokenHash],
    );
    const verifyRow = rows[0];

    if (!verifyRow) {
      return res.status(400).json({
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

    return res.json({
      ok: true,
      data: { message: "Email berhasil diverifikasi." },
    });
  } catch (err) {
    next(err);
  }
};
