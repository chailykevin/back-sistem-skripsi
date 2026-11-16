// A stored signature only counts if it decodes to image bytes: a data URL, or raw base64.
function hasSignature(signatureValue) {
  if (signatureValue == null) return false;
  const raw = String(signatureValue).trim();
  if (!raw) return false;

  const dataUrlMatch = raw.match(/^data:image\/[a-zA-Z0-9.+-]+;base64,(.+)$/i);
  const base64 = (dataUrlMatch ? dataUrlMatch[1] : raw).replace(/\s+/g, "");
  return (
    base64.length > 0 &&
    /^[A-Za-z0-9+/=]+$/.test(base64) &&
    base64.length % 4 === 0
  );
}

function assertSignatures(checks) {
  const missing = checks
    .filter((c) => !hasSignature(c.signatureImage))
    .map((c) => ({ role: c.role, nama: c.nama ?? "" }));
  if (missing.length > 0) {
    const detail = missing
      .map((m) => `${m.role}${m.nama ? ` (${m.nama})` : ""}`)
      .join(", ");
    const err = new Error(
      `Dokumen belum dapat dibuat karena tanda tangan berikut belum tersimpan: ${detail}. Mohon hubungi admin agar pihak terkait mengunggah tanda tangan terlebih dahulu.`,
    );
    err.statusCode = 400;
    err.missingSignatures = missing;
    throw err;
  }
}

const normalizedName = (column) =>
  `LOWER(TRIM(REGEXP_REPLACE(${column}, '[[:space:]]+', ' ')))`;

// SIMIKO has no key between a staff account (c_useradm: Kaprodi, Sekprodi, Dekan, ...) and the
// dosen record that holds its signature (m_dosen), so they can only be paired by name. Names are
// compared normalised (case, surrounding and repeated whitespace), and when several active dosen
// share the name this refuses to guess rather than put the wrong signature on a document.
async function getStaffSignature(queryable, staffUsrId) {
  if (!staffUsrId) return null;
  const [rows] = await queryable.query(
    `SELECT u.usrNama, d.dsnTtd AS signature_image
     FROM widya_miko.c_useradm u
     JOIN widya_miko.m_dosen d
       ON ${normalizedName("d.dsnNama")} = ${normalizedName("u.usrNama")}
      AND d.del = '0'
     WHERE u.usrId = ?`,
    [staffUsrId],
  );
  if (rows.length > 1) {
    const err = new Error(
      `Tanda tangan untuk ${rows[0].usrNama} tidak dapat ditentukan karena ada ${rows.length} dosen dengan nama yang sama di SIMIKO. Mohon hubungi admin untuk merapikan data dosen di SIMIKO.`,
    );
    err.statusCode = 409;
    throw err;
  }
  return rows[0]?.signature_image ?? null;
}

// Dosen (pembimbing/penguji) signatures live in SIMIKO and are keyed by NIDN.
async function getDosenSignature(queryable, nidn) {
  if (!nidn) return null;
  const [rows] = await queryable.query(
    `SELECT dsnTtd AS signature_image FROM widya_miko.m_dosen WHERE dsnId = ? LIMIT 1`,
    [nidn],
  );
  return rows[0]?.signature_image ?? null;
}

// Mahasiswa (and the institution accounts) keep theirs in users.signature_image.
async function getUserSignature(queryable, userId) {
  if (!userId) return null;
  const [rows] = await queryable.query(
    `SELECT signature_image FROM users WHERE id = ? AND is_active = 1 LIMIT 1`,
    [userId],
  );
  return rows[0]?.signature_image ?? null;
}

async function getMahasiswaSignature(queryable, npm) {
  if (!npm) return null;
  const [rows] = await queryable.query(
    `SELECT signature_image FROM users WHERE npm = ? AND is_active = 1 LIMIT 1`,
    [npm],
  );
  return rows[0]?.signature_image ?? null;
}

// SQL twin of hasSignature for a column: true only when it is a data URL or raw base64 whose
// length is a multiple of 4. Lets the status reads ask "is there a signature?" without pulling the
// LONGTEXT blob over the wire.
function signatureExistsSql(column) {
  const stripped = `REGEXP_REPLACE(REGEXP_REPLACE(TRIM(${column}), '^data:image/[a-zA-Z0-9.+-]+;base64,', '', 1, 1, 'i'), '[[:space:]]+', '')`;
  return `(${column} IS NOT NULL AND ${stripped} REGEXP '^[A-Za-z0-9+/=]+$' AND CHAR_LENGTH(${stripped}) % 4 = 0)`;
}

// Existence variant of getStaffSignature: same name pairing and 409 on an ambiguous name.
async function staffSignatureExists(queryable, staffUsrId) {
  if (!staffUsrId) return false;
  const [rows] = await queryable.query(
    `SELECT u.usrNama, ${signatureExistsSql("d.dsnTtd")} AS has_signature
     FROM widya_miko.c_useradm u
     JOIN widya_miko.m_dosen d
       ON ${normalizedName("d.dsnNama")} = ${normalizedName("u.usrNama")}
      AND d.del = '0'
     WHERE u.usrId = ?`,
    [staffUsrId],
  );
  if (rows.length > 1) {
    const err = new Error(
      `Tanda tangan untuk ${rows[0].usrNama} tidak dapat ditentukan karena ada ${rows.length} dosen dengan nama yang sama di SIMIKO. Mohon hubungi admin untuk merapikan data dosen di SIMIKO.`,
    );
    err.statusCode = 409;
    throw err;
  }
  return Boolean(rows[0]?.has_signature);
}

async function dosenSignatureExists(queryable, nidn) {
  if (!nidn) return false;
  const [rows] = await queryable.query(
    `SELECT ${signatureExistsSql("dsnTtd")} AS has_signature FROM widya_miko.m_dosen WHERE dsnId = ? LIMIT 1`,
    [nidn],
  );
  return Boolean(rows[0]?.has_signature);
}

async function userSignatureExists(queryable, userId) {
  if (!userId) return false;
  const [rows] = await queryable.query(
    `SELECT ${signatureExistsSql("signature_image")} AS has_signature FROM users WHERE id = ? AND is_active = 1 LIMIT 1`,
    [userId],
  );
  return Boolean(rows[0]?.has_signature);
}

async function mahasiswaSignatureExists(queryable, npm) {
  if (!npm) return false;
  const [rows] = await queryable.query(
    `SELECT ${signatureExistsSql("signature_image")} AS has_signature FROM users WHERE npm = ? AND is_active = 1 LIMIT 1`,
    [npm],
  );
  return Boolean(rows[0]?.has_signature);
}

// True when any active account holding the role (e.g. PERPUSTAKAAN_STAFF) has a usable signature.
async function roleSignatureExists(queryable, roleCode) {
  const [rows] = await queryable.query(
    `SELECT EXISTS(
       SELECT 1 FROM users u
       JOIN user_roles ur ON ur.user_id = u.id AND ur.is_active = 1
       JOIN roles r ON r.id = ur.role_id AND r.code = ?
       WHERE u.is_active = 1 AND ${signatureExistsSql("u.signature_image")}
     ) AS has_signature`,
    [roleCode],
  );
  return Boolean(rows[0]?.has_signature);
}

module.exports = {
  hasSignature,
  assertSignatures,
  getStaffSignature,
  getDosenSignature,
  getUserSignature,
  getMahasiswaSignature,
  signatureExistsSql,
  staffSignatureExists,
  dosenSignatureExists,
  userSignatureExists,
  mahasiswaSignatureExists,
  roleSignatureExists,
};
