const jwt = require("jsonwebtoken");
const db = require("../db"); // mysql2 pool
const { getUserRoles } = require("./userRoles.service");
const { compareBcrypt, compareSha1 } = require("./simikoPassword.service");
const { CustomError } = require("../errors/customError");

function deriveLegacyUserType(roles = []) {
  if (roles.includes("STUDENT")) return "STUDENT";
  if (roles.includes("LECTURER") || roles.includes("KAPRODI"))
    return "LECTURER";
  return roles[0] ?? null;
}

function signToken(userId, roles, iat) {
  return jwt.sign(
    {
      sub: String(userId),
      roles,
      userType: deriveLegacyUserType(roles),
      ...(iat != null ? { iat } : {}),
    },
    process.env.JWT_SECRET,
    { expiresIn: process.env.JWT_EXPIRES_IN ?? "7d" },
  );
}

// A token for an already-authenticated user (after change password). `iat` is pinned to the
// stored password_changed_at so a clock gap between Node and MySQL can't make the auth middleware
// treat the fresh token as one issued before the change.
async function issueTokenAfterPasswordChange(userId) {
  const [rows] = await db.query(
    `SELECT UNIX_TIMESTAMP(password_changed_at) AS changed_unix FROM users WHERE id = ? LIMIT 1`,
    [userId],
  );
  const changedUnix = rows[0]?.changed_unix;
  const roles = await getUserRoles(userId);
  return signToken(
    userId,
    roles,
    changedUnix == null ? undefined : Math.floor(Number(changedUnix)),
  );
}

async function verifyMahasiswaPassword(username, password) {
  const [sourceUsers] = await db.query(
    `SELECT mhsPwd
     FROM widya_miko.m_usermhs
     WHERE mhsUName = ?
     LIMIT 1`,
    [username],
  );

  const passwordHash = sourceUsers[0]?.mhsPwd;
  return compareBcrypt(password, passwordHash);
}

async function verifyDosenPassword(username, password) {
  const [sourceUsers] = await db.query(
    `SELECT dsnPwd, DATE_FORMAT(dsnTglLahir, '%d%m%Y') AS fallbackPassword
     FROM widya_miko.m_dosen
     WHERE dsnEmail = ? AND del = '0'
     LIMIT 1`,
    [username],
  );
  const sourceUser = sourceUsers[0];
  if (!sourceUser) return null;

  if (sourceUser.dsnPwd) {
    return compareBcrypt(password, sourceUser.dsnPwd);
  }

  return String(password ?? "").trim() === sourceUser.fallbackPassword;
}

async function verifyStafPassword(username, password) {
  const [sourceUsers] = await db.query(
    `SELECT usrPwd
     FROM widya_miko.c_useradm
     WHERE usrUName = ? AND del = 0
     LIMIT 1`,
    [username],
  );
  const sourceUser = sourceUsers[0];
  if (!sourceUser) return null;

  return compareSha1(password, sourceUser.usrPwd);
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

  // Mahasiswa authenticate exclusively against SIMIKO. Do not fall back to
  // users.password_hash if the source account is absent or its password fails.
  let isMatch;
  if (user.npm) {
    isMatch = await verifyMahasiswaPassword(username, password);
  } else if (user.nidn) {
    const dosenMatch = await verifyDosenPassword(username, password);
    // Legacy special-role accounts are not SIMIKO source accounts, so preserve
    // their local authentication while imported dosen remain source-only.
    isMatch = dosenMatch ?? (await compareBcrypt(password, user.password_hash));
  } else if (user.staff_usr_id) {
    isMatch = await verifyStafPassword(username, password);
  } else {
    isMatch = await compareBcrypt(password, user.password_hash);
  }
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

  if (!profile && user.staff_usr_id) {
    const [rows] = await db.query(
      `SELECT usr_id, nama FROM staf WHERE usr_id = ? LIMIT 1`,
      [user.staff_usr_id],
    );
    profile = rows[0] || null;
  }

  const token = signToken(user.id, roles);

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
    `SELECT id, username, npm, nidn, staff_usr_id, is_active
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

  if (!profile && user.staff_usr_id) {
    const [p] = await db.query(
      `SELECT usr_id, nama FROM staf WHERE usr_id = ? LIMIT 1`,
      [user.staff_usr_id],
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

module.exports = {
  login,
  getUserInformation,
  issueTokenAfterPasswordChange,
};
