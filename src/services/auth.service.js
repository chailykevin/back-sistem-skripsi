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

module.exports = { login };
