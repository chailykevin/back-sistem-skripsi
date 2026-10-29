const bcrypt = require("bcrypt");
const db = require("../db");
const nodemailer = require("nodemailer");
const formatPersonName = require("../utils/formatPersonName");

// Digits 3–4 of every NPM are the institution's permanent program-studi code.
// The database `kode` is used for the lookup so a display-name change does not
// alter which program a mahasiswa belongs to.
const NPM_PROGRAM_STUDI_KODE = {
  41: "SI",
  42: "INF",
  43: "BD",
};

// SIMIKO course codes whose KRS registration makes a mahasiswa eligible.
// Bisnis Digital takes Seminar Bisnis Digital as the step before its Skripsi.
const TAHAP_TUGAS_AKHIR_BY_MTK_KODE = {
  IF801BB: "SKRIPSI",
  TIBB803: "SKRIPSI",
  SIBB802: "SKRIPSI",
  BDPB802: "SKRIPSI",
  BDPB701: "SEMINAR_BISNIS_DIGITAL",
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
    `INSERT INTO mahasiswa (npm, nama, tempat_lahir, tanggal_lahir, email, sks, ipk, tahap_tugas_akhir, program_studi_id)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON DUPLICATE KEY UPDATE
       nama = VALUES(nama),
       tempat_lahir = VALUES(tempat_lahir),
       tanggal_lahir = VALUES(tanggal_lahir),
       email = VALUES(email),
       sks = VALUES(sks),
       ipk = VALUES(ipk),
       tahap_tugas_akhir = VALUES(tahap_tugas_akhir),
       program_studi_id = VALUES(program_studi_id)`,
    [
      mahasiswa.npm,
      mahasiswa.nama,
      mahasiswa.tempatLahir ?? null,
      mahasiswa.tanggalLahir ?? null,
      mahasiswa.email ?? null,
      mahasiswa.sks,
      mahasiswa.ipk,
      mahasiswa.tahapTugasAkhir ?? null,
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
      tempatLahir: item.tempatLahir,
      tanggalLahir: item.tanggalLahir,
      sks: item.sks,
      ipk: item.ipk,
      tahapTugasAkhir: item.tahapTugasAkhir,
      username: item.username,
      password: null,
      npmProgramCode,
      programStudiKode,
      programStudiId: programStudi?.id ?? null,
      index: index + 1,
    };
  });
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
        nama: formatPersonName(sourceUser.usrNama),
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
      nama: formatPersonName(item.dsnNama),
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
  const courseKodes = Object.keys(TAHAP_TUGAS_AKHIR_BY_MTK_KODE);
  const [courses] = await conn.query(
    `SELECT mtkId, mtkKode FROM widya_miko.m_matakuliah
     WHERE mtkKode IN (${courseKodes.map(() => "?").join(", ")})`,
    courseKodes,
  );
  if (courses.length === 0) return [];

  const courseKodeById = new Map(
    courses.map((course) => [course.mtkId, course.mtkKode]),
  );
  const courseIds = courses.map((course) => course.mtkId);
  const coursePlaceholders = courseIds.map(() => "?").join(", ");
  const [schedules] = await conn.query(
    `SELECT jadId, mtkId FROM widya_miko.t_jadwal
     WHERE mtkId IN (${coursePlaceholders}) AND akdKode = ?`,
    [...courseIds, currentPeriod.akdKode],
  );
  if (schedules.length === 0) return [];

  const tahapByScheduleId = new Map(
    schedules.map((schedule) => [
      schedule.jadId,
      TAHAP_TUGAS_AKHIR_BY_MTK_KODE[courseKodeById.get(schedule.mtkId)],
    ]),
  );
  const scheduleIds = schedules.map((schedule) => schedule.jadId);
  const schedulePlaceholders = scheduleIds.map(() => "?").join(", ");
  const [rows] = await conn.query(
    `SELECT DISTINCT m.mhsId, m.mhsNpm, usrMhs.mhsUName, bio.bdtNama, bio.bdtT4Lahir, bio.bdtTglLahir, aktMhs.akmIPK, akmSKSLulus, krs.jadId
     FROM widya_miko.m_mahasiswa m
     JOIN widya_miko.t_krs krs ON m.mhsId = krs.mhsId
     JOIN widya_miko.m_biodata bio ON bio.bdtId = m.bdtId
     JOIN widya_miko.m_usermhs usrMhs ON usrMhs.mhsId = m.mhsId
     JOIN widya_miko.t_aktmhs aktMhs ON aktMhs.mhsId = m.mhsId
     WHERE krs.jadId IN (${schedulePlaceholders}) AND aktMhs.akdKode = ?`,
    [...scheduleIds, previousPeriod.akdKode],
  );

  // A student enrolled in several matching courses yields one row per course;
  // collapse to one per student, with SKRIPSI outranking the seminar.
  const studentsByNpm = new Map();
  for (const row of rows) {
    const tahap = tahapByScheduleId.get(row.jadId);
    const existing = studentsByNpm.get(row.mhsNpm);
    if (existing) {
      if (tahap === "SKRIPSI") existing.tahapTugasAkhir = tahap;
      continue;
    }
    studentsByNpm.set(row.mhsNpm, { ...row, tahapTugasAkhir: tahap });
  }
  const students = [...studentsByNpm.values()];

  for (const student of students) {
    student.bdtT4Lahir = normalizeTempatLahir(student.bdtT4Lahir);
  }

  return students.map((item) => ({
    npm: item.mhsNpm,
    nama: formatPersonName(item.bdtNama),
    username: item.mhsUName,
    password: null,
    sks: item.akmSKSLulus,
    tempatLahir: item.bdtT4Lahir,
    tanggalLahir: item.bdtTglLahir,
    ipk: item.akmIPK,
    tahapTugasAkhir: item.tahapTugasAkhir,
  }));
}

function normalizeTempatLahir(tempatLahir) {
  const normalized = String(tempatLahir ?? "")
    .trim()
    .replace(/\s+/g, " ");

  if (!normalized) return null;

  return normalized
    .split(" ")
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1).toLowerCase())
    .join(" ");
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
        tahapTugasAkhir: mhs.tahapTugasAkhir,
        roles: ["STUDENT"],
      });
    }

    const syncedNpms = [...new Set(input.map((mhs) => mhs.npm))];
    const missingNpmCondition = syncedNpms.length
      ? `AND npm NOT IN (${syncedNpms.map(() => "?").join(", ")})`
      : "";
    // An empty successful source result deactivates all mahasiswa accounts.
    // Keep historical records and exclude accounts with dosen/staf identities.
    const [deactivationResult] = await conn.query(
      `UPDATE users
       SET is_active = 0
       WHERE npm IS NOT NULL
         AND nidn IS NULL
         AND staff_usr_id IS NULL
         AND is_active = 1
         ${missingNpmCondition}`,
      syncedNpms,
    );

    await conn.commit();
    txStarted = false;

    return res.status(201).json({
      ok: true,
      message: "Dummy mahasiswa seeded",
      data: {
        credentials: { note: "Each mahasiswa's password equals their npm" },
        mahasiswa: result,
        deactivated: deactivationResult.affectedRows,
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

        await conn.rollback();
        txStarted = false;
        return res.status(400).json({
          ok: false,
          message: `Unsupported or unmapped dsnPenempatan at dosen item #${dosen.index}`,
        });
      }
    }


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

    const syncedNidns = [...new Set(input.map((dosen) => dosen.nidn))];
    const missingNidnCondition = syncedNidns.length
      ? `AND u.nidn NOT IN (${syncedNidns.map(() => "?").join(", ")})`
      : "";
    // An empty successful source result deactivates all linked dosen accounts.
    // Preserve supervision history and exclude mahasiswa/staf identities.
    const [deactivationResult] = await conn.query(
      `UPDATE users u
       JOIN dosen d ON d.nidn = u.nidn
       SET u.is_active = 0
       WHERE u.npm IS NULL
         AND u.staff_usr_id IS NULL
         AND u.is_active = 1
         ${missingNidnCondition}`,
      syncedNidns,
    );

    await conn.commit();
    txStarted = false;

    return res.status(201).json({
      ok: true,
      message: "SIMIKO dosen synchronized",
      data: {
        summary: { total: result.length },
        dosen: result,
        deactivated: deactivationResult.affectedRows,
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

    const syncedStaffIds = [...new Set(input.map((staff) => staff.nidn))];
    const missingStaffCondition = syncedStaffIds.length
      ? `AND u.staff_usr_id NOT IN (${syncedStaffIds.map(() => "?").join(", ")})`
      : "";
    // An empty successful classified source result deactivates all staf accounts.
    // Keep historical assignments and exclude mahasiswa/dosen identities.
    const [deactivationResult] = await conn.query(
      `UPDATE users u
       JOIN staf s ON s.usr_id = u.staff_usr_id
       SET u.is_active = 0
       WHERE u.npm IS NULL
         AND u.nidn IS NULL
         AND u.is_active = 1
         ${missingStaffCondition}`,
      syncedStaffIds,
    );

    await conn.commit();
    txStarted = false;

    return res.status(201).json({
      ok: true,
      message: "SIMIKO staff synchronized",
      data: {
        summary: { total: result.length },
        staff: result,
        deactivated: deactivationResult.affectedRows,
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
