const bcrypt = require("bcrypt");
const db = require("../db");

const DUMMY_PASSWORD_PLAIN = "123";
const PREDEFINED_MAHASISWA = [
  {
    npm: "22412890",
    nama: "Muhammad Fatkhul Alfi",
    username: "22412890",
    programStudiNama: "Sistem Informasi",
    password: DUMMY_PASSWORD_PLAIN,
  },
  {
    npm: "22421562",
    nama: "Kevin Chaily",
    username: "22421562",
    programStudiNama: "Informatika",
    password: DUMMY_PASSWORD_PLAIN,
  },
  {
    npm: "22421495",
    nama: "Erika Putri",
    username: "22421495",
    programStudiNama: "Informatika",
    password: DUMMY_PASSWORD_PLAIN,
  },
  {
    npm: "22421592",
    nama: "Victor Valentino",
    username: "22421592",
    programStudiNama: "Informatika",
    password: DUMMY_PASSWORD_PLAIN,
  },
  {
    npm: "22412858",
    nama: "Ajay Antholin",
    username: "22412858",
    programStudiNama: "Sistem Informasi",
    password: DUMMY_PASSWORD_PLAIN,
  },
];
const PREDEFINED_DOSEN = [
  {
    nidn: "00001",
    nama: "Susana, S.Kom., M.TI.",
    username: "susan",
    isKaprodi: true,
    programStudiNama: "Informatika",
    password: DUMMY_PASSWORD_PLAIN,
  },
  {
    nidn: "00002",
    nama: "Hendro, S.Kom., M.M., M.TI.",
    username: "hendro",
    isKaprodi: false,
    password: DUMMY_PASSWORD_PLAIN,
  },
  { 
    nidn: "00003", 
    nama: "Thommy Willay, S.Kom., M.Kom.", 
    username: "thomlay", 
    isKaprodi: true,
    programStudiNama: "Sistem Informasi", 
    password: DUMMY_PASSWORD_PLAIN,
  },
  { 
    nidn: "00004", 
    nama: "Antonius, S.Kom., M.Kom.", 
    username: "antonius", 
    isKaprodi: false,
    password: DUMMY_PASSWORD_PLAIN, 
  },
  { nidn: "00005", 
    nama: "Riyadi J. Iskandar, S.Kom., M.M., M.Kom.", 
    username: "riyadi", 
    isKaprodi: false,
    password: DUMMY_PASSWORD_PLAIN, 
  },
];

async function getActiveRolesMap(conn) {
  const [rows] = await conn.query(
    `SELECT id, code
     FROM roles
     WHERE is_active = 1
       AND code IN ('STUDENT', 'LECTURER', 'KAPRODI', 'PEMBIMBING')`
  );

  const map = new Map();
  for (const row of rows) {
    map.set(row.code, row.id);
  }
  return map;
}

async function getProgramStudiRows(conn) {
  const [rows] = await conn.query(
    `SELECT id, nama
     FROM program_studi
     ORDER BY id ASC`
  );
  return rows;
}

async function upsertMahasiswa(conn, mahasiswa) {
  await conn.query(
    `INSERT INTO mahasiswa (npm, nama, program_studi_id)
     VALUES (?, ?, ?)
     ON DUPLICATE KEY UPDATE
       nama = VALUES(nama),
       program_studi_id = VALUES(program_studi_id)`,
    [mahasiswa.npm, mahasiswa.nama, mahasiswa.programStudiId]
  );
}

async function upsertDosen(conn, dosen) {
  await conn.query(
    `INSERT INTO dosen (nidn, nama)
     VALUES (?, ?)
     ON DUPLICATE KEY UPDATE
       nama = VALUES(nama)`,
    [dosen.nidn, dosen.nama]
  );
}

async function upsertUserAccount(conn, payload) {
  await conn.query(
    `INSERT INTO users (username, password_hash, npm, nidn, is_active)
     VALUES (?, ?, ?, ?, 1)
     ON DUPLICATE KEY UPDATE
       username = VALUES(username),
       password_hash = VALUES(password_hash),
       npm = VALUES(npm),
       nidn = VALUES(nidn),
       is_active = 1`,
    [payload.username, payload.passwordHash, payload.npm ?? null, payload.nidn ?? null]
  );
}

async function getUserIdByIdentity(conn, { npm = null, nidn = null }) {
  const [rows] = await conn.query(
    `SELECT id
     FROM users
     WHERE npm <=> ? AND nidn <=> ?
     LIMIT 1`,
    [npm, nidn]
  );
  return rows[0]?.id ?? null;
}

async function upsertUserRole(conn, { userId, roleId, programStudiId = null, assignedByUserId = null }) {
  const [rows] = await conn.query(
    `SELECT id
     FROM user_roles
     WHERE user_id = ?
       AND role_id = ?
       AND program_studi_id <=> ?
     ORDER BY id DESC
     LIMIT 1`,
    [userId, roleId, programStudiId]
  );

  if (rows.length > 0) {
    await conn.query(
      `UPDATE user_roles
       SET
         is_active = 1,
         expires_at = NULL,
         assigned_at = CURRENT_TIMESTAMP,
         assigned_by_user_id = ?
       WHERE id = ?`,
      [assignedByUserId, rows[0].id]
    );
    return;
  }

  await conn.query(
    `INSERT INTO user_roles (
       user_id,
       role_id,
       program_studi_id,
       is_active,
       assigned_by_user_id
     ) VALUES (?, ?, ?, 1, ?)`,
    [userId, roleId, programStudiId, assignedByUserId]
  );
}

function getPredefinedMahasiswa(programRows) {
  const prodiByName = new Map(
    programRows.map((p) => [String(p.nama).toLowerCase(), { id: Number(p.id), nama: p.nama }])
  );

  return PREDEFINED_MAHASISWA.map((item, index) => ({
    npm: item.npm,
    nama: item.nama,
    username: item.username,
    programStudiNama: item.programStudiNama,
    password: item.password,
    programStudiId: prodiByName.get(String(item.programStudiNama).toLowerCase())?.id ?? null,
    index: index + 1,
  }));
}

function getPredefinedDosen(programRows) {
  const prodiByName = new Map(
    programRows.map((p) => [String(p.nama).toLowerCase(), { id: Number(p.id), nama: p.nama }])
  );

  return PREDEFINED_DOSEN.map((item, index) => ({
    nidn: item.nidn,
    nama: item.nama,
    username: item.username,
    isKaprodi: item.isKaprodi,
    password: item.password,
    programStudiNama: item.isKaprodi ? String(item.programStudiNama ?? "").trim() : null,
    kaprodiProgramStudiId: item.isKaprodi
      ? prodiByName.get(String(item.programStudiNama ?? "").toLowerCase())?.id ?? null
      : null,
    index: index + 1,
  }));
}

exports.seedMahasiswaDummy = async (req, res, next) => {
  const conn = await db.getConnection();
  let txStarted = false;

  try {
    await conn.beginTransaction();
    txStarted = true;

    const programRows = await getProgramStudiRows(conn);
    if (programRows.length === 0) {
      await conn.rollback();
      txStarted = false;
      return res.status(409).json({ ok: false, message: "No program_studi found" });
    }

    const rolesMap = await getActiveRolesMap(conn);
    const studentRoleId = rolesMap.get("STUDENT");
    if (!studentRoleId) {
      await conn.rollback();
      txStarted = false;
      return res.status(409).json({ ok: false, message: "Role STUDENT is missing" });
    }

    const input = getPredefinedMahasiswa(programRows);
    const validProgramIds = new Set(programRows.map((p) => Number(p.id)));

    for (const row of input) {
      if (
        !row.npm ||
        !row.nama ||
        !row.username ||
        !row.programStudiNama ||
        !Number.isFinite(row.programStudiId)
      ) {
        await conn.rollback();
        txStarted = false;
        return res.status(400).json({
          ok: false,
          message: `Invalid mahasiswa payload at item #${row.index}`,
        });
      }
      if (!validProgramIds.has(row.programStudiId)) {
        await conn.rollback();
        txStarted = false;
        return res.status(400).json({
          ok: false,
          message: `programStudiId not found at mahasiswa item #${row.index}`,
        });
      }
    }

    const password = DUMMY_PASSWORD_PLAIN;
    const passwordHash = await bcrypt.hash(password, 10);
    const assignedByUserId = Number(req.user?.id) || null;

    const result = [];
    for (const mhs of input) {
      await upsertMahasiswa(conn, mhs);
      await upsertUserAccount(conn, {
        username: mhs.username,
        passwordHash,
        npm: mhs.npm,
        nidn: null,
      });

      const userId = await getUserIdByIdentity(conn, { npm: mhs.npm, nidn: null });
      if (!userId) {
        throw new Error(`Failed to resolve user account for npm ${mhs.npm}`);
      }

      await upsertUserRole(conn, {
        userId,
        roleId: studentRoleId,
        programStudiId: mhs.programStudiId,
        assignedByUserId,
      });

      const programName = programRows.find((p) => Number(p.id) === mhs.programStudiId)?.nama ?? null;
      result.push({
        userId,
        username: mhs.username,
        npm: mhs.npm,
        nama: mhs.nama,
        password: mhs.password,
        programStudiId: mhs.programStudiId,
        programStudiNama: programName,
        roles: ["STUDENT"],
      });
    }

    await conn.commit();
    txStarted = false;

    return res.status(201).json({
      ok: true,
      message: "Dummy mahasiswa seeded",
      data: {
        credentials: { password },
        mahasiswa: result,
      },
    });
  } catch (err) {
    try {
      if (txStarted) await conn.rollback();
    } catch (_) {}
    next(err);
  } finally {
    conn.release();
  }
};

exports.seedDosenDummy = async (req, res, next) => {
  const conn = await db.getConnection();
  let txStarted = false;

  try {
    await conn.beginTransaction();
    txStarted = true;

    const programRows = await getProgramStudiRows(conn);
    if (programRows.length === 0) {
      await conn.rollback();
      txStarted = false;
      return res.status(409).json({ ok: false, message: "No program_studi found" });
    }

    const rolesMap = await getActiveRolesMap(conn);
    const lecturerRoleId = rolesMap.get("LECTURER");
    const kaprodiRoleId = rolesMap.get("KAPRODI");
    const pembimbingRoleId = rolesMap.get("PEMBIMBING");
    if (!lecturerRoleId || !kaprodiRoleId || !pembimbingRoleId) {
      await conn.rollback();
      txStarted = false;
      return res.status(409).json({
        ok: false,
        message: "Required roles are missing (LECTURER, KAPRODI, PEMBIMBING)",
      });
    }

    const input = getPredefinedDosen(programRows);
    const validProgramIds = new Set(programRows.map((p) => Number(p.id)));
    let kaprodiCount = 0;

    for (const row of input) {
      if (!row.nidn || !row.nama || !row.username) {
        await conn.rollback();
        txStarted = false;
        return res.status(400).json({
          ok: false,
          message: `Invalid dosen payload at item #${row.index}`,
        });
      }

      if (row.isKaprodi) {
        kaprodiCount += 1;
        if (!row.programStudiNama) {
          await conn.rollback();
          txStarted = false;
          return res.status(400).json({
            ok: false,
            message: `programStudiNama is required for kaprodi at dosen item #${row.index}`,
          });
        }
        if (!Number.isFinite(row.kaprodiProgramStudiId)) {
          await conn.rollback();
          txStarted = false;
          return res.status(400).json({
            ok: false,
            message: `programStudiNama not found at dosen item #${row.index}`,
          });
        }
        if (!validProgramIds.has(row.kaprodiProgramStudiId)) {
          await conn.rollback();
          txStarted = false;
          return res.status(400).json({
            ok: false,
            message: `kaprodiProgramStudiId not found at dosen item #${row.index}`,
          });
        }
      }
    }

    const password = DUMMY_PASSWORD_PLAIN;
    const passwordHash = await bcrypt.hash(password, 10);
    const assignedByUserId = Number(req.user?.id) || null;

    const result = [];
    for (const dsn of input) {
      await upsertDosen(conn, dsn);
      await upsertUserAccount(conn, {
        username: dsn.username,
        passwordHash,
        npm: null,
        nidn: dsn.nidn,
      });

      const userId = await getUserIdByIdentity(conn, { npm: null, nidn: dsn.nidn });
      if (!userId) {
        throw new Error(`Failed to resolve user account for nidn ${dsn.nidn}`);
      }

      await upsertUserRole(conn, {
        userId,
        roleId: lecturerRoleId,
        programStudiId: null,
        assignedByUserId,
      });
      await upsertUserRole(conn, {
        userId,
        roleId: pembimbingRoleId,
        programStudiId: null,
        assignedByUserId,
      });

      const roles = ["LECTURER", "PEMBIMBING"];
      let kaprodiProgramStudi = null;
      if (dsn.isKaprodi) {
        await upsertUserRole(conn, {
          userId,
          roleId: kaprodiRoleId,
          programStudiId: dsn.kaprodiProgramStudiId,
          assignedByUserId,
        });
        await conn.query(
          `UPDATE program_studi
           SET kaprodi_nidn = ?
           WHERE id = ?`,
          [dsn.nidn, dsn.kaprodiProgramStudiId]
        );
        roles.push("KAPRODI");
        kaprodiProgramStudi =
          programRows.find((p) => Number(p.id) === dsn.kaprodiProgramStudiId) ?? null;
      }

      result.push({
        userId,
        username: dsn.username,
        nidn: dsn.nidn,
        nama: dsn.nama,
        password: dsn.password,
        isKaprodi: dsn.isKaprodi,
        roles,
        kaprodiProgramStudiId: kaprodiProgramStudi?.id ?? null,
        kaprodiProgramStudiNama: kaprodiProgramStudi?.nama ?? null,
      });
    }

    await conn.commit();
    txStarted = false;

    return res.status(201).json({
      ok: true,
      message: "Dummy dosen seeded",
      data: {
        credentials: { password },
        summary: {
          total: result.length,
          kaprodi: kaprodiCount,
          nonKaprodi: result.length - kaprodiCount,
        },
        dosen: result,
      },
    });
  } catch (err) {
    try {
      if (txStarted) await conn.rollback();
    } catch (_) {}
    next(err);
  } finally {
    conn.release();
  }
};
