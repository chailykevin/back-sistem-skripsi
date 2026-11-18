const bcrypt = require("bcrypt");
const crypto = require("crypto");

const CONTACT_IT = "Silakan hubungi IT untuk mengatur ulang kata sandi Anda.";

// Only these SIMIKO staff groups belong to a dosen whose email can receive the OTP. Perpustakaan,
// LPPM, Sekretariat (Operator …) and every other group have no personal email and go through IT.
const RESETTABLE_STAFF_GROUPS = ["KAPRODI", "SEKPRODI", "DEKAN"];

const BCRYPT_COST = 10;
const MAX_PASSWORD_BYTES = 72;

// SIMIKO trims the password before hashing, so we do the same everywhere.
const cleanPassword = (plain) => String(plain ?? "").trim();

async function compareBcrypt(plainPassword, hashedPassword) {
  const cleanHash = Buffer.isBuffer(hashedPassword)
    ? hashedPassword.toString("utf8")
    : String(hashedPassword ?? "");
  if (!cleanHash) return false;

  // PHP emits $2y$ hashes; Node bcrypt accepts the equivalent $2b$ with the same cost, salt and checksum.
  const compatibleHash = cleanHash.startsWith("$2y$")
    ? `$2b$${cleanHash.slice(4)}`
    : cleanHash;
  return bcrypt.compare(cleanPassword(plainPassword), compatibleHash);
}

function sha1Hex(plainPassword) {
  return crypto
    .createHash("sha1")
    .update(cleanPassword(plainPassword))
    .digest("hex");
}

function compareSha1(plainPassword, hashedPasswordHex) {
  const cleanHash = Buffer.isBuffer(hashedPasswordHex)
    ? hashedPasswordHex.toString("utf8")
    : String(hashedPasswordHex ?? "").trim();
  if (!cleanHash) return false;
  return sha1Hex(plainPassword) === cleanHash.toLowerCase();
}

function validateNewPassword(newPassword, confirmPassword) {
  if (typeof newPassword !== "string" || !newPassword) {
    return "Kata sandi baru wajib diisi.";
  }
  if (/\s/.test(newPassword)) {
    return "Kata sandi tidak boleh mengandung spasi.";
  }
  if (newPassword.length < 8) {
    return "Kata sandi minimal 8 karakter.";
  }
  if (Buffer.byteLength(newPassword, "utf8") > MAX_PASSWORD_BYTES) {
    return `Kata sandi maksimal ${MAX_PASSWORD_BYTES} karakter.`;
  }
  if (!/[A-Za-z]/.test(newPassword) || !/[0-9]/.test(newPassword)) {
    return "Kata sandi harus mengandung huruf dan angka.";
  }
  if (confirmPassword !== newPassword) {
    return "Konfirmasi kata sandi tidak sama.";
  }
  return null;
}

const normalizedName = (column) =>
  `LOWER(TRIM(REGEXP_REPLACE(${column}, '[[:space:]]+', ' ')))`;

async function existsInSimiko(queryable, username) {
  const [rows] = await queryable.query(
    `SELECT 1 FROM widya_miko.m_usermhs WHERE mhsUName = ? AND del = 0
     UNION ALL
     SELECT 1 FROM widya_miko.m_dosen WHERE dsnEmail = ? AND del = '0'
     UNION ALL
     SELECT 1 FROM widya_miko.c_useradm WHERE usrUName = ? AND del = 0
     LIMIT 1`,
    [username, username, username],
  );
  return rows.length > 0;
}

async function resolveMahasiswa(queryable, user) {
  const [rows] = await queryable.query(
    `SELECT um.mhsId, um.mhsEmail, m.nama
     FROM widya_miko.m_usermhs um
     LEFT JOIN mahasiswa m ON m.npm = ?
     WHERE um.mhsUName = ? AND um.del = 0
     LIMIT 1`,
    [user.npm, user.username],
  );
  const row = rows[0];
  if (!row) return { kind: "MAHASISWA", sourceId: null, resetBlock: CONTACT_IT };
  const email = String(row.mhsEmail ?? "").trim() || null;
  return {
    kind: "MAHASISWA",
    sourceId: row.mhsId,
    email,
    nama: row.nama ?? null,
    resetBlock: email ? null : CONTACT_IT,
  };
}

async function resolveDosen(queryable, user) {
  const [rows] = await queryable.query(
    `SELECT dsnId, dsnEmail, dsnNama FROM widya_miko.m_dosen
     WHERE dsnEmail = ? AND del = '0'
     LIMIT 2`,
    [user.username],
  );
  // Not a SIMIKO dosen login: a legacy local account that still authenticates on users.password_hash.
  if (rows.length === 0) return null;
  // Login checks whichever row comes first, so an email shared by two dosen can't be reset safely.
  if (rows.length > 1) {
    return { kind: "DOSEN", sourceId: null, resetBlock: CONTACT_IT };
  }
  const row = rows[0];
  return {
    kind: "DOSEN",
    sourceId: row.dsnId,
    email: String(row.dsnEmail ?? "").trim() || null,
    nama: row.dsnNama,
    resetBlock: null,
  };
}

async function resolveStaf(queryable, user) {
  const [rows] = await queryable.query(
    `SELECT a.usrId, a.usrNama, g.gpuNama
     FROM widya_miko.c_useradm a
     LEFT JOIN widya_miko.c_grupadm g ON g.gpuId = a.gpuId
     WHERE a.usrUName = ? AND a.del = 0
     LIMIT 1`,
    [user.username],
  );
  const row = rows[0];
  if (!row) return { kind: "STAF", sourceId: null, resetBlock: CONTACT_IT };

  const base = { kind: "STAF", sourceId: row.usrId, nama: row.usrNama };
  const groupName = String(row.gpuNama ?? "").toUpperCase();
  if (!RESETTABLE_STAFF_GROUPS.some((keyword) => groupName.includes(keyword))) {
    return { ...base, email: null, resetBlock: CONTACT_IT };
  }

  // SIMIKO has no key between a staff account and its dosen record; pair them by name like
  // getStaffSignature does, and refuse rather than guess when the name is shared.
  const [dosenRows] = await queryable.query(
    `SELECT dsnEmail FROM widya_miko.m_dosen
     WHERE ${normalizedName("dsnNama")} = ${normalizedName("?")} AND del = '0'
     LIMIT 2`,
    [row.usrNama],
  );
  const email =
    dosenRows.length === 1
      ? String(dosenRows[0].dsnEmail ?? "").trim() || null
      : null;
  return { ...base, email, resetBlock: email ? null : CONTACT_IT };
}

// Who is behind a username and where their password lives. `status` is FOUND, NOT_FOUND
// (unknown everywhere) or DISABLED (in SIMIKO but not an active account of this system).
// `resetBlock` is the message to show instead of sending an OTP.
async function resolveAccount(queryable, username) {
  const cleanUsername = String(username ?? "").trim();
  if (!cleanUsername) return { status: "NOT_FOUND" };

  const [users] = await queryable.query(
    `SELECT id, username, npm, nidn, staff_usr_id, is_active
     FROM users WHERE username = ? LIMIT 1`,
    [cleanUsername],
  );
  const user = users[0];
  if (!user) {
    return {
      status: (await existsInSimiko(queryable, cleanUsername))
        ? "DISABLED"
        : "NOT_FOUND",
    };
  }
  if (Number(user.is_active) !== 1) return { status: "DISABLED" };

  let source = null;
  if (user.npm) source = await resolveMahasiswa(queryable, user);
  else if (user.nidn) source = await resolveDosen(queryable, user);
  else if (user.staff_usr_id) source = await resolveStaf(queryable, user);

  if (!source) {
    source = { kind: "LOKAL", sourceId: user.id, email: null, resetBlock: CONTACT_IT };
  }

  return {
    status: "FOUND",
    userId: Number(user.id),
    username: user.username,
    email: null,
    nama: null,
    ...source,
  };
}

async function verifyCurrentPassword(queryable, account, plainPassword) {
  if (account.kind === "MAHASISWA") {
    const [rows] = await queryable.query(
      `SELECT mhsPwd FROM widya_miko.m_usermhs WHERE mhsId = ? LIMIT 1`,
      [account.sourceId],
    );
    return compareBcrypt(plainPassword, rows[0]?.mhsPwd);
  }
  if (account.kind === "DOSEN") {
    const [rows] = await queryable.query(
      `SELECT dsnPwd, DATE_FORMAT(dsnTglLahir, '%d%m%Y') AS fallbackPassword
       FROM widya_miko.m_dosen WHERE dsnId = ? LIMIT 1`,
      [account.sourceId],
    );
    const row = rows[0];
    if (!row) return false;
    if (row.dsnPwd) return compareBcrypt(plainPassword, row.dsnPwd);
    return cleanPassword(plainPassword) === row.fallbackPassword;
  }
  if (account.kind === "STAF") {
    const [rows] = await queryable.query(
      `SELECT usrPwd FROM widya_miko.c_useradm WHERE usrId = ? LIMIT 1`,
      [account.sourceId],
    );
    return compareSha1(plainPassword, rows[0]?.usrPwd);
  }
  const [rows] = await queryable.query(
    `SELECT password_hash FROM users WHERE id = ? LIMIT 1`,
    [account.userId],
  );
  return compareBcrypt(plainPassword, rows[0]?.password_hash);
}

// Writes only the password column and mtm; nothing else in SIMIKO is touched.
async function writePassword(conn, account, plainPassword) {
  if (account.kind === "STAF") {
    const [result] = await conn.query(
      `UPDATE widya_miko.c_useradm SET usrPwd = ?, mtm = CURRENT_TIMESTAMP WHERE usrId = ?`,
      [sha1Hex(plainPassword), account.sourceId],
    );
    return result.affectedRows === 1;
  }

  const hash = await bcrypt.hash(cleanPassword(plainPassword), BCRYPT_COST);
  const statement = {
    MAHASISWA: `UPDATE widya_miko.m_usermhs SET mhsPwd = ?, mtm = CURRENT_TIMESTAMP WHERE mhsId = ?`,
    DOSEN: `UPDATE widya_miko.m_dosen SET dsnPwd = ?, mtm = CURRENT_TIMESTAMP WHERE dsnId = ?`,
    LOKAL: `UPDATE users SET password_hash = ? WHERE id = ?`,
  }[account.kind];
  const [result] = await conn.query(statement, [hash, account.sourceId]);
  return result.affectedRows === 1;
}

module.exports = {
  CONTACT_IT,
  compareBcrypt,
  compareSha1,
  validateNewPassword,
  resolveAccount,
  verifyCurrentPassword,
  writePassword,
};
