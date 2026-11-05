// A skripsi record can carry a Seminar Bisnis Digital sidang and later a Skripsi sidang, so every
// "latest / active / count for this skripsi" lookup on pengajuan_sidang or sidang must be scoped
// by jenis. jenis is required everywhere: a missing value throws instead of silently mixing types.

const JENIS = {
  SKRIPSI: "SKRIPSI",
  SEMINAR_BISNIS_DIGITAL: "SEMINAR_BISNIS_DIGITAL",
};
const VALID_JENIS = Object.values(JENIS);

// program_studi.kode of Bisnis Digital: the only prodi with a Seminar, and the only one whose
// students don't propose penguji (no Lembar Usulan Penguji; Kaprodi assigns them at disposisi).
const BISNIS_DIGITAL_PROGRAM_STUDI_KODE = "BD";

const NON_EDITABLE_PENGAJUAN_STATUSES = [
  "VERIFIED",
  "WAITING_FOR_DISPOSISI",
  "WAITING_FOR_SURAT",
  "COMPLETED",
  "REJECTED",
];

function requireJenis(jenis) {
  if (!VALID_JENIS.includes(jenis)) {
    throw new Error(`jenis sidang tidak valid: ${jenis}`);
  }
  return jenis;
}

// Inside a transaction that relies on a locking read seeing fresh data, call this before
// beginTransaction(): as the transaction's first plain read it would fix the snapshot too early.
// A Seminar record stays SEMINAR_BISNIS_DIGITAL until its Seminar revisi completes, which is when
// the SK Skripsi request (pengajuan_sk_skripsi_lanjutan) is created and Bab 4 opens; from then on it
// follows the Skripsi flow, even while that SK is still being processed.
async function resolveJenis(queryable, skripsiId) {
  const [[row]] = await queryable.query(
    `SELECT s.jalur, l.id AS lanjutan_id
     FROM skripsi s
     LEFT JOIN pengajuan_sk_skripsi_lanjutan l ON l.skripsi_id = s.id
     WHERE s.id = ? LIMIT 1`,
    [skripsiId],
  );
  return row?.jalur === JENIS.SEMINAR_BISNIS_DIGITAL && !row.lanjutan_id
    ? JENIS.SEMINAR_BISNIS_DIGITAL
    : JENIS.SKRIPSI;
}

async function getLatestSidang(conn, skripsiId, jenis, { forUpdate = false } = {}) {
  const [[row]] = await conn.query(
    `SELECT * FROM sidang
     WHERE skripsi_id = ? AND jenis = ?
     ORDER BY id DESC LIMIT 1${forUpdate ? " FOR UPDATE" : ""}`,
    [skripsiId, requireJenis(jenis)],
  );
  return row ?? null;
}

async function countSidang(conn, skripsiId, jenis) {
  const [[{ total }]] = await conn.query(
    `SELECT COUNT(*) AS total FROM sidang WHERE skripsi_id = ? AND jenis = ?`,
    [skripsiId, requireJenis(jenis)],
  );
  return Number(total);
}

// The in-progress pengajuan if there is one, otherwise the most recent.
async function getActivePengajuanSidang(conn, skripsiId, jenis) {
  const [[row]] = await conn.query(
    `SELECT * FROM pengajuan_sidang
     WHERE skripsi_id = ? AND jenis = ?
     ORDER BY
       CASE WHEN status NOT IN (?) THEN 0 ELSE 1 END ASC,
       created_at DESC
     LIMIT 1`,
    [skripsiId, requireJenis(jenis), NON_EDITABLE_PENGAJUAN_STATUSES],
  );
  return row ?? null;
}

// The pengajuan still in the student/Sekretariat stage (before VERIFY).
async function getEditablePengajuanSidang(
  conn,
  skripsiId,
  jenis,
  { forUpdate = false } = {},
) {
  const [[row]] = await conn.query(
    `SELECT * FROM pengajuan_sidang
     WHERE skripsi_id = ? AND jenis = ? AND status NOT IN (?)
     ORDER BY created_at DESC LIMIT 1${forUpdate ? " FOR UPDATE" : ""}`,
    [skripsiId, requireJenis(jenis), NON_EDITABLE_PENGAJUAN_STATUSES],
  );
  return row ?? null;
}

// Read-only endpoints may look at a finished phase through ?jenis= (e.g. the Seminar sidang and revisi
// after the record moved on to Skripsi); omitted means the record's current jenis. Writes never take
// jenis from the client: they use resolveJenis.
async function resolveReadJenis(queryable, skripsiId, requested) {
  if (requested === undefined || requested === null || requested === "") {
    return resolveJenis(queryable, skripsiId);
  }
  if (!Object.values(JENIS).includes(requested)) {
    throw Object.assign(
      new Error("jenis harus 'SKRIPSI' atau 'SEMINAR_BISNIS_DIGITAL'"),
      { statusCode: 400 },
    );
  }
  return requested;
}

module.exports = {
  JENIS,
  BISNIS_DIGITAL_PROGRAM_STUDI_KODE,
  requireJenis,
  resolveJenis,
  resolveReadJenis,
  getLatestSidang,
  countSidang,
  getActivePengajuanSidang,
  getEditablePengajuanSidang,
};
