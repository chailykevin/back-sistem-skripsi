const db = require("../db");

const PENGUJI_ROLES = ["PENGUJI_1", "PENGUJI_2"];

async function listByProgramStudiId(
  programStudiId,
  { role = null, excludeNidns = [] } = {},
) {
  const excluded = [...new Set(excludeNidns.filter(Boolean))];
  const where = ["dusp.program_studi_id = ?"];
  const params = [programStudiId];
  if (role) {
    where.push("dusp.role = ?");
    params.push(role);
  }
  if (excluded.length) {
    where.push(`d.nidn NOT IN (${excluded.map(() => "?").join(", ")})`);
    params.push(...excluded);
  }
  const [rows] = await db.query(
    `SELECT dusp.id_dosen_uji_sidang_skripsi_prodi, dusp.role, d.nidn, d.nama, d.email
       FROM dosen_uji_sidang_skripsi_prodi dusp INNER JOIN dosen d ON d.nidn = dusp.dosen_nidn
      WHERE ${where.join(" AND ")}
      ORDER BY d.nama ASC, dusp.role ASC`,
    params,
  );
  return rows;
}

async function listEligibleByRole(programStudiId, excludeNidns = []) {
  const rows = await listByProgramStudiId(programStudiId, { excludeNidns });
  const pick = (role) =>
    rows
      .filter((row) => row.role === role)
      .map(({ id_dosen_uji_sidang_skripsi_prodi, nidn, nama, email }) => ({
        id_dosen_uji_sidang_skripsi_prodi,
        nidn,
        nama,
        email,
      }));
  return { penguji1: pick("PENGUJI_1"), penguji2: pick("PENGUJI_2") };
}

// picks: [{ nidn, role }]; returns the picks that are not eligible for their role.
async function findIneligible(conn, programStudiId, picks) {
  const wanted = picks.filter((p) => p.nidn && PENGUJI_ROLES.includes(p.role));
  if (!wanted.length) return [];
  const nidns = [...new Set(wanted.map((p) => p.nidn))];
  const placeholders = nidns.map(() => "?").join(", ");
  const [eligibleRows] = await conn.query(
    `SELECT dosen_nidn, role FROM dosen_uji_sidang_skripsi_prodi
      WHERE program_studi_id = ? AND dosen_nidn IN (${placeholders})`,
    [programStudiId, ...nidns],
  );
  const eligible = new Set(
    eligibleRows.map((row) => `${row.dosen_nidn}|${row.role}`),
  );
  const ineligible = wanted.filter((p) => !eligible.has(`${p.nidn}|${p.role}`));
  if (!ineligible.length) return [];
  const ineligibleNidns = [...new Set(ineligible.map((p) => p.nidn))];
  const [dosenRows] = await conn.query(
    `SELECT nidn, nama FROM dosen WHERE nidn IN (${ineligibleNidns.map(() => "?").join(", ")})`,
    ineligibleNidns,
  );
  const namaByNidn = new Map(dosenRows.map((row) => [row.nidn, row.nama]));
  return ineligible.map((p) => ({ ...p, nama: namaByNidn.get(p.nidn) ?? null }));
}

async function getManagementData({
  q = null,
  homeProgramStudiId = null,
  programStudiId = null,
  role = null,
  limit = 10,
  offset = 0,
} = {}) {
  const where = [];
  const params = [];

  if (q) {
    const pattern = `%${q}%`;
    where.push(
      `(d.nama LIKE ? OR d.nidn LIKE ? OR COALESCE(d.email, '') LIKE ?)`,
    );
    params.push(pattern, pattern, pattern);
  }
  if (homeProgramStudiId) {
    where.push(`d.program_studi_id = ?`);
    params.push(homeProgramStudiId);
  }
  if (programStudiId || role) {
    const conditions = ["eligible.dosen_nidn = d.nidn"];
    if (programStudiId) {
      conditions.push("eligible.program_studi_id = ?");
      params.push(programStudiId);
    }
    if (role) {
      conditions.push("eligible.role = ?");
      params.push(role);
    }
    where.push(
      `EXISTS (
         SELECT 1 FROM dosen_uji_sidang_skripsi_prodi eligible
          WHERE ${conditions.join(" AND ")}
       )`,
    );
  }

  const whereSql = where.length ? `WHERE ${where.join(" AND ")}` : "";
  const [[countRows], [pageRows], [programStudiRows]] = await Promise.all([
    db.query(
      `SELECT COUNT(*) AS total
         FROM dosen d
         ${whereSql}`,
      params,
    ),
    db.query(
      `SELECT d.nidn
         FROM dosen d
         ${whereSql}
        ORDER BY d.nama ASC, d.nidn ASC
        LIMIT ? OFFSET ?`,
      [...params, limit, offset],
    ),
    db.query(
      `SELECT id, nama, kode
         FROM program_studi
        ORDER BY nama ASC`,
    ),
  ]);

  const nidns = pageRows.map((row) => row.nidn);
  let dosenRows = [];
  if (nidns.length > 0) {
    [dosenRows] = await db.query(
      `SELECT
         d.nidn,
         d.nama,
         d.email,
         home_ps.id AS home_program_studi_id,
         home_ps.nama AS home_program_studi_nama,
         dusp.id_dosen_uji_sidang_skripsi_prodi,
         dusp.role,
         assigned_ps.id AS assigned_program_studi_id,
         assigned_ps.nama AS assigned_program_studi_nama
       FROM dosen d
       LEFT JOIN program_studi home_ps ON home_ps.id = d.program_studi_id
       LEFT JOIN dosen_uji_sidang_skripsi_prodi dusp ON dusp.dosen_nidn = d.nidn
       LEFT JOIN program_studi assigned_ps ON assigned_ps.id = dusp.program_studi_id
       WHERE d.nidn IN (${nidns.map(() => "?").join(", ")})
       ORDER BY d.nama ASC, d.nidn ASC, assigned_ps.nama ASC, dusp.role ASC`,
      nidns,
    );
  }

  const dosenByNidn = new Map();
  for (const row of dosenRows) {
    if (!dosenByNidn.has(row.nidn)) {
      dosenByNidn.set(row.nidn, {
        nidn: row.nidn,
        nama: row.nama,
        email: row.email,
        homeProgramStudi: row.home_program_studi_id
          ? {
              id: row.home_program_studi_id,
              nama: row.home_program_studi_nama,
            }
          : null,
        programStudiPengujiSidangSkripsi: [],
      });
    }

    if (row.id_dosen_uji_sidang_skripsi_prodi) {
      const assignments =
        dosenByNidn.get(row.nidn).programStudiPengujiSidangSkripsi;
      let prodi = assignments.find(
        (a) => a.id === row.assigned_program_studi_id,
      );
      if (!prodi) {
        prodi = {
          id: row.assigned_program_studi_id,
          nama: row.assigned_program_studi_nama,
          roles: [],
        };
        assignments.push(prodi);
      }
      prodi.roles.push({
        idDosenUjiSidangSkripsiProdi: row.id_dosen_uji_sidang_skripsi_prodi,
        role: row.role,
      });
    }
  }

  return {
    dosen: [...dosenByNidn.values()],
    programStudi: programStudiRows,
    totalItems: Number(countRows[0]?.total ?? 0),
  };
}

module.exports = {
  PENGUJI_ROLES,
  listByProgramStudiId,
  listEligibleByRole,
  findIneligible,
  getManagementData,
};
