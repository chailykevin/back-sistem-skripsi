const bcrypt = require("bcrypt");
const db = require("../db");
const nodemailer = require("nodemailer");

const DUMMY_PASSWORD_PLAIN = "123";
const PREDEFINED_MAHASISWA = [
  {
    npm: "22412890",
    nama: "Muhammad Fatkhul Alfi",
    username: "22412890",
    password: DUMMY_PASSWORD_PLAIN,
  },
  {
    npm: "22421562",
    nama: "Kevin Chaily",
    username: "22421562",
    password: DUMMY_PASSWORD_PLAIN,
  },
  {
    npm: "22421495",
    nama: "Erika Putri",
    username: "22421495",
    password: DUMMY_PASSWORD_PLAIN,
  },
  {
    npm: "22421592",
    nama: "Victor Valentino",
    username: "22421592",
    password: DUMMY_PASSWORD_PLAIN,
  },
  {
    npm: "22412858",
    nama: "Ajay Antholin",
    username: "22412858",
    password: DUMMY_PASSWORD_PLAIN,
  },
  {
    npm: "22421581",
    nama: "Robert Varian",
    username: "22421581",
    password: DUMMY_PASSWORD_PLAIN,
  },
  {
    npm: "22421527",
    nama: "Carolus Seto Gautama",
    username: "22421527",
    password: DUMMY_PASSWORD_PLAIN,
  },
  {
    npm: "22421587",
    nama: "Sylvia Steffi",
    username: "22421587",
    password: DUMMY_PASSWORD_PLAIN,
  },
  {
    npm: "22421521",
    nama: "Argo Aditya Saputra",
    username: "22421521",
    password: DUMMY_PASSWORD_PLAIN,
  },
  {
    npm: "22421568",
    nama: "Mertayasa Pradana Hartono",
    username: "22421568",
    password: DUMMY_PASSWORD_PLAIN,
  },
  {
    npm: "22421561",
    nama: "Jonathan Kristian",
    username: "22421561",
    password: DUMMY_PASSWORD_PLAIN,
  },
  {
    npm: "22421580",
    nama: "Riska Shintia",
    username: "22421580",
    password: DUMMY_PASSWORD_PLAIN,
  },
];
/* Legacy hard-coded dosen seed data. SIMIKO is now the source of truth.
const PREDEFINED_DOSEN = [
  {
    nidn: "00001",
    nama: "Susana, S.Kom., M.TI.",
    username: "susan",
    isKaprodi: true,
    isSekretariat: false,
    isDekan: false,
    isSekretariatProdi: false,
    programStudiNama: "Informatika",
    password: DUMMY_PASSWORD_PLAIN,
    email: "zeonives123@gmail.com",
  },
  {
    nidn: "00002",
    nama: "Hendro, S.Kom., M.M., M.TI.",
    username: "hendro",
    isKaprodi: false,
    isSekretariat: false,
    isDekan: false,
    isSekretariatProdi: true,
    programStudiNama: "Informatika",
    password: DUMMY_PASSWORD_PLAIN,
    email: "zeonives123@gmail.com",
  },
  {
    nidn: "00003",
    nama: "Thommy Willay, S.Kom., M.Kom.",
    username: "thomlay",
    isKaprodi: true,
    isSekretariat: false,
    isDekan: false,
    isSekretariatProdi: false,
    programStudiNama: "Sistem Informasi",
    password: DUMMY_PASSWORD_PLAIN,
    email: "zeonives123@gmail.com",
  },
  {
    nidn: "00004",
    nama: "Antonius, S.Kom., M.Kom.",
    username: "antonius",
    isKaprodi: false,
    isSekretariat: true,
    isDekan: false,
    isSekretariatProdi: false,
    password: DUMMY_PASSWORD_PLAIN,
    email: "zeonives123@gmail.com",
  },
  {
    nidn: "00005",
    nama: "Riyadi J. Iskandar, S.Kom., M.M., M.Kom.",
    username: "riyadi",
    isKaprodi: false,
    isSekretariat: false,
    isDekan: false,
    isSekretariatProdi: false,
    password: DUMMY_PASSWORD_PLAIN,
    email: "zeonives123@gmail.com",
  },
  {
    nidn: "00006",
    nama: "Paskalia Kartini, S.T., M.T.",
    username: "paskalia",
    isKaprodi: false,
    isSekretariat: false,
    isDekan: true,
    isSekretariatProdi: false,
    password: DUMMY_PASSWORD_PLAIN,
    email: "zeonives123@gmail.com",
  },
]; */

// Fakultas seeded alongside dosen
const PREDEFINED_FAKULTAS = [
  {
    nama: "Fakultas Teknologi Informasi",
    kode: "UWDP-FTI",
    dekanNidn: "00006",
  },
];

// program_studi kode mapping (matched by nama)
const PROGRAM_STUDI_KODE = {
  informatika: "INF",
  "sistem informasi": "SI",
  "bisnis digital": "BD",
};

// Digits 3–4 of every NPM are the institution's permanent program-studi code.
// The database `kode` is used for the lookup so a display-name change does not
// alter which program a mahasiswa belongs to.
const NPM_PROGRAM_STUDI_KODE = {
  41: "SI",
  42: "INF",
  43: "BD",
};

const DOSEN_PENEMPATAN_PROGRAM_STUDI = {
  72: "Bahasa Mandarin",
  61: "Akuntansi",
  43: "Bisnis Digital",
  71: "Bahasa dan Kebudayaan Inggris",
  50: "Manajemen",
  201: "Manajemen (S2)",
  42: "Informatika",
  41: "Sistem Informasi",
};

const PREDEFINED_ROLE_FROM_SIMIKO = [
  { roleCode: "KAPRODI", groupKeyword: "KAPRODI", requiresProgramStudi: true },
  {
    roleCode: "SEKPRODI",
    groupKeyword: "SEKPRODI",
    requiresProgramStudi: true,
  },
  { roleCode: "DEKAN", groupKeyword: "DEKAN", requiresFakultas: true },
  { roleCode: "PERPUSTAKAAN_STAFF", groupKeyword: "OPERATOR PERPUS" },
  { roleCode: "LPPM", groupKeyword: "LPPM" },
  { roleCode: "SEKRETARIAT", groupKeyword: "OPERATOR", requiresFaculty: true },
];

const STAFF_PROGRAM_STUDI_ALIASES = [
  { aliases: ["MAN"], programStudiName: "Bahasa Mandarin" },
  { aliases: ["AK"], programStudiName: "Akuntansi" },
  {
    aliases: ["BKI"],
    programStudiName: "Bahasa dan Kebudayaan Inggris",
  },
  { aliases: ["BD"], programStudiName: "Bisnis Digital" },
  { aliases: ["MM"], programStudiName: "Manajemen (S2)" },
  { aliases: ["MN", "MJ"], programStudiName: "Manajemen" },
  { aliases: ["TI", "INF"], programStudiName: "Informatika" },
  { aliases: ["SI"], programStudiName: "Sistem Informasi" },
];

const STAFF_FAKULTAS_ALIASES = {
  FB: "Fakultas Bahasa",
  FEB: "Fakultas Ekonomi dan Bisnis",
  FTI: "Fakultas Teknologi Informasi",
};

async function getActiveRolesMap(conn) {
  const [rows] = await conn.query(
    `SELECT id, code
     FROM roles
     WHERE is_active = 1
       AND code IN ('STUDENT', 'LECTURER', 'KAPRODI', 'PEMBIMBING', 'SEKRETARIAT', 'DEKAN', 'PERPUSTAKAAN_STAFF', 'LPPM', 'SEKPRODI')`,
  );

  const map = new Map();
  for (const row of rows) {
    map.set(row.code, row.id);
  }
  return map;
}

async function getProgramStudiRows(conn) {
  const [rows] = await conn.query(
    `SELECT id, nama, kode
     FROM program_studi
     ORDER BY id ASC`,
  );
  return rows;
}

async function upsertMahasiswa(conn, mahasiswa) {
  // email is intentionally omitted from ON DUPLICATE KEY UPDATE: it's only
  // set on first insert (seed data carries none). Re-seeding an existing
  // student must never erase an email they've since captured/verified.
  await conn.query(
    `INSERT INTO mahasiswa (npm, nama, email, sks, program_studi_id)
     VALUES (?, ?, ?, ?, ?)
     ON DUPLICATE KEY UPDATE
       nama = VALUES(nama),
       sks = VALUES(sks),
       program_studi_id = VALUES(program_studi_id)`,
    [
      mahasiswa.npm,
      mahasiswa.nama,
      mahasiswa.email ?? null,
      mahasiswa.sks,
      mahasiswa.programStudiId,
    ],
  );
}

async function upsertDosen(conn, dosen) {
  await conn.query(
    `INSERT INTO dosen (nidn, nama, email, program_studi_id)
     VALUES (?, ?, ?, ?)
     ON DUPLICATE KEY UPDATE
       nama = VALUES(nama),
        email = VALUES(email),
        program_studi_id = VALUES(program_studi_id)`,
    [dosen.nidn, dosen.nama, dosen.email ?? null, dosen.programStudiId ?? null],
  );
}

async function upsertStaf(conn, staf) {
  await conn.query(
    `INSERT INTO staf (usr_id, nama, username)
     VALUES (?, ?, ?)
     ON DUPLICATE KEY UPDATE
       nama = VALUES(nama),
       username = VALUES(username)`,
    [staf.nidn, staf.nama, staf.username],
  );
}

async function upsertUserAccount(conn, payload) {
  // password_hash is intentionally omitted from ON DUPLICATE KEY UPDATE:
  // it should only ever be set on first insert. Re-seeding an existing
  // account must never reset a password the user may have since changed.
  await conn.query(
    `INSERT INTO users (username, password_hash, npm, nidn, staff_usr_id, is_active)
     VALUES (?, ?, ?, ?, ?, 1)
     ON DUPLICATE KEY UPDATE
       username = VALUES(username),
       npm = VALUES(npm),
       nidn = VALUES(nidn),
       staff_usr_id = VALUES(staff_usr_id),
       is_active = 1`,
    [
      payload.username,
      payload.passwordHash,
      payload.npm ?? null,
      payload.nidn ?? null,
      payload.staffUsrId ?? null,
    ],
  );
}

async function getUserIdByIdentity(conn, { npm = null, nidn = null }) {
  const [rows] = await conn.query(
    `SELECT id
     FROM users
     WHERE npm <=> ? AND nidn <=> ?
     LIMIT 1`,
    [npm, nidn],
  );
  return rows[0]?.id ?? null;
}

async function getUserIdByUsername(conn, username) {
  const [rows] = await conn.query(
    `SELECT id FROM users WHERE username = ? LIMIT 1`,
    [username],
  );
  return rows[0]?.id ?? null;
}

async function upsertUserRole(
  conn,
  { userId, roleId, programStudiId = null, assignedByUserId = null },
) {
  const [rows] = await conn.query(
    `SELECT id
     FROM user_roles
     WHERE user_id = ?
       AND role_id = ?
       AND program_studi_id <=> ?
     ORDER BY id DESC
     LIMIT 1`,
    [userId, roleId, programStudiId],
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
      [assignedByUserId, rows[0].id],
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
    [userId, roleId, programStudiId, assignedByUserId],
  );
}

async function getPredefinedMahasiswa(programRows, conn) {
  const prodiByKode = new Map(
    programRows.map((p) => [
      String(p.kode ?? "").toUpperCase(),
      { id: Number(p.id), nama: p.nama },
    ]),
  );

  const mahasiswaFromSimiko = await getMahasiswaFromSimiko(conn);

  return mahasiswaFromSimiko.map((item, index) => {
    const npmProgramCode = String(item.npm).slice(2, 4);
    const programStudiKode = NPM_PROGRAM_STUDI_KODE[npmProgramCode] ?? null;
    const programStudi = programStudiKode
      ? (prodiByKode.get(programStudiKode) ?? null)
      : null;

    return {
      npm: item.npm,
      nama: item.nama,
      email: null,
      sks: item.sks,
      username: item.username,
      password: null,
      npmProgramCode,
      programStudiKode,
      programStudiId: programStudi?.id ?? null,
      index: index + 1,
    };
  });
}

function getPredefinedDosen(programRows) {
  const prodiByName = new Map(
    programRows.map((p) => [
      String(p.nama).toLowerCase(),
      { id: Number(p.id), nama: p.nama },
    ]),
  );

  return PREDEFINED_DOSEN.map((item, index) => ({
    nidn: item.nidn,
    nama: item.nama,
    email: item.email ?? null,
    username: item.username,
    isKaprodi: item.isKaprodi,
    isSekretariat: item.isSekretariat ?? false,
    isDekan: item.isDekan ?? false,
    isSekretariatProdi: item.isSekretariatProdi ?? false,
    programStudiNama: item.isKaprodi
      ? String(item.programStudiNama ?? "").trim()
      : item.isSekretariatProdi
        ? String(item.programStudiNama ?? "").trim()
        : null,
    kaprodiProgramStudiId: item.isKaprodi
      ? (prodiByName.get(String(item.programStudiNama ?? "").toLowerCase())
          ?.id ?? null)
      : null,
    sekretariatProdiProgramStudiId: item.isSekretariatProdi
      ? (prodiByName.get(String(item.programStudiNama ?? "").toLowerCase())
          ?.id ?? null)
      : null,
    password: item.username,
    index: index + 1,
  }));
}

function normalizeProgramStudiName(value) {
  return String(value ?? "")
    .trim()
    .toLowerCase();
}

function isGlobalDosenPenempatan(value) {
  const normalized = String(value ?? "")
    .trim()
    .toLowerCase();
  return (
    value === true || value === 1 || normalized === "" || normalized === "true"
  );
}

function containsGroupToken(groupName, token) {
  return new RegExp(`(^|[^A-Z0-9])${token}($|[^A-Z0-9])`).test(groupName);
}

function resolveStaffProgramStudi(groupName, prodiByName) {
  const match = STAFF_PROGRAM_STUDI_ALIASES.find(({ aliases }) =>
    aliases.some((alias) => containsGroupToken(groupName, alias)),
  );
  if (!match) return null;

  return {
    nama: match.programStudiName,
    id:
      prodiByName.get(normalizeProgramStudiName(match.programStudiName)) ??
      null,
  };
}

function resolveStaffFakultas(groupName, fakultasByName) {
  const code = Object.keys(STAFF_FAKULTAS_ALIASES).find((alias) =>
    containsGroupToken(groupName, alias),
  );
  if (!code) return null;

  const nama = STAFF_FAKULTAS_ALIASES[code];
  return {
    nama,
    id: fakultasByName.get(normalizeProgramStudiName(nama)) ?? null,
  };
}

function classifyStaffRole(groupName, prodiByName, fakultasByName) {
  const normalizedGroupName = String(groupName ?? "").toUpperCase();
  const roleDefinition = PREDEFINED_ROLE_FROM_SIMIKO.find(
    ({ roleCode, groupKeyword }) => {
      if (!normalizedGroupName.includes(groupKeyword)) return false;
      if (roleCode !== "SEKRETARIAT") return true;
      return ["FB", "FEB", "FTI"].some((alias) =>
        containsGroupToken(normalizedGroupName, alias),
      );
    },
  );
  if (!roleDefinition) return null;

  const programStudi = roleDefinition.requiresProgramStudi
    ? resolveStaffProgramStudi(normalizedGroupName, prodiByName)
    : null;
  const fakultas =
    roleDefinition.requiresFakultas || roleDefinition.requiresFaculty
      ? resolveStaffFakultas(normalizedGroupName, fakultasByName)
      : null;

  return {
    roleCode: roleDefinition.roleCode,
    programStudi,
    fakultas,
  };
}

async function getStaffFromSimiko(conn, programRows) {
  const [fakultasRows] = await conn.query(`SELECT id, nama FROM fakultas`);
  const [sourceUsers] = await conn.query(
    `SELECT userAdm.usrId, userAdm.gpuId, userAdm.usrNama, userAdm.usrUName,
            groupAdm.gpuNama
     FROM widya_miko.c_useradm userAdm
     INNER JOIN widya_miko.c_grupadm groupAdm ON groupAdm.gpuId = userAdm.gpuId
     WHERE userAdm.del = 0 AND groupAdm.del = 0`,
  );

  console.log(sourceUsers);

  const prodiByName = new Map(
    programRows.map((programStudi) => [
      normalizeProgramStudiName(programStudi.nama),
      Number(programStudi.id),
    ]),
  );
  const fakultasByName = new Map(
    fakultasRows.map((fakultas) => [
      normalizeProgramStudiName(fakultas.nama),
      Number(fakultas.id),
    ]),
  );

  return sourceUsers
    .map((sourceUser, index) => {
      const classification = classifyStaffRole(
        sourceUser.gpuNama,
        prodiByName,
        fakultasByName,
      );
      if (!classification) return null;

      return {
        nidn: String(sourceUser.usrId ?? "").trim(),
        nama: String(sourceUser.usrNama ?? "").trim(),
        username: String(sourceUser.usrUName ?? "").trim(),
        gpuNama: sourceUser.gpuNama,
        ...classification,
        index: index + 1,
      };
    })
    .filter(Boolean);
}

async function getDosenFromSimiko(conn, programRows) {
  const [sourceDosen] = await conn.query(
    `SELECT dsnId, dsnNama, dsnTglLahir, dsnPenempatan, dsnEmail, dsnPwd
     FROM widya_miko.m_dosen
     WHERE dsnNama NOT LIKE '%/%'
       AND dsnJabFung IN ('Lektor Kepala', 'Lektor', 'Asisten Ahli')
       AND del = '0'`,
  );

  const prodiByName = new Map(
    programRows.map((programStudi) => [
      normalizeProgramStudiName(programStudi.nama),
      Number(programStudi.id),
    ]),
  );

  return sourceDosen.map((item, index) => {
    const penempatan = item.dsnPenempatan;
    const placementCode = String(penempatan ?? "").trim();
    const programStudiName = isGlobalDosenPenempatan(penempatan)
      ? null
      : (DOSEN_PENEMPATAN_PROGRAM_STUDI[placementCode] ?? null);
    const programStudiId = programStudiName
      ? (prodiByName.get(normalizeProgramStudiName(programStudiName)) ?? null)
      : null;

    return {
      nidn: String(item.dsnId ?? "").trim(),
      nama: String(item.dsnNama ?? "").trim(),
      email: String(item.dsnEmail ?? "").trim(),
      username: String(item.dsnEmail ?? "").trim(),
      dsnPenempatan: penempatan,
      programStudiName,
      programStudiId,
      hasKnownPlacement:
        isGlobalDosenPenempatan(penempatan) || Boolean(programStudiName),
      index: index + 1,
    };
  });
}

async function getMahasiswaFromSimiko(conn) {
  const [periods] = await conn.query(
    "SELECT akdKode FROM widya_miko.r_akademik ORDER BY akdKode DESC LIMIT 2",
  );
  if (periods.length < 2) {
    throw new Error("SIMIKO must have a current and previous academic period");
  }

  const [currentPeriod, previousPeriod] = periods;
  const [courses] = await conn.query(
    "SELECT mtkId FROM widya_miko.m_matakuliah WHERE mtkKode IN (?, ?, ?)",
    ["TIBB803", "SIBB802", "BDPB802"],
  );
  if (courses.length === 0) return [];

  const courseIds = courses.map((course) => course.mtkId);
  const coursePlaceholders = courseIds.map(() => "?").join(", ");
  const [schedules] = await conn.query(
    `SELECT jadId FROM widya_miko.t_jadwal
     WHERE mtkId IN (${coursePlaceholders}) AND akdKode = ?`,
    [...courseIds, currentPeriod.akdKode],
  );
  if (schedules.length === 0) return [];

  const scheduleIds = schedules.map((schedule) => schedule.jadId);
  const schedulePlaceholders = scheduleIds.map(() => "?").join(", ");
  const [students] = await conn.query(
    `SELECT DISTINCT m.mhsId, m.mhsNpm, usrMhs.mhsUName, bio.bdtNama, akmSKSLulus
     FROM widya_miko.m_mahasiswa m
     JOIN widya_miko.t_krs krs ON m.mhsId = krs.mhsId
     JOIN widya_miko.m_biodata bio ON bio.bdtId = m.bdtId
     JOIN widya_miko.m_usermhs usrMhs ON usrMhs.mhsId = m.mhsId
     JOIN widya_miko.t_aktmhs aktMhs ON aktMhs.mhsId = m.mhsId
     WHERE krs.jadId IN (${schedulePlaceholders}) AND aktMhs.akdKode = ?`,
    [...scheduleIds, previousPeriod.akdKode],
  );

  return students.map((item) => ({
    npm: item.mhsNpm,
    nama: item.bdtNama,
    username: item.mhsUName,
    password: null,
    sks: item.akmSKSLulus,
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
      return res
        .status(409)
        .json({ ok: false, message: "No program_studi found" });
    }

    const rolesMap = await getActiveRolesMap(conn);
    const studentRoleId = rolesMap.get("STUDENT");
    if (!studentRoleId) {
      await conn.rollback();
      txStarted = false;
      return res
        .status(409)
        .json({ ok: false, message: "Role STUDENT is missing" });
    }

    const input = await getPredefinedMahasiswa(programRows, conn);
    const validProgramIds = new Set(programRows.map((p) => Number(p.id)));

    for (const row of input) {
      if (
        !row.npm ||
        !row.nama ||
        !row.username ||
        !row.programStudiKode ||
        !Number.isFinite(row.programStudiId)
      ) {
        await conn.rollback();
        txStarted = false;
        return res.status(400).json({
          ok: false,
          message: `Invalid mahasiswa payload or unsupported NPM program code at item #${row.index}`,
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

    const assignedByUserId = Number(req.user?.id) || null;

    const result = [];
    for (const mhs of input) {
      const passwordHash = mhs.password
        ? await bcrypt.hash(mhs.password, 10)
        : null;
      await upsertMahasiswa(conn, mhs);
      await upsertUserAccount(conn, {
        username: mhs.username,
        passwordHash,
        npm: mhs.npm,
        nidn: null,
      });

      const userId = await getUserIdByIdentity(conn, {
        npm: mhs.npm,
        nidn: null,
      });
      if (!userId) {
        throw new Error(`Failed to resolve user account for npm ${mhs.npm}`);
      }

      await upsertUserRole(conn, {
        userId,
        roleId: studentRoleId,
        programStudiId: mhs.programStudiId,
        assignedByUserId,
      });

      const programName =
        programRows.find((p) => Number(p.id) === mhs.programStudiId)?.nama ??
        null;
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
        credentials: { note: "Each mahasiswa's password equals their npm" },
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

async function seedPredefinedDosenLegacy(req, res, next) {
  const conn = await db.getConnection();
  let txStarted = false;

  try {
    await conn.beginTransaction();
    txStarted = true;

    const programRows = await getProgramStudiRows(conn);
    if (programRows.length === 0) {
      await conn.rollback();
      txStarted = false;
      return res
        .status(409)
        .json({ ok: false, message: "No program_studi found" });
    }

    const rolesMap = await getActiveRolesMap(conn);
    const lecturerRoleId = rolesMap.get("LECTURER");
    const kaprodiRoleId = rolesMap.get("KAPRODI");
    const pembimbingRoleId = rolesMap.get("PEMBIMBING");
    const sekretariatRoleId = rolesMap.get("SEKRETARIAT");
    const dekanRoleId = rolesMap.get("DEKAN");
    const perpustakaanRoleId = rolesMap.get("PERPUSTAKAAN_STAFF");
    const lppmRoleId = rolesMap.get("LPPM");
    const sekretariatProdiRoleId = rolesMap.get("SEKPRODI");
    if (
      !lecturerRoleId ||
      !kaprodiRoleId ||
      !pembimbingRoleId ||
      !sekretariatRoleId ||
      !dekanRoleId
    ) {
      await conn.rollback();
      txStarted = false;
      return res.status(409).json({
        ok: false,
        message:
          "Required roles are missing (LECTURER, KAPRODI, PEMBIMBING, SEKRETARIAT, DEKAN)",
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

    const assignedByUserId = Number(req.user?.id) || null;

    // Seed PERPUSTAKAAN and LPPM institution-wide accounts
    const institutionAccounts = [
      {
        username: "perpustakaan",
        roleId: perpustakaanRoleId,
        roleCode: "PERPUSTAKAAN_STAFF",
      },
      { username: "lppm", roleId: lppmRoleId, roleCode: "LPPM" },
    ];
    for (const acc of institutionAccounts) {
      if (!acc.roleId) continue;
      const passwordHash = await bcrypt.hash(acc.username, 10);
      await upsertUserAccount(conn, {
        username: acc.username,
        passwordHash,
        npm: null,
        nidn: null,
      });
      const accUserId = await getUserIdByUsername(conn, acc.username);
      if (accUserId) {
        await upsertUserRole(conn, {
          userId: accUserId,
          roleId: acc.roleId,
          programStudiId: null,
          assignedByUserId,
        });
      }
    }

    const result = [];
    for (const dsn of input) {
      // Lecturer account
      await upsertDosen(conn, dsn);
      const lecturerPasswordHash = await bcrypt.hash(dsn.username, 10);
      await upsertUserAccount(conn, {
        username: dsn.username,
        passwordHash: lecturerPasswordHash,
        npm: null,
        nidn: dsn.nidn,
      });

      const userId = await getUserIdByUsername(conn, dsn.username);
      if (!userId) {
        throw new Error(
          `Failed to resolve user account for username ${dsn.username}`,
        );
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

      let kaprodiAccount = null;
      let kaprodiProgramStudi = null;
      if (dsn.isKaprodi) {
        const kaprodiUsername = dsn.username + "_kaprodi";
        const kaprodiPasswordHash = await bcrypt.hash(kaprodiUsername, 10);
        await upsertUserAccount(conn, {
          username: kaprodiUsername,
          passwordHash: kaprodiPasswordHash,
          npm: null,
          nidn: dsn.nidn,
        });
        const kaprodiUserId = await getUserIdByUsername(conn, kaprodiUsername);
        if (!kaprodiUserId) {
          throw new Error(
            `Failed to resolve kaprodi account for username ${kaprodiUsername}`,
          );
        }
        await upsertUserRole(conn, {
          userId: kaprodiUserId,
          roleId: kaprodiRoleId,
          programStudiId: dsn.kaprodiProgramStudiId,
          assignedByUserId,
        });
        await conn.query(
          `UPDATE program_studi
           SET kaprodi_nidn = ?
           WHERE id = ?`,
          [dsn.nidn, dsn.kaprodiProgramStudiId],
        );
        kaprodiProgramStudi =
          programRows.find((p) => Number(p.id) === dsn.kaprodiProgramStudiId) ??
          null;
        kaprodiAccount = {
          userId: kaprodiUserId,
          username: kaprodiUsername,
          password: kaprodiUsername,
          roles: ["KAPRODI"],
          kaprodiProgramStudiId: kaprodiProgramStudi?.id ?? null,
          kaprodiProgramStudiNama: kaprodiProgramStudi?.nama ?? null,
        };
      }

      let sekretariatAccount = null;
      if (dsn.isSekretariat) {
        const sekretariatUsername = dsn.username + "_sekretariat";
        const sekretariatPasswordHash = await bcrypt.hash(
          sekretariatUsername,
          10,
        );
        await upsertUserAccount(conn, {
          username: sekretariatUsername,
          passwordHash: sekretariatPasswordHash,
          npm: null,
          nidn: dsn.nidn,
        });
        const sekretariatUserId = await getUserIdByUsername(
          conn,
          sekretariatUsername,
        );
        if (!sekretariatUserId) {
          throw new Error(
            `Failed to resolve sekretariat account for username ${sekretariatUsername}`,
          );
        }
        await upsertUserRole(conn, {
          userId: sekretariatUserId,
          roleId: sekretariatRoleId,
          programStudiId: null,
          assignedByUserId,
        });
        sekretariatAccount = {
          userId: sekretariatUserId,
          username: sekretariatUsername,
          password: sekretariatUsername,
          roles: ["SEKRETARIAT"],
        };
      }

      let dekanAccount = null;
      if (dsn.isDekan) {
        const dekanUsername = dsn.username + "_dekan";
        const dekanPasswordHash = await bcrypt.hash(dekanUsername, 10);
        await upsertUserAccount(conn, {
          username: dekanUsername,
          passwordHash: dekanPasswordHash,
          npm: null,
          nidn: dsn.nidn,
        });
        const dekanUserId = await getUserIdByUsername(conn, dekanUsername);
        if (!dekanUserId) {
          throw new Error(
            `Failed to resolve dekan account for username ${dekanUsername}`,
          );
        }
        await upsertUserRole(conn, {
          userId: dekanUserId,
          roleId: dekanRoleId,
          programStudiId: null,
          assignedByUserId,
        });
        dekanAccount = {
          userId: dekanUserId,
          username: dekanUsername,
          password: dekanUsername,
          roles: ["DEKAN"],
        };
      }

      let sekretariatProdiAccount = null;
      if (
        dsn.isSekretariatProdi &&
        sekretariatProdiRoleId &&
        dsn.sekretariatProdiProgramStudiId
      ) {
        const sekprodiUsername = dsn.username + "_sekprodi";
        const sekprodiPasswordHash = await bcrypt.hash(sekprodiUsername, 10);
        await upsertUserAccount(conn, {
          username: sekprodiUsername,
          passwordHash: sekprodiPasswordHash,
          npm: null,
          nidn: dsn.nidn,
        });
        const sekprodiUserId = await getUserIdByUsername(
          conn,
          sekprodiUsername,
        );
        if (sekprodiUserId) {
          await upsertUserRole(conn, {
            userId: sekprodiUserId,
            roleId: sekretariatProdiRoleId,
            programStudiId: dsn.sekretariatProdiProgramStudiId,
            assignedByUserId,
          });
          await conn.query(
            `UPDATE program_studi SET sekprodi_nidn = ? WHERE id = ?`,
            [dsn.nidn, dsn.sekretariatProdiProgramStudiId],
          );
          const sekprodiProdi =
            programRows.find(
              (p) => Number(p.id) === dsn.sekretariatProdiProgramStudiId,
            ) ?? null;
          sekretariatProdiAccount = {
            userId: sekprodiUserId,
            username: sekprodiUsername,
            password: sekprodiUsername,
            roles: ["SEKRETARIAT_PRODI"],
            programStudiId: sekprodiProdi?.id ?? null,
            programStudiNama: sekprodiProdi?.nama ?? null,
          };
        }
      }

      result.push({
        userId,
        username: dsn.username,
        nidn: dsn.nidn,
        nama: dsn.nama,
        password: dsn.password,
        roles: ["LECTURER", "PEMBIMBING"],
        kaprodiAccount,
        sekretariatAccount,
        dekanAccount,
        sekretariatProdiAccount,
      });
    }

    // Seed fakultas and update program_studi kode + fakultas_id
    // (must run after dosen are seeded so dekan_nidn FK target exists)
    for (const fak of PREDEFINED_FAKULTAS) {
      await conn.query(
        `INSERT INTO fakultas (nama, kode, dekan_nidn)
         VALUES (?, ?, ?)
         ON DUPLICATE KEY UPDATE
           nama = VALUES(nama),
           dekan_nidn = VALUES(dekan_nidn)`,
        [fak.nama, fak.kode, fak.dekanNidn],
      );
    }

    // Update program_studi rows with kode and fakultas_id
    for (const ps of programRows) {
      const kode = PROGRAM_STUDI_KODE[String(ps.nama).toLowerCase()] ?? null;
      if (!kode) continue;
      // Find the fakultas for this prodi (first one seeded, assuming single faculty for now)
      const [[fakRow]] = await conn.query(
        `SELECT id FROM fakultas WHERE kode = ? LIMIT 1`,
        [PREDEFINED_FAKULTAS[0].kode],
      );
      if (!fakRow) continue;
      await conn.query(
        `UPDATE program_studi SET kode = ?, fakultas_id = ? WHERE id = ?`,
        [kode, fakRow.id, ps.id],
      );
    }

    await conn.commit();
    txStarted = false;

    return res.status(201).json({
      ok: true,
      message: "Dummy dosen seeded",
      data: {
        credentials: {
          note: "Each dosen account's password equals its own username",
        },
        summary: {
          total: result.length,
          kaprodi: kaprodiCount,
          nonKaprodi: result.length - kaprodiCount,
        },
        institutionAccounts: institutionAccounts.map((a) => ({
          username: a.username,
          role: a.roleCode,
          password: a.username,
        })),
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
}

exports.seedDosenDummy = async (req, res, next) => {
  const conn = await db.getConnection();
  let txStarted = false;

  try {
    await conn.beginTransaction();
    txStarted = true;

    const programRows = await getProgramStudiRows(conn);
    const rolesMap = await getActiveRolesMap(conn);
    const lecturerRoleId = rolesMap.get("LECTURER");
    const pembimbingRoleId = rolesMap.get("PEMBIMBING");
    if (!lecturerRoleId || !pembimbingRoleId) {
      await conn.rollback();
      txStarted = false;
      return res.status(409).json({
        ok: false,
        message: "Required roles are missing (LECTURER, PEMBIMBING)",
      });
    }

    const input = await getDosenFromSimiko(conn, programRows);
    for (const dosen of input) {
      if (!dosen.nidn || !dosen.nama || !dosen.username) {
        await conn.rollback();
        txStarted = false;
        return res.status(400).json({
          ok: false,
          message: `Invalid SIMIKO dosen payload at item #${dosen.index}`,
        });
      }
      if (
        !dosen.hasKnownPlacement ||
        (dosen.programStudiName && !dosen.programStudiId)
      ) {
        // console.log(dosen);

        await conn.rollback();
        txStarted = false;
        return res.status(400).json({
          ok: false,
          message: `Unsupported or unmapped dsnPenempatan at dosen item #${dosen.index}`,
        });
      }
    }

    // console.log(input);

    const assignedByUserId = Number(req.user?.id) || null;
    const result = [];
    for (const dosen of input) {
      await upsertDosen(conn, dosen);
      await upsertUserAccount(conn, {
        username: dosen.username,
        passwordHash: null,
        npm: null,
        nidn: dosen.nidn,
      });

      const userId = await getUserIdByUsername(conn, dosen.username);
      if (!userId) {
        throw new Error(
          `Failed to resolve user account for username ${dosen.username}`,
        );
      }

      await upsertUserRole(conn, {
        userId,
        roleId: lecturerRoleId,
        programStudiId: dosen.programStudiId,
        assignedByUserId,
      });
      await upsertUserRole(conn, {
        userId,
        roleId: pembimbingRoleId,
        programStudiId: dosen.programStudiId,
        assignedByUserId,
      });

      result.push({
        userId,
        username: dosen.username,
        nidn: dosen.nidn,
        nama: dosen.nama,
        programStudiId: dosen.programStudiId,
        programStudiNama: dosen.programStudiName,
        roles: ["LECTURER", "PEMBIMBING"],
      });
    }

    await conn.commit();
    txStarted = false;

    return res.status(201).json({
      ok: true,
      message: "SIMIKO dosen synchronized",
      data: { summary: { total: result.length }, dosen: result },
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

exports.seedStafDummy = async (req, res, next) => {
  const conn = await db.getConnection();
  let txStarted = false;

  try {
    await conn.beginTransaction();
    txStarted = true;

    const programRows = await getProgramStudiRows(conn);
    const rolesMap = await getActiveRolesMap(conn);
    const input = await getStaffFromSimiko(conn, programRows);
    const assignedByUserId = Number(req.user?.id) || null;

    // console.log(input);

    for (const staff of input) {
      const roleId = rolesMap.get(staff.roleCode);
      if (!staff.nidn || !staff.nama || !staff.username || !roleId) {
        throw new Error(`Invalid SIMIKO staff payload at item #${staff.index}`);
      }
      if (
        (staff.roleCode === "KAPRODI" || staff.roleCode === "SEKPRODI") &&
        (!staff.programStudi?.id || !staff.programStudi?.nama)
      ) {
        throw new Error(
          `Missing or unmapped program study for ${staff.roleCode} at item #${staff.index}`,
        );
      }
      if (
        staff.roleCode === "DEKAN" &&
        (!staff.fakultas?.id || !staff.fakultas?.nama)
      ) {
        throw new Error(
          `Missing or unmapped fakultas for DEKAN at item #${staff.index}`,
        );
      }
    }

    const result = [];
    for (const staff of input) {
      const roleId = rolesMap.get(staff.roleCode);
      await upsertStaf(conn, staff);
      await upsertUserAccount(conn, {
        username: staff.username,
        passwordHash: null,
        npm: null,
        nidn: null,
        staffUsrId: staff.nidn,
      });

      const userId = await getUserIdByUsername(conn, staff.username);
      if (!userId) {
        throw new Error(
          `Failed to resolve staff account for username ${staff.username}`,
        );
      }

      await upsertUserRole(conn, {
        userId,
        roleId,
        programStudiId: staff.programStudi?.id ?? null,
        assignedByUserId,
      });

      if (staff.roleCode === "KAPRODI") {
        await conn.query(
          `UPDATE program_studi SET kaprodi_staff_usr_id = ? WHERE id = ?`,
          [staff.nidn, staff.programStudi.id],
        );
      }
      if (staff.roleCode === "SEKPRODI") {
        await conn.query(
          `UPDATE program_studi SET sekprodi_staff_usr_id = ? WHERE id = ?`,
          [staff.nidn, staff.programStudi.id],
        );
      }
      if (staff.roleCode === "DEKAN") {
        await conn.query(
          `UPDATE fakultas SET dekan_staff_usr_id = ? WHERE id = ?`,
          [staff.nidn, staff.fakultas.id],
        );
      }

      result.push({
        userId,
        username: staff.username,
        nidn: staff.nidn,
        nama: staff.nama,
        role: staff.roleCode,
        programStudiId: staff.programStudi?.id ?? null,
        programStudiNama: staff.programStudi?.nama ?? null,
        fakultasId: staff.fakultas?.id ?? null,
        fakultasNama: staff.fakultas?.nama ?? null,
      });
    }

    await conn.commit();
    txStarted = false;

    return res.status(201).json({
      ok: true,
      message: "SIMIKO staff synchronized",
      data: { summary: { total: result.length }, staff: result },
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

exports.testEmail = async (req, res, next) => {
  try {
    const transporter = nodemailer.createTransport({
      host: process.env.SMTP_HOST,
      port: Number(process.env.SMTP_PORT) || 587,
      secure: process.env.SMTP_SECURE === "true",
      auth: {
        user: process.env.SMTP_USER,
        pass: process.env.SMTP_PASS,
      },
    });

    await transporter.verify();

    const to = req.body?.to || process.env.SMTP_USER;
    await transporter.sendMail({
      from: process.env.SMTP_FROM || process.env.SMTP_USER,
      to,
      subject: "Test Email - Sistem Skripsi",
      text: "Konfigurasi SMTP berhasil. Email ini adalah tes koneksi dari Sistem Skripsi.",
    });

    return res.json({ ok: true, message: `Test email sent to ${to}` });
  } catch (err) {
    next(err);
  }
};

exports.testing = async (req, res, next) => {
  try {
    const mahasiswa = await getMahasiswaFromSimiko(db);
    return res.json({
      ok: true,
      message: "Testing endpoint is working",
      data: mahasiswa,
    });
  } catch (err) {
    next(err);
  }
};
