const crypto = require("crypto");
const db = require("../db");
const { sendEmailVerificationEmail } = require("../utils/email");

const VERIFY_TOKEN_TTL_MS = 24 * 60 * 60 * 1000; // 24 hours
const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function generateToken() {
  return crypto.randomBytes(32).toString("base64url");
}

function hashToken(token) {
  return crypto.createHash("sha256").update(token).digest("hex");
}

async function getStudentNpm(userId) {
  const [rows] = await db.query(
    `SELECT npm
     FROM users
     WHERE id = ? AND is_active = 1
     LIMIT 1`,
    [userId],
  );
  return rows[0]?.npm ?? null;
}

exports.getMyEmailStatus = async (req, res, next) => {
  try {
    if (!req.user.hasRole("STUDENT")) {
      return res.json({
        ok: true,
        data: { needsEmailCapture: false, email: null, emailVerified: false },
      });
    }

    const npm = await getStudentNpm(req.user.id);
    if (!npm) {
      return res.json({
        ok: true,
        data: { needsEmailCapture: false, email: null, emailVerified: false },
      });
    }

    const [rows] = await db.query(
      `SELECT email, email_verified_at FROM mahasiswa WHERE npm = ? LIMIT 1`,
      [npm],
    );
    const mhs = rows[0];

    return res.json({
      ok: true,
      data: {
        needsEmailCapture: !mhs?.email,
        email: mhs?.email ?? null,
        emailVerified: Boolean(mhs?.email_verified_at),
      },
    });
  } catch (err) {
    next(err);
  }
};

exports.submitMyEmail = async (req, res, next) => {
  try {
    if (!req.user.hasRole("STUDENT")) {
      return res.status(403).json({
        ok: false,
        message: "Only students can submit an email through this endpoint",
      });
    }

    const { email } = req.body;
    if (!email || !EMAIL_REGEX.test(String(email).trim())) {
      return res
        .status(400)
        .json({ ok: false, message: "Email tidak valid" });
    }
    const normalizedEmail = String(email).trim();

    const npm = await getStudentNpm(req.user.id);
    if (!npm) {
      return res.status(404).json({ ok: false, message: "Student not found" });
    }

    const [rows] = await db.query(
      `SELECT email, nama FROM mahasiswa WHERE npm = ? LIMIT 1`,
      [npm],
    );
    const mhs = rows[0];
    if (!mhs) {
      return res.status(404).json({ ok: false, message: "Student not found" });
    }
    if (mhs.email) {
      return res.status(409).json({
        ok: false,
        message: "Email sudah pernah diisi untuk akun ini",
      });
    }

    await db.query(`UPDATE mahasiswa SET email = ? WHERE npm = ?`, [
      normalizedEmail,
      npm,
    ]);

    const token = generateToken();
    const tokenHash = hashToken(token);
    const expiresAt = new Date(Date.now() + VERIFY_TOKEN_TTL_MS);

    await db.query(
      `INSERT INTO mahasiswa_email_verification_tokens (npm, email, token_hash, expires_at)
       VALUES (?, ?, ?, ?)`,
      [npm, normalizedEmail, tokenHash, expiresAt],
    );

    const frontendUrl = process.env.FRONTEND_URL || "http://localhost:3000";
    const verifyUrl = `${frontendUrl}/verify-email?token=${token}`;

    try {
      await sendEmailVerificationEmail({
        to: normalizedEmail,
        verifyUrl,
        recipientName: mhs.nama,
      });
    } catch (emailErr) {
      console.error("Failed to send email verification email:", emailErr);
    }

    return res.status(201).json({
      ok: true,
      data: {
        message:
          "Email berhasil disimpan. Silakan cek email Anda untuk verifikasi.",
      },
    });
  } catch (err) {
    next(err);
  }
};
