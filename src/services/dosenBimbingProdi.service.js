const db = require("../db");

async function listByProgramStudiId(programStudiId) {
  const [rows] = await db.query(
    `SELECT dbp.id_dosen_bimbing_prodi, d.nidn, d.nama, d.email
       FROM dosen_bimbing_prodi dbp INNER JOIN dosen d ON d.nidn = dbp.dosen_nidn
      WHERE dbp.program_studi_id = ? ORDER BY d.nama ASC`,
    [programStudiId],
  );
  return rows;
}

async function areEligible(programStudiId, nidns) {
  const uniqueNidns = [...new Set(nidns)];
  if (!uniqueNidns.length) return true;
  const [rows] = await db.query(
    `SELECT dosen_nidn FROM dosen_bimbing_prodi WHERE program_studi_id = ? AND dosen_nidn IN (${uniqueNidns.map(() => "?").join(", ")})`,
    [programStudiId, ...uniqueNidns],
  );
  return rows.length === uniqueNidns.length;
}

async function getManagementData({
  q = null,
  homeProgramStudiId = null,
  programStudiId = null,
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
  if (programStudiId) {
    where.push(
      `EXISTS (
         SELECT 1 FROM dosen_bimbing_prodi eligible
          WHERE eligible.dosen_nidn = d.nidn
            AND eligible.program_studi_id = ?
       )`,
    );
    params.push(programStudiId);
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
         dbp.id_dosen_bimbing_prodi,
         assigned_ps.id AS assigned_program_studi_id,
         assigned_ps.nama AS assigned_program_studi_nama
       FROM dosen d
       LEFT JOIN program_studi home_ps ON home_ps.id = d.program_studi_id
       LEFT JOIN dosen_bimbing_prodi dbp ON dbp.dosen_nidn = d.nidn
       LEFT JOIN program_studi assigned_ps ON assigned_ps.id = dbp.program_studi_id
       WHERE d.nidn IN (${nidns.map(() => "?").join(", ")})
       ORDER BY d.nama ASC, d.nidn ASC, assigned_ps.nama ASC`,
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
        programStudiBimbingan: [],
      });
    }

    if (row.id_dosen_bimbing_prodi) {
      dosenByNidn.get(row.nidn).programStudiBimbingan.push({
        idDosenBimbingProdi: row.id_dosen_bimbing_prodi,
        id: row.assigned_program_studi_id,
        nama: row.assigned_program_studi_nama,
      });
    }
  }

  return {
    dosen: [...dosenByNidn.values()],
    programStudi: programStudiRows,
    totalItems: Number(countRows[0]?.total ?? 0),
  };
}

module.exports = { listByProgramStudiId, areEligible, getManagementData };
