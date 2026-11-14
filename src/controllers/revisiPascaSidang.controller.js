const db = require("../db");
const path = require("path");
const { insertNotification } = require("../utils/notify");
const { parsePagination, listResponse } = require("../utils/pagination");
const {
  generateHalamanPengesahanMajelisPengujiFTI,
} = require("../services/generateHalamanPengesahanMajelisPengujiFTI");
const {
  generateHalamanPengesahanDekanFTI,
} = require("../services/generateHalamanPengesahanDekanFTI");
const {
  generateNotulenPengujiFTI,
} = require("../services/generateNotulenPengujiFTI");
const {
  getDekanFakultasIds,
  getStudentNpm,
  getLecturerNidn,
  getStaffUsrId,
  getKaprodiProgramStudiIds,
  isKaprodiOfProgramStudi,
} = require("../utils/identity");
const {
  assertSignatures,
  getStaffSignature,
  hasSignature,
} = require("../utils/signature");
const { formatTanggal } = require("../utils/dates");
const { mimeFromFileName } = require("../utils/mime");
const { UPLOAD_RULES, validateUpload } = require("../utils/upload");
const {
  generateNotulenSeminarProposalFTI,
} = require("../services/generateNotulenSeminarProposalFTI");
const {
  generateHalamanPengesahanSeminarProposalFTI,
} = require("../services/generateHalamanPengesahanSeminarProposalFTI");
const {
  JENIS,
  resolveJenis,
  resolveReadTarget: resolveReadTargetShared,
  countSidang,
} = require("../services/sidangScope.service");
const { finishSeminarPhase } = require("../services/skSkripsiLanjutan.service");
const { revisiStageOrderFor } = require("../utils/workflowStage");

// A Seminar Bisnis Digital has a single penguji (stored as PENGUJI_1), so its chain has 3 stages.
const stageOrderFor = revisiStageOrderFor;

const HARI_ID = ["Minggu", "Senin", "Selasa", "Rabu", "Kamis", "Jumat", "Sabtu"];

const NOTULEN_ROLE_LABEL = {
  PENGUJI_1: "Penguji Utama",
  PENGUJI_2: "Anggota Penguji",
};

async function resolveUserId(conn, nidn) {
  if (!nidn) return null;
  const [[row]] = await conn.query(
    `SELECT id FROM users WHERE nidn = ? AND is_active = 1 ORDER BY id ASC LIMIT 1`,
    [nidn],
  );
  return row?.id ?? null;
}

async function getUserIdByNpm(conn, npm) {
  if (!npm) return null;
  const [[row]] = await conn.query(
    `SELECT id FROM users WHERE npm = ? AND is_active = 1 LIMIT 1`,
    [npm],
  );
  return row?.id ?? null;
}

async function getSigByNidn(conn, nidn) {
  if (!nidn) return null;
  const [[row]] = await conn.query(
    `SELECT dsnTtd AS signature_image
     FROM widya_miko.m_dosen
     WHERE dsnId = ?
     LIMIT 1`,
    [nidn],
  );
  return row?.signature_image ?? null;
}

async function getSigByNpm(conn, npm) {
  if (!npm) return null;
  const [[row]] = await conn.query(
    `SELECT signature_image FROM users WHERE npm = ? AND is_active = 1 LIMIT 1`,
    [npm],
  );
  return row?.signature_image ?? null;
}

// Returns the first stage that is not yet APPROVED, or null if all approved / none created
function resolveActiveStage(stages, jenis) {
  for (const role of stageOrderFor(jenis)) {
    const stage = stages.find((s) => s.signer_role === role);
    if (!stage) return null; // next stage not yet created
    if (stage.current_status !== "APPROVED") return stage;
  }
  return null; // all approved
}

function getNidnForRole(sidangRow, role) {
  if (role === "PENGUJI_2") return sidangRow.penguji2_nidn;
  if (role === "PENGUJI_1") return sidangRow.penguji1_nidn;
  if (role === "PEMBIMBING_2") return sidangRow.pembimbing2_nidn;
  if (role === "PEMBIMBING_1") return sidangRow.pembimbing1_nidn;
  return null;
}

function getRoleLabel(role, jenis) {
  if (role === "PENGUJI_1" && jenis === JENIS.SEMINAR_BISNIS_DIGITAL) return "Penguji";
  if (role === "PENGUJI_2") return "Penguji 2";
  if (role === "PENGUJI_1") return "Penguji 1";
  if (role === "PEMBIMBING_2") return "Pembimbing 2";
  if (role === "PEMBIMBING_1") return "Pembimbing 1";
  return role;
}

function isRevisiParticipant(sidangRow, nidn) {
  return (
    nidn &&
    (sidangRow.pembimbing1_nidn === nidn ||
      sidangRow.pembimbing2_nidn === nidn ||
      sidangRow.penguji1_nidn === nidn ||
      sidangRow.penguji2_nidn === nidn)
  );
}

// revisiRow needs npm, program_studi_id, fakultas_id (for the Dekan) and the 4 participant NIDNs.
async function canAccessRevisi(req, revisiRow, { allowDekan = false } = {}) {
  if (req.user.hasRole("STUDENT")) {
    return (await getStudentNpm(req.user.id)) === revisiRow.npm;
  }
  if (req.user.hasRole("SEKRETARIAT")) return true;
  if (allowDekan && req.user.hasRole("DEKAN")) {
    const fakultasIds = await getDekanFakultasIds(req.user.id);
    return fakultasIds.includes(Number(revisiRow.fakultas_id));
  }
  if (req.user.hasRole("KAPRODI")) {
    return isKaprodiOfProgramStudi(req.user.id, revisiRow.program_studi_id);
  }
  return !!isRevisiParticipant(revisiRow, await getLecturerNidn(req.user.id));
}

async function generateHalamanPengesahanMajelisDoc(conn, sidangRow) {
  const tanggalStr = sidangRow.tanggal_sidang
    ? formatTanggal(new Date(sidangRow.tanggal_sidang))
    : "";

  const [sigMhs, sig1, sig2, sigPg1, sigPg2] = await Promise.all([
    getSigByNpm(conn, sidangRow.npm),
    getSigByNidn(conn, sidangRow.pembimbing1_nidn),
    getSigByNidn(conn, sidangRow.pembimbing2_nidn),
    getSigByNidn(conn, sidangRow.penguji1_nidn),
    getSigByNidn(conn, sidangRow.penguji2_nidn),
  ]);

  assertSignatures([
    {
      role: "Mahasiswa",
      nama: sidangRow.nama_mahasiswa,
      signatureImage: sigMhs,
    },
    {
      role: "Pembimbing 1",
      nama: sidangRow.pembimbing1_nama,
      signatureImage: sig1,
    },
    {
      role: "Pembimbing 2",
      nama: sidangRow.pembimbing2_nama,
      signatureImage: sig2,
    },
    {
      role: "Penguji 1",
      nama: sidangRow.penguji1_nama,
      signatureImage: sigPg1,
    },
    {
      role: "Penguji 2",
      nama: sidangRow.penguji2_nama,
      signatureImage: sigPg2,
    },
  ]);

  return generateHalamanPengesahanMajelisPengujiFTI({
    mahasiswa: {
      nama: sidangRow.nama_mahasiswa,
      npm: sidangRow.npm,
      judulSkripsi: sidangRow.judul_skripsi,
      signatureBase64: sigMhs,
    },
    tanggalSidang: tanggalStr,
    majelisPenguji: {
      ketua: { nama: sidangRow.pembimbing1_nama, signatureBase64: sig1 },
      sekretaris: { nama: sidangRow.pembimbing2_nama, signatureBase64: sig2 },
      pengujiUtama: { nama: sidangRow.penguji1_nama, signatureBase64: sigPg1 },
      anggotaPenguji: {
        nama: sidangRow.penguji2_nama,
        signatureBase64: sigPg2,
      },
    },
  });
}

async function generateHalamanPengesahanDekanDoc(conn, sidangRow) {
  const tahun = sidangRow.tanggal_sidang
    ? new Date(sidangRow.tanggal_sidang).getFullYear()
    : new Date().getFullYear();

  const [[prodiRow]] = await conn.query(
    `SELECT ps.fakultas_id, f.dekan_staff_usr_id, s.nama AS dekan_nama
     FROM program_studi ps
     LEFT JOIN fakultas f ON f.id = ps.fakultas_id
     LEFT JOIN staf s ON s.usr_id = f.dekan_staff_usr_id
     WHERE ps.id = ?
     LIMIT 1`,
    [sidangRow.program_studi_id],
  );

  const dekanStaffUsrId = prodiRow?.dekan_staff_usr_id ?? null;
  const dekanNama = prodiRow?.dekan_nama ?? "";

  const [sigMhs, sig1, sig2, sigDekan] = await Promise.all([
    getSigByNpm(conn, sidangRow.npm),
    getSigByNidn(conn, sidangRow.pembimbing1_nidn),
    getSigByNidn(conn, sidangRow.pembimbing2_nidn),
    getStaffSignature(conn, dekanStaffUsrId),
  ]);

  assertSignatures([
    {
      role: "Mahasiswa",
      nama: sidangRow.nama_mahasiswa,
      signatureImage: sigMhs,
    },
    {
      role: "Pembimbing 1",
      nama: sidangRow.pembimbing1_nama,
      signatureImage: sig1,
    },
    {
      role: "Pembimbing 2",
      nama: sidangRow.pembimbing2_nama,
      signatureImage: sig2,
    },
    { role: "Dekan", nama: dekanNama, signatureImage: sigDekan },
  ]);

  return generateHalamanPengesahanDekanFTI({
    mahasiswa: {
      nama: sidangRow.nama_mahasiswa,
      npm: sidangRow.npm,
      judulSkripsi: sidangRow.judul_skripsi,
      signatureBase64: sigMhs,
    },
    pembimbing: {
      pertama: { nama: sidangRow.pembimbing1_nama, signatureBase64: sig1 },
      kedua: { nama: sidangRow.pembimbing2_nama, signatureBase64: sig2 },
    },
    dekan: { nama: dekanNama, signatureBase64: sigDekan },
    programStudi: (sidangRow.program_studi_nama ?? "").toUpperCase(),
    tahunPenulisan: String(tahun),
  });
}

// Halaman Pengesahan Proposal Skripsi: original title, the seminar date and the 3 dosen signatures
// (no student or Dekan signature).
async function generateHalamanPengesahanSeminarDoc(conn, revisiRow) {
  const tanggalSidang = revisiRow.tanggal_sidang
    ? new Date(revisiRow.tanggal_sidang)
    : null;
  const [sig1, sig2, sigPg] = await Promise.all([
    getSigByNidn(conn, revisiRow.pembimbing1_nidn),
    getSigByNidn(conn, revisiRow.pembimbing2_nidn),
    getSigByNidn(conn, revisiRow.penguji1_nidn),
  ]);

  assertSignatures([
    { role: "Pembimbing 1", nama: revisiRow.pembimbing1_nama, signatureImage: sig1 },
    { role: "Pembimbing 2", nama: revisiRow.pembimbing2_nama, signatureImage: sig2 },
    { role: "Penguji", nama: revisiRow.penguji1_nama, signatureImage: sigPg },
  ]);

  return generateHalamanPengesahanSeminarProposalFTI({
    mahasiswa: {
      nama: revisiRow.nama_mahasiswa,
      npm: revisiRow.mahasiswa_npm,
      judulSkripsi: revisiRow.judul_skripsi,
    },
    hari: tanggalSidang ? HARI_ID[tanggalSidang.getDay()] : "",
    tanggal: tanggalSidang ? formatTanggal(tanggalSidang) : "",
    majelisPenguji: {
      pembimbingUtama: { nama: revisiRow.pembimbing1_nama, signatureBase64: sig1 },
      pembimbingKedua: { nama: revisiRow.pembimbing2_nama, signatureBase64: sig2 },
      pengujiUtama: { nama: revisiRow.penguji1_nama, signatureBase64: sigPg },
    },
    programStudi: (revisiRow.program_studi_nama ?? "").toUpperCase(),
    tahunPenulisan: String(
      tanggalSidang ? tanggalSidang.getFullYear() : new Date().getFullYear(),
    ),
  });
}

const REVISI_CHANGED_MESSAGE =
  "Data revisi berubah saat sedang diproses. Silakan muat ulang halaman dan kirim kembali.";
const MAX_FILE_NAME_LENGTH = 255;

// Reads take an optional ?sidangId= to open one specific attempt (one revisi per sidang) instead of
// the latest sidang's revisi. Shared with the sidang file downloads (sidangScope.service.js); throws
// 400/404, which the callers' catch passes to next(). Returns { jenis, sidangId }.
function resolveReadTarget(req, _res, skripsiId) {
  return resolveReadTargetShared(db, skripsiId, req.query ?? {});
}

// The role of a dosen caller in this sidang (same precedence as the lecturer list), or null.
function callerRoleFor(sidangRow, nidn) {
  if (!nidn) return null;
  for (const role of ["PENGUJI_2", "PENGUJI_1", "PEMBIMBING_2", "PEMBIMBING_1"]) {
    if (getNidnForRole(sidangRow, role) === nidn) return role;
  }
  return null;
}

// Signatures the revisi's remaining documents will need and that are missing now, using the same
// lookups the generators use but without rendering. A 409 from the Dekan lookup (ambiguous SIMIKO
// name) is reported as missing instead of failing the read.
async function computeMissingSignatures(revisi, stages, jenis) {
  if (revisi.is_completed) return [];
  const isSeminar = jenis === JENIS.SEMINAR_BISNIS_DIGITAL;
  const approved = new Set(
    stages.filter((s) => s.current_status === "APPROVED").map((s) => s.signer_role),
  );
  const needs = new Map();
  const needDosen = (role) =>
    needs.set(`D:${getNidnForRole(revisi, role)}`, {
      kind: "DOSEN",
      role: getRoleLabel(role, jenis),
      nama: getNidnForRole(revisi, role) ? (revisi[`${role.replace("_", "").toLowerCase()}_nama`] ?? "") : "",
      nidn: getNidnForRole(revisi, role),
    });
  let needMahasiswa = false;
  let needDekan = false;

  if (isSeminar && revisi.hasil_sidang === "JUDUL_DITERIMA") {
    ["PEMBIMBING_1", "PEMBIMBING_2", "PENGUJI_1"].forEach(needDosen);
  } else if (revisi.hasil_sidang === "LULUS") {
    ["PEMBIMBING_1", "PEMBIMBING_2", "PENGUJI_1", "PENGUJI_2"].forEach(needDosen);
    needMahasiswa = true;
    needDekan = true;
  } else if (revisi.hasil_sidang === "TIDAK_LULUS") {
    const [notulen] = await db.query(
      `SELECT role FROM sidang_notulen WHERE sidang_id = ? AND submitted_at IS NOT NULL`,
      [revisi.sidang_id],
    );
    for (const { role } of notulen) {
      if (!approved.has(role)) needDosen(role);
    }
  }

  const missing = [];
  const lookups = [];
  for (const need of needs.values()) {
    lookups.push(
      getSigByNidn(db, need.nidn).then((sig) => {
        if (!hasSignature(sig)) missing.push({ role: need.role, nama: need.nama, kind: "DOSEN" });
      }),
    );
  }
  if (needMahasiswa) {
    lookups.push(
      getSigByNpm(db, revisi.mahasiswa_npm).then((sig) => {
        if (!hasSignature(sig)) {
          missing.push({ role: "Mahasiswa", nama: revisi.nama_mahasiswa ?? "", kind: "MAHASISWA" });
        }
      }),
    );
  }
  if (needDekan) {
    lookups.push(
      (async () => {
        const [[prodi]] = await db.query(
          `SELECT f.dekan_staff_usr_id, s.nama AS dekan_nama
           FROM program_studi ps
           LEFT JOIN fakultas f ON f.id = ps.fakultas_id
           LEFT JOIN staf s ON s.usr_id = f.dekan_staff_usr_id
           WHERE ps.id = ? LIMIT 1`,
          [revisi.program_studi_id],
        );
        let sig = null;
        try {
          sig = await getStaffSignature(db, prodi?.dekan_staff_usr_id ?? null);
        } catch (err) {
          if (err.statusCode !== 409) throw err;
        }
        if (!hasSignature(sig)) {
          missing.push({ role: "Dekan", nama: prodi?.dekan_nama ?? "", kind: "DEKAN" });
        }
      })(),
    );
  }
  await Promise.all(lookups);
  const order = ["Mahasiswa", "Pembimbing 1", "Pembimbing 2", "Penguji", "Penguji 1", "Penguji 2", "Dekan"];
  return missing.sort((a, b) => order.indexOf(a.role) - order.indexOf(b.role));
}

// POST /revisi-pasca-sidang/:skripsiId/init
exports.initRevisi = async (req, res, next) => {
  let conn = null;
  let txStarted = false;
  try {
    const skripsiId = Number(req.params.skripsiId);
    if (!Number.isFinite(skripsiId) || skripsiId <= 0) {
      return res.status(400).json({ ok: false, message: "Invalid skripsiId" });
    }

    const npm = await getStudentNpm(req.user.id);
    if (!npm) {
      return res.status(403).json({
        ok: false,
        message: "Hanya mahasiswa yang dapat menginisiasi revisi",
      });
    }

    const jenis = await resolveJenis(db, skripsiId);
    const [[sidang]] = await db.query(
      `SELECT s.id, s.status, s.hasil_sidang, s.pengajuan_sidang_id,
              m.npm,
              psk_k.penguji1_nidn, psk_k.penguji2_nidn
       FROM sidang s
       JOIN skripsi sk ON sk.id = s.skripsi_id
       JOIN mahasiswa m ON m.npm = sk.npm
       LEFT JOIN pengajuan_sidang_kaprodi psk_k
              ON psk_k.pengajuan_sidang_id = s.pengajuan_sidang_id
       WHERE s.skripsi_id = ? AND s.jenis = ?
       ORDER BY s.id DESC LIMIT 1`,
      [skripsiId, jenis],
    );
    if (!sidang) {
      return res
        .status(404)
        .json({ ok: false, message: "Sidang tidak ditemukan" });
    }
    if (sidang.npm !== npm) {
      return res.status(403).json({ ok: false, message: "Forbidden" });
    }
    if (sidang.status !== "COMPLETED") {
      return res
        .status(409)
        .json({ ok: false, message: "Sidang belum selesai" });
    }
    if (sidang.hasil_sidang === "GAGAL" || sidang.hasil_sidang === "JUDUL_DITOLAK") {
      return res.status(409).json({
        ok: false,
        message:
          sidang.hasil_sidang === "GAGAL"
            ? "Sidang dinyatakan GAGAL, tidak ada revisi pasca sidang. Silakan mengulang dari pengajuan outline."
            : "Judul tidak diterima, tidak ada revisi pasca seminar. Silakan mengulang dari pengajuan outline.",
      });
    }
    const firstRole = stageOrderFor(jenis)[0];

    const respondExisting = async (existing) => {
      if (!existing.is_completed) {
        const [[existingStage]] = await db.query(
          `SELECT id FROM revisi_pasca_sidang_stages WHERE revisi_id = ? AND signer_role = ? LIMIT 1`,
          [existing.id, firstRole],
        );
        if (!existingStage) {
          const firstUserId = await resolveUserId(
            db,
            getNidnForRole(sidang, firstRole),
          );
          await db.query(
            `INSERT IGNORE INTO revisi_pasca_sidang_stages (revisi_id, signer_role, user_id, started_at)
             VALUES (?, ?, ?, NOW())`,
            [existing.id, firstRole, firstUserId],
          );
        }
      }
      return res.json({
        ok: true,
        data: { id: existing.id, isCompleted: !!existing.is_completed },
      });
    };

    const findExisting = async () => {
      const [[row]] = await db.query(
        `SELECT id, is_completed FROM revisi_pasca_sidang WHERE sidang_id = ? LIMIT 1`,
        [sidang.id],
      );
      return row ?? null;
    };

    const existing = await findExisting();
    if (existing) return await respondExisting(existing);

    conn = await db.getConnection();
    await conn.beginTransaction();
    txStarted = true;

    let revisiId;
    try {
      const [result] = await conn.query(
        `INSERT INTO revisi_pasca_sidang (sidang_id) VALUES (?)`,
        [sidang.id],
      );
      revisiId = result.insertId;
    } catch (err) {
      if (err.code !== "ER_DUP_ENTRY") throw err;
      await conn.rollback();
      txStarted = false;
      conn.release();
      conn = null;
      const duplicate = await findExisting();
      if (!duplicate) throw err;
      return await respondExisting(duplicate);
    }

    // Create first stage lazily: PENGUJI_2 (Skripsi) or the single penguji (Seminar)
    const firstUserId = await resolveUserId(
      conn,
      getNidnForRole(sidang, firstRole),
    );
    await conn.query(
      `INSERT IGNORE INTO revisi_pasca_sidang_stages (revisi_id, signer_role, user_id, started_at)
       VALUES (?, ?, ?, NOW())`,
      [revisiId, firstRole, firstUserId],
    );

    await conn.commit();
    txStarted = false;

    return res
      .status(201)
      .json({ ok: true, data: { id: revisiId, isCompleted: false } });
  } catch (err) {
    try {
      if (txStarted) await conn.rollback();
    } catch (_) {}
    next(err);
  } finally {
    conn?.release();
  }
};

// POST /revisi-pasca-sidang/:skripsiId/submit
exports.submitRevisi = async (req, res, next) => {
  let conn = null;
  let txStarted = false;
  try {
    const skripsiId = Number(req.params.skripsiId);
    if (!Number.isFinite(skripsiId) || skripsiId <= 0) {
      return res.status(400).json({ ok: false, message: "Invalid skripsiId" });
    }

    const npm = await getStudentNpm(req.user.id);
    if (!npm) {
      return res.status(403).json({
        ok: false,
        message: "Hanya mahasiswa yang dapat mengunggah revisi",
      });
    }

    const { fileContent, fileName } = req.body;
    if (!fileContent || !fileName) {
      return res
        .status(400)
        .json({ ok: false, message: "fileContent dan fileName wajib diisi" });
    }
    if (typeof fileContent !== "string" || typeof fileName !== "string") {
      return res
        .status(400)
        .json({ ok: false, message: "fileContent dan fileName harus berupa teks" });
    }
    if (fileName.length > MAX_FILE_NAME_LENGTH) {
      return res.status(400).json({
        ok: false,
        message: `Nama file maksimal ${MAX_FILE_NAME_LENGTH} karakter`,
      });
    }
    const uploadError = validateUpload(
      fileContent,
      fileName,
      UPLOAD_RULES.DOCUMENT,
      "File revisi",
    );
    if (uploadError) {
      return res.status(400).json({ ok: false, message: uploadError });
    }
    const jenis = await resolveJenis(db, skripsiId);

    conn = await db.getConnection();
    await conn.beginTransaction();
    txStarted = true;

    const [[revisi]] = await conn.query(
      `SELECT rps.*,
              m.npm, m.nama AS nama_mahasiswa,
              sk.pembimbing1_nidn, sk.pembimbing2_nidn,
              psk_k.penguji1_nidn, psk_k.penguji2_nidn,
              d1.nama AS pembimbing1_nama, d2.nama AS pembimbing2_nama,
              d_pg1.nama AS penguji1_nama, d_pg2.nama AS penguji2_nama
       FROM sidang s
       LEFT JOIN revisi_pasca_sidang rps ON rps.sidang_id = s.id
       JOIN skripsi sk ON sk.id = s.skripsi_id
       JOIN mahasiswa m ON m.npm = sk.npm
       LEFT JOIN dosen d1 ON d1.nidn = sk.pembimbing1_nidn
       LEFT JOIN dosen d2 ON d2.nidn = sk.pembimbing2_nidn
       LEFT JOIN pengajuan_sidang_kaprodi psk_k
              ON psk_k.pengajuan_sidang_id = s.pengajuan_sidang_id
       LEFT JOIN dosen d_pg1 ON d_pg1.nidn = psk_k.penguji1_nidn
       LEFT JOIN dosen d_pg2 ON d_pg2.nidn = psk_k.penguji2_nidn
       WHERE s.skripsi_id = ? AND s.jenis = ? ORDER BY s.id DESC LIMIT 1`,
      [skripsiId, jenis],
    );
    if (!revisi?.id) {
      await conn.rollback();
      txStarted = false;
      return res
        .status(404)
        .json({ ok: false, message: "Revisi belum diinisiasi" });
    }
    if (revisi.npm !== npm) {
      await conn.rollback();
      txStarted = false;
      return res.status(403).json({ ok: false, message: "Forbidden" });
    }
    if (revisi.is_completed) {
      await conn.rollback();
      txStarted = false;
      return res
        .status(409)
        .json({ ok: false, message: "Revisi sudah selesai" });
    }

    const [stages] = await conn.query(
      `SELECT * FROM revisi_pasca_sidang_stages WHERE revisi_id = ? FOR UPDATE`,
      [revisi.id],
    );

    const activeStage = resolveActiveStage(stages, jenis);
    if (!activeStage) {
      await conn.rollback();
      txStarted = false;
      return res
        .status(409)
        .json({ ok: false, message: "Tidak ada tahap aktif saat ini" });
    }
    if (activeStage.current_status === "SUBMITTED") {
      await conn.rollback();
      txStarted = false;
      return res
        .status(409)
        .json({ ok: false, message: "File sudah diunggah, menunggu review" });
    }
    if (
      activeStage.current_status !== "WAITING_SUBMISSION" &&
      activeStage.current_status !== "NEED_REVISION"
    ) {
      await conn.rollback();
      txStarted = false;
      return res
        .status(409)
        .json({ ok: false, message: "Tidak dapat mengunggah file saat ini" });
    }

    const nextSubmissionNo = activeStage.current_submission_no + 1;

    await conn.query(
      `INSERT INTO revisi_pasca_sidang_submissions (stage_id, submission_no, file_content, file_name, submitted_at)
       VALUES (?, ?, ?, ?, NOW())`,
      [activeStage.id, nextSubmissionNo, fileContent, fileName],
    );

    await conn.query(
      `UPDATE revisi_pasca_sidang_stages
       SET current_submission_no = ?, current_status = 'SUBMITTED', updated_at = NOW()
       WHERE id = ?`,
      [nextSubmissionNo, activeStage.id],
    );

    const signerUserId =
      activeStage.user_id ??
      (await resolveUserId(conn, getNidnForRole(revisi, activeStage.signer_role)));
    await insertNotification(
      conn,
      signerUserId,
      "REVISI_PASCA_SIDANG",
      `Mahasiswa ${revisi.nama_mahasiswa} telah mengunggah revisi dan menunggu review Anda`,
      `/pembimbing/revisi-pasca-sidang/${skripsiId}`,
    );

    await conn.commit();
    txStarted = false;

    return res.json({
      ok: true,
      data: {
        stageId: activeStage.id,
        signerRole: activeStage.signer_role,
        submissionNo: nextSubmissionNo,
      },
    });
  } catch (err) {
    try {
      if (txStarted) await conn.rollback();
    } catch (_) {}
    next(err);
  } finally {
    conn?.release();
  }
};

// POST /revisi-pasca-sidang/:skripsiId/review
// Every PDF is rendered before the transaction (each render launches its own Chromium), so no row
// lock or pool connection is held meanwhile; the transaction then re-checks that the stage is
// still the one that was reviewed.
exports.reviewRevisi = async (req, res, next) => {
  let conn = null;
  let txStarted = false;
  try {
    const skripsiId = Number(req.params.skripsiId);
    if (!Number.isFinite(skripsiId) || skripsiId <= 0) {
      return res.status(400).json({ ok: false, message: "Invalid skripsiId" });
    }

    const nidn = await getLecturerNidn(req.user.id);
    if (!nidn) {
      return res
        .status(403)
        .json({ ok: false, message: "Hanya dosen yang dapat mereview revisi" });
    }

    const { decision, catatan, reviewFile, reviewFileName } = req.body;
    if (!decision || !["APPROVED", "NEED_REVISION"].includes(decision)) {
      return res.status(400).json({
        ok: false,
        message: "decision harus APPROVED atau NEED_REVISION",
      });
    }
    if (catatan !== undefined && catatan !== null && typeof catatan !== "string") {
      return res
        .status(400)
        .json({ ok: false, message: "catatan harus berupa teks" });
    }
    const catatanText = (catatan ?? "").trim();
    if (catatanText.length > 5000) {
      return res
        .status(400)
        .json({ ok: false, message: "Catatan maksimal 5000 karakter" });
    }
    if (decision === "NEED_REVISION" && !catatanText) {
      return res.status(400).json({
        ok: false,
        message: "catatan wajib diisi untuk NEED_REVISION",
      });
    }

    if (
      reviewFile !== undefined &&
      reviewFile !== null &&
      typeof reviewFile !== "string"
    ) {
      return res
        .status(400)
        .json({ ok: false, message: "reviewFile harus berupa teks" });
    }
    const hasReviewFile =
      reviewFile !== undefined &&
      reviewFile !== null &&
      String(reviewFile) !== "";
    const safeReviewFileName = String(reviewFileName ?? "").trim();
    if (hasReviewFile) {
      if (!safeReviewFileName) {
        return res.status(400).json({
          ok: false,
          message: "reviewFileName is required when reviewFile is provided",
        });
      }
      if (safeReviewFileName.length > MAX_FILE_NAME_LENGTH) {
        return res.status(400).json({
          ok: false,
          message: `Nama file maksimal ${MAX_FILE_NAME_LENGTH} karakter`,
        });
      }
      const uploadError = validateUpload(
        reviewFile,
        safeReviewFileName,
        UPLOAD_RULES.SKRIPSI_CHAPTER,
        "File review",
      );
      if (uploadError) {
        return res.status(400).json({ ok: false, message: uploadError });
      }
    }
    const jenis = await resolveJenis(db, skripsiId);

    const [[revisi]] = await db.query(
      `SELECT rps.*,
              m.nama AS nama_mahasiswa, m.npm AS mahasiswa_npm,
              sk.judul AS judul_skripsi,
              prog.id AS program_studi_id, prog.nama AS program_studi_nama,
              psk_k.tanggal_sidang,
              sk.pembimbing1_nidn, sk.pembimbing2_nidn,
              psk_k.penguji1_nidn, psk_k.penguji2_nidn,
              d1.nama AS pembimbing1_nama, d2.nama AS pembimbing2_nama,
              d_pg1.nama AS penguji1_nama, d_pg2.nama AS penguji2_nama,
              s.hasil_sidang
       FROM sidang s
       LEFT JOIN revisi_pasca_sidang rps ON rps.sidang_id = s.id
       JOIN skripsi sk ON sk.id = s.skripsi_id
       JOIN mahasiswa m ON m.npm = sk.npm
       JOIN program_studi prog ON prog.id = sk.program_studi_id
       LEFT JOIN dosen d1 ON d1.nidn = sk.pembimbing1_nidn
       LEFT JOIN dosen d2 ON d2.nidn = sk.pembimbing2_nidn
       LEFT JOIN pengajuan_sidang_kaprodi psk_k
              ON psk_k.pengajuan_sidang_id = s.pengajuan_sidang_id
       LEFT JOIN dosen d_pg1 ON d_pg1.nidn = psk_k.penguji1_nidn
       LEFT JOIN dosen d_pg2 ON d_pg2.nidn = psk_k.penguji2_nidn
       WHERE s.skripsi_id = ? AND s.jenis = ? ORDER BY s.id DESC LIMIT 1`,
      [skripsiId, jenis],
    );
    if (!revisi?.id) {
      return res
        .status(404)
        .json({ ok: false, message: "Revisi tidak ditemukan" });
    }
    if (revisi.is_completed) {
      return res
        .status(409)
        .json({ ok: false, message: "Revisi sudah selesai" });
    }

    const [stages] = await db.query(
      `SELECT * FROM revisi_pasca_sidang_stages WHERE revisi_id = ?`,
      [revisi.id],
    );

    const activeStage = resolveActiveStage(stages, jenis);
    if (!activeStage) {
      return res
        .status(409)
        .json({ ok: false, message: "Tidak ada tahap aktif saat ini" });
    }
    // The turn belongs to the NIDN of the stage's role; stage.user_id is only informational
    // (it is NULL when the signer had no active account when the stage was created).
    const roleNidn = getNidnForRole(revisi, activeStage.signer_role);
    if (!roleNidn || roleNidn !== nidn) {
      return res
        .status(403)
        .json({ ok: false, message: "Belum giliran Anda untuk mereview" });
    }
    if (activeStage.current_status !== "SUBMITTED") {
      if (
        activeStage.current_status === "WAITING_SUBMISSION" ||
        activeStage.current_status === "NEED_REVISION"
      ) {
        return res
          .status(409)
          .json({ ok: false, message: "Mahasiswa belum mengunggah file" });
      }
      return res
        .status(409)
        .json({ ok: false, message: "Tidak dapat mereview saat ini" });
    }

    const stageOrder = stageOrderFor(jenis);
    const nextRole =
      stageOrder[stageOrder.indexOf(activeStage.signer_role) + 1] ?? null;
    const isFinalApproval = decision === "APPROVED" && !nextRole;

    // Documents this approval produces, rendered one after another before any lock is taken.
    let notulenRow = null;
    let notulenBuffer = null;
    let halamanSeminarBuffer = null;
    let majelisBuffer = null;
    let dekanBuffer = null;

    if (
      decision === "APPROVED" &&
      ["PENGUJI_2", "PENGUJI_1"].includes(activeStage.signer_role)
    ) {
      const [[row]] = await db.query(
        `SELECT sn.*,
                m.npm, m.nama AS nama_mahasiswa,
                prog.nama AS program_studi_nama,
                sk.judul AS judul_skripsi,
                d1.nama AS pembimbing1_nama, d2.nama AS pembimbing2_nama,
                d_pg1.nama AS penguji1_nama, d_pg2.nama AS penguji2_nama,
                psk_k.tanggal_sidang
         FROM sidang_notulen sn
         JOIN sidang s ON s.id = sn.sidang_id
         JOIN skripsi sk ON sk.id = s.skripsi_id
         JOIN mahasiswa m ON m.npm = sk.npm
         JOIN program_studi prog ON prog.id = sk.program_studi_id
         LEFT JOIN dosen d1 ON d1.nidn = sk.pembimbing1_nidn
         LEFT JOIN dosen d2 ON d2.nidn = sk.pembimbing2_nidn
         LEFT JOIN pengajuan_sidang_kaprodi psk_k
                ON psk_k.pengajuan_sidang_id = s.pengajuan_sidang_id
         LEFT JOIN dosen d_pg1 ON d_pg1.nidn = psk_k.penguji1_nidn
         LEFT JOIN dosen d_pg2 ON d_pg2.nidn = psk_k.penguji2_nidn
         WHERE sn.sidang_id = ? AND sn.role = ?`,
        [revisi.sidang_id, activeStage.signer_role],
      );
      notulenRow = row ?? null;
      if (notulenRow && notulenRow.submitted_at) {
        const sigImage = await getSigByNidn(db, roleNidn);
        const namaPenguji =
          activeStage.signer_role === "PENGUJI_1"
            ? notulenRow.penguji1_nama
            : notulenRow.penguji2_nama;
        assertSignatures([
          {
            role: getRoleLabel(activeStage.signer_role, jenis),
            nama: namaPenguji,
            signatureImage: sigImage,
          },
        ]);
        const mahasiswa = {
          npm: notulenRow.npm,
          nama: notulenRow.nama_mahasiswa,
          programStudi: notulenRow.program_studi_nama,
          judulSkripsi: notulenRow.judul_skripsi,
        };
        const pembimbing = {
          pertama: notulenRow.pembimbing1_nama,
          kedua: notulenRow.pembimbing2_nama,
        };
        const tanggal = notulenRow.tanggal_sidang
          ? formatTanggal(new Date(notulenRow.tanggal_sidang))
          : "";
        // A Seminar revisi only exists for an accepted title, so its notulen says "Diterima".
        notulenBuffer =
          jenis === JENIS.SEMINAR_BISNIS_DIGITAL
            ? await generateNotulenSeminarProposalFTI({
                mahasiswa,
                pembimbing,
                tanggalSeminar: tanggal,
                hasilSeminar: "Diterima",
                penguji: { nama: namaPenguji, signatureBase64: sigImage },
                note: notulenRow.note,
              })
            : await generateNotulenPengujiFTI({
                mahasiswa,
                pembimbing,
                tanggalSidang: tanggal,
                hasilSidang:
                  notulenRow.hasil_sidang === "LULUS" ? "Lulus" : "Tidak Lulus",
                penguji: {
                  role: NOTULEN_ROLE_LABEL[activeStage.signer_role],
                  nama: namaPenguji,
                  signatureBase64: sigImage,
                },
                note: notulenRow.note,
              });
      }
    }

    if (isFinalApproval) {
      if (revisi.hasil_sidang === "JUDUL_DITERIMA") {
        halamanSeminarBuffer = await generateHalamanPengesahanSeminarDoc(db, revisi);
      }
      if (revisi.hasil_sidang === "LULUS") {
        const sidangForDoc = {
          judul_skripsi: revisi.judul_skripsi,
          nama_mahasiswa: revisi.nama_mahasiswa,
          npm: revisi.mahasiswa_npm,
          tanggal_sidang: revisi.tanggal_sidang,
          program_studi_id: revisi.program_studi_id,
          program_studi_nama: revisi.program_studi_nama,
          pembimbing1_nidn: revisi.pembimbing1_nidn,
          pembimbing1_nama: revisi.pembimbing1_nama,
          pembimbing2_nidn: revisi.pembimbing2_nidn,
          pembimbing2_nama: revisi.pembimbing2_nama,
          penguji1_nidn: revisi.penguji1_nidn,
          penguji1_nama: revisi.penguji1_nama,
          penguji2_nidn: revisi.penguji2_nidn,
          penguji2_nama: revisi.penguji2_nama,
        };
        majelisBuffer = await generateHalamanPengesahanMajelisDoc(db, sidangForDoc);
        dekanBuffer = await generateHalamanPengesahanDekanDoc(db, sidangForDoc);
      }
    }

    conn = await db.getConnection();
    await conn.beginTransaction();
    txStarted = true;

    const [[lockedRevisi]] = await conn.query(
      `SELECT id, is_completed FROM revisi_pasca_sidang WHERE id = ? FOR UPDATE`,
      [revisi.id],
    );
    const [lockedStages] = await conn.query(
      `SELECT * FROM revisi_pasca_sidang_stages WHERE revisi_id = ? FOR UPDATE`,
      [revisi.id],
    );
    const lockedActive = resolveActiveStage(lockedStages, jenis);
    if (
      !lockedRevisi ||
      lockedRevisi.is_completed ||
      !lockedActive ||
      lockedActive.id !== activeStage.id ||
      lockedActive.signer_role !== activeStage.signer_role ||
      lockedActive.current_submission_no !== activeStage.current_submission_no ||
      lockedActive.current_status !== "SUBMITTED"
    ) {
      await conn.rollback();
      txStarted = false;
      return res.status(409).json({ ok: false, message: REVISI_CHANGED_MESSAGE });
    }

    const [reviewIns] = await conn.query(
      `INSERT INTO revisi_pasca_sidang_reviews (stage_id, submission_no, decision, catatan, reviewed_at)
       VALUES (?, ?, ?, ?, NOW())`,
      [
        activeStage.id,
        activeStage.current_submission_no,
        decision,
        catatanText || null,
      ],
    );

    if (hasReviewFile) {
      await conn.query(
        `INSERT INTO revisi_pasca_sidang_review_file (
           revisi_pasca_sidang_review_id, file_content, file_name, mime_type, uploaded_by_user_id
         ) VALUES (?, ?, ?, ?, ?)`,
        [
          reviewIns.insertId,
          String(reviewFile),
          safeReviewFileName,
          mimeFromFileName(safeReviewFileName),
          req.user.id,
        ],
      );
    }

    if (decision === "NEED_REVISION") {
      await conn.query(
        `UPDATE revisi_pasca_sidang_stages SET current_status = 'NEED_REVISION', updated_at = NOW() WHERE id = ?`,
        [activeStage.id],
      );

      const studentUserId = await getUserIdByNpm(conn, revisi.mahasiswa_npm);
      await insertNotification(
        conn,
        studentUserId,
        "REVISI_PASCA_SIDANG",
        `${getRoleLabel(activeStage.signer_role, jenis)} meminta revisi: ${catatanText}`,
        `/student/revisi-pasca-sidang/${skripsiId}`,
      );
    } else {
      await conn.query(
        `UPDATE revisi_pasca_sidang_stages SET current_status = 'APPROVED', finished_at = NOW(), updated_at = NOW() WHERE id = ?`,
        [activeStage.id],
      );

      if (notulenBuffer) {
        await conn.query(
          `UPDATE sidang_notulen SET file_content = ?, file_name = ?, updated_at = NOW() WHERE sidang_id = ? AND role = ?`,
          [
            Buffer.from(notulenBuffer).toString("base64"),
            `Notulen_${activeStage.signer_role}_${notulenRow.npm}.pdf`,
            revisi.sidang_id,
            activeStage.signer_role,
          ],
        );
      }

      if (nextRole) {
        const nextNidn = getNidnForRole(revisi, nextRole);
        const nextUserId = await resolveUserId(conn, nextNidn);

        await conn.query(
          `INSERT INTO revisi_pasca_sidang_stages (revisi_id, signer_role, user_id, started_at)
           VALUES (?, ?, ?, NOW())`,
          [revisi.id, nextRole, nextUserId],
        );

        const studentUserId = await getUserIdByNpm(conn, revisi.mahasiswa_npm);
        await insertNotification(
          conn,
          studentUserId,
          "REVISI_PASCA_SIDANG",
          `${getRoleLabel(activeStage.signer_role, jenis)} menyetujui revisi. Silakan unggah file ke ${getRoleLabel(nextRole, jenis)}`,
          `/student/revisi-pasca-sidang/${skripsiId}`,
        );

        await insertNotification(
          conn,
          nextUserId,
          "REVISI_PASCA_SIDANG",
          `Mahasiswa ${revisi.nama_mahasiswa} akan mengunggah revisi untuk ditandatangani`,
          `/pembimbing/revisi-pasca-sidang/${skripsiId}`,
        );
      } else {
        // PEMBIMBING_1 approved — last stage
        if (halamanSeminarBuffer) {
          await conn.query(
            `INSERT INTO revisi_pasca_sidang_files (revisi_id, file_type, file_name, file_content)
             VALUES (?, 'HALAMAN_PENGESAHAN_SEMINAR_BD', ?, ?)
             ON DUPLICATE KEY UPDATE file_name = VALUES(file_name), file_content = VALUES(file_content)`,
            [
              revisi.id,
              `Halaman_Pengesahan_Proposal_Skripsi_${revisi.mahasiswa_npm}.pdf`,
              Buffer.from(halamanSeminarBuffer).toString("base64"),
            ],
          );
          await finishSeminarPhase(conn, {
            skripsiId,
            seminarSidangId: revisi.sidang_id,
          });
        }
        if (majelisBuffer && dekanBuffer) {
          await conn.query(
            `INSERT INTO revisi_pasca_sidang_files (revisi_id, file_type, file_name, file_content)
             VALUES (?, 'HALAMAN_PENGESAHAN_MAJELIS_PENGUJI', ?, ?)
             ON DUPLICATE KEY UPDATE file_name = VALUES(file_name), file_content = VALUES(file_content)`,
            [
              revisi.id,
              `Halaman_Pengesahan_Majelis_Penguji_${revisi.mahasiswa_npm}.pdf`,
              Buffer.from(majelisBuffer).toString("base64"),
            ],
          );
          await conn.query(
            `INSERT INTO revisi_pasca_sidang_files (revisi_id, file_type, file_name, file_content)
             VALUES (?, 'HALAMAN_PENGESAHAN_DEKAN', ?, ?)
             ON DUPLICATE KEY UPDATE file_name = VALUES(file_name), file_content = VALUES(file_content)`,
            [
              revisi.id,
              `Halaman_Pengesahan_Dekan_${revisi.mahasiswa_npm}.pdf`,
              Buffer.from(dekanBuffer).toString("base64"),
            ],
          );
        }

        await conn.query(
          `UPDATE revisi_pasca_sidang SET is_completed = 1, updated_at = NOW() WHERE id = ?`,
          [revisi.id],
        );

        const studentUserId = await getUserIdByNpm(conn, revisi.mahasiswa_npm);
        const completionMessage =
          revisi.hasil_sidang === "JUDUL_DITERIMA"
            ? "Revisi pasca seminar proposal Anda telah selesai. Halaman pengesahan proposal skripsi telah digenerate. Selanjutnya Kaprodi meneruskan ke Sekretariat untuk penerbitan SK Penulisan Skripsi."
            : revisi.hasil_sidang === "LULUS"
              ? "Revisi pasca sidang Anda telah selesai. Halaman pengesahan telah digenerate."
              : "Revisi pasca sidang Anda telah selesai. Silakan daftar ujian ulang.";
        await insertNotification(
          conn,
          studentUserId,
          "REVISI_PASCA_SIDANG",
          completionMessage,
          revisi.hasil_sidang === "TIDAK_LULUS"
            ? "/student/pengajuan-sidang"
            : `/student/revisi-pasca-sidang/${skripsiId}`,
        );

        if (revisi.hasil_sidang === "TIDAK_LULUS") {
          const ujianKe = (await countSidang(conn, skripsiId, jenis)) + 1;
          await conn.query(
            `INSERT INTO pengajuan_sidang (skripsi_id, jenis, status, ujian_ke) VALUES (?, ?, 'DRAFT', ?)`,
            [skripsiId, jenis, ujianKe],
          );
        }
      }
    }

    await conn.commit();
    txStarted = false;

    return res.json({
      ok: true,
      message: "Review berhasil disimpan",
      data: { decision },
    });
  } catch (err) {
    try {
      if (txStarted) await conn.rollback();
    } catch (_) {}
    next(err);
  } finally {
    conn?.release();
  }
};

// GET /revisi-pasca-sidang/:skripsiId
exports.getRevisi = async (req, res, next) => {
  try {
    const skripsiId = Number(req.params.skripsiId);
    if (!Number.isFinite(skripsiId) || skripsiId <= 0) {
      return res.status(400).json({ ok: false, message: "Invalid skripsiId" });
    }

    const target = await resolveReadTarget(req, res, skripsiId);
    if (!target) return;
    const { jenis, sidangId } = target;
    const [[revisi]] = await db.query(
      `SELECT rps.*,
              sk.pembimbing1_nidn, sk.pembimbing2_nidn,
              psk_k.penguji1_nidn, psk_k.penguji2_nidn,
              m.nama AS nama_mahasiswa, m.npm AS mahasiswa_npm,
              COALESCE(lanjutan.judul_seminar, sk.judul) AS judul_skripsi,
              sk.program_studi_id,
              ps.nama AS program_studi_nama,
              d1.nama AS pembimbing1_nama,
              d2.nama AS pembimbing2_nama,
              dq1.nama AS penguji1_nama,
              dq2.nama AS penguji2_nama,
              s.status AS sidang_status, s.hasil_sidang, s.judul_baru
       FROM sidang s
       LEFT JOIN revisi_pasca_sidang rps ON rps.sidang_id = s.id
       JOIN skripsi sk ON sk.id = s.skripsi_id
       JOIN mahasiswa m ON m.npm = sk.npm
       JOIN program_studi ps ON ps.id = sk.program_studi_id
       LEFT JOIN dosen d1 ON d1.nidn = sk.pembimbing1_nidn
       LEFT JOIN dosen d2 ON d2.nidn = sk.pembimbing2_nidn
       LEFT JOIN pengajuan_sidang_kaprodi psk_k
              ON psk_k.pengajuan_sidang_id = s.pengajuan_sidang_id
       LEFT JOIN dosen dq1 ON dq1.nidn = psk_k.penguji1_nidn
       LEFT JOIN dosen dq2 ON dq2.nidn = psk_k.penguji2_nidn
       LEFT JOIN pengajuan_sk_skripsi_lanjutan lanjutan ON lanjutan.seminar_sidang_id = s.id
       WHERE s.skripsi_id = ? AND ${sidangId ? "s.id = ?" : "s.jenis = ?"} ORDER BY s.id DESC LIMIT 1`,
      [skripsiId, sidangId ?? jenis],
    );
    if (!revisi?.id) {
      return res
        .status(404)
        .json({ ok: false, message: "Revisi tidak ditemukan" });
    }

    if (!(await canAccessRevisi(req, { ...revisi, npm: revisi.mahasiswa_npm }))) {
      return res.status(403).json({ ok: false, message: "Forbidden" });
    }

    const [[latest]] = await db.query(
      `SELECT MAX(id) AS id FROM sidang WHERE skripsi_id = ? AND jenis = ?`,
      [skripsiId, jenis],
    );
    const isLatestAttempt = Number(latest?.id) === Number(revisi.sidang_id);

    const [stages] = await db.query(
      `SELECT id, signer_role, user_id, current_status, current_submission_no, started_at, finished_at
       FROM revisi_pasca_sidang_stages
       WHERE revisi_id = ?
       ORDER BY FIELD(signer_role, 'PENGUJI_2', 'PENGUJI_1', 'PEMBIMBING_2', 'PEMBIMBING_1')`,
      [revisi.id],
    );

    // Fetch all submissions and reviews for all stages in bulk
    const stageIds = stages.map((s) => s.id);

    const [allSubmissions, allReviews] = stageIds.length
      ? await Promise.all([
          db
            .query(
              `SELECT id, stage_id, submission_no, file_name, submitted_at
             FROM revisi_pasca_sidang_submissions
             WHERE stage_id IN (?)
             ORDER BY submission_no ASC`,
              [stageIds],
            )
            .then(([rows]) => rows),
          db
            .query(
              `SELECT
                 rev.id, rev.stage_id, rev.submission_no, rev.decision, rev.catatan, rev.reviewed_at,
                 CASE WHEN rf.id IS NULL THEN 0 ELSE 1 END AS has_review_file,
                 rf.id AS review_file_id, rf.file_name AS review_file_name
               FROM revisi_pasca_sidang_reviews rev
               LEFT JOIN revisi_pasca_sidang_review_file rf
                      ON rf.revisi_pasca_sidang_review_id = rev.id
               WHERE rev.stage_id IN (?)
               ORDER BY rev.submission_no ASC`,
              [stageIds],
            )
            .then(([rows]) => rows),
        ])
      : [[], []];

    const subsByStage = {};
    const reviewsByStage = {};
    for (const sub of allSubmissions) {
      if (!subsByStage[sub.stage_id]) subsByStage[sub.stage_id] = [];
      const { stage_id: _, ...subData } = sub;
      subsByStage[sub.stage_id].push(subData);
    }
    for (const rev of allReviews) {
      if (!reviewsByStage[rev.stage_id]) reviewsByStage[rev.stage_id] = [];
      const { stage_id: _, ...revData } = rev;
      reviewsByStage[rev.stage_id].push(revData);
    }

    const signerNames = {
      PENGUJI_2: revisi.penguji2_nama,
      PENGUJI_1: revisi.penguji1_nama,
      PEMBIMBING_2: revisi.pembimbing2_nama,
      PEMBIMBING_1: revisi.pembimbing1_nama,
    };
    const stagesWithData = stages.map((stage) => ({
      ...stage,
      nidn: getNidnForRole(revisi, stage.signer_role),
      nama: signerNames[stage.signer_role] ?? null,
      submissions: subsByStage[stage.id] ?? [],
      reviews: reviewsByStage[stage.id] ?? [],
    }));

    const activeStage = resolveActiveStage(stages, jenis);

    const callerRole = req.user.hasRole("STUDENT")
      ? null
      : callerRoleFor(revisi, await getLecturerNidn(req.user.id));
    const missingSignatures = isLatestAttempt
      ? await computeMissingSignatures(revisi, stages, jenis)
      : [];

    const [files] = await db.query(
      `SELECT id, file_type, file_name, created_at
       FROM revisi_pasca_sidang_files
       WHERE revisi_id = ?`,
      [revisi.id],
    );

    const { mahasiswa_npm, ...revisiBase } = revisi;

    return res.json({
      ok: true,
      data: {
        revisi: { ...revisiBase, npm: mahasiswa_npm },
        jenis,
        sidang_id: revisi.sidang_id,
        isLatestAttempt,
        callerRole,
        missingSignatures,
        activeStage: activeStage
          ? {
              signerRole: activeStage.signer_role,
              currentStatus: activeStage.current_status,
            }
          : null,
        stages: stagesWithData,
        files,
      },
    });
  } catch (err) {
    next(err);
  }
};

// GET /lecturer/revisi-pasca-sidang
exports.getLecturerRevisi = async (req, res, next) => {
  try {
    if (req.user.userType !== "LECTURER") {
      return res.status(403).json({
        ok: false,
        message: "Only lecturers can access this endpoint",
      });
    }

    const nidn = await getLecturerNidn(req.user.id);
    if (!nidn) {
      return res.status(400).json({ ok: false, message: "Dosen tidak valid" });
    }

    const [rows] = await db.query(
      `SELECT
         rps.id, rps.is_completed,
         s.id AS sidang_id, s.skripsi_id, s.jenis, m.npm, m.nama AS nama_mahasiswa,
         COALESCE(lanjutan.judul_seminar, sk.judul) AS judul_skripsi, psk_k.tanggal_sidang,
         sk.pembimbing1_nidn, sk.pembimbing2_nidn,
         psk_k.penguji1_nidn, psk_k.penguji2_nidn,
         CASE
           WHEN psk_k.penguji2_nidn = ? THEN 'PENGUJI_2'
           WHEN psk_k.penguji1_nidn = ? THEN 'PENGUJI_1'
           WHEN sk.pembimbing2_nidn = ? THEN 'PEMBIMBING_2'
           WHEN sk.pembimbing1_nidn = ? THEN 'PEMBIMBING_1'
         END AS caller_role
       FROM revisi_pasca_sidang rps
       JOIN sidang s ON s.id = rps.sidang_id
       JOIN skripsi sk ON sk.id = s.skripsi_id
       JOIN mahasiswa m ON m.npm = sk.npm
       LEFT JOIN pengajuan_sidang_kaprodi psk_k
              ON psk_k.pengajuan_sidang_id = s.pengajuan_sidang_id
       LEFT JOIN pengajuan_sk_skripsi_lanjutan lanjutan ON lanjutan.seminar_sidang_id = s.id
       WHERE psk_k.penguji2_nidn = ? OR psk_k.penguji1_nidn = ?
          OR sk.pembimbing2_nidn = ? OR sk.pembimbing1_nidn = ?
       ORDER BY rps.created_at DESC`,
      [nidn, nidn, nidn, nidn, nidn, nidn, nidn, nidn],
    );

    // Attach active stage info per revisi
    if (rows.length) {
      const revisiIds = rows.map((r) => r.id);
      const [stages] = await db.query(
        `SELECT id, revisi_id, signer_role, current_status
         FROM revisi_pasca_sidang_stages
         WHERE revisi_id IN (?)`,
        [revisiIds],
      );
      const stagesByRevisi = {};
      for (const stage of stages) {
        if (!stagesByRevisi[stage.revisi_id])
          stagesByRevisi[stage.revisi_id] = [];
        stagesByRevisi[stage.revisi_id].push(stage);
      }

      const stageIds = stages.map((s) => s.id);
      const latestSubmittedByStage = {};
      if (stageIds.length) {
        const [latestSubs] = await db.query(
          `SELECT stage_id, MAX(submitted_at) AS latest_submitted_at
           FROM revisi_pasca_sidang_submissions
           WHERE stage_id IN (?)
           GROUP BY stage_id`,
          [stageIds],
        );
        for (const row of latestSubs) {
          latestSubmittedByStage[row.stage_id] = row.latest_submitted_at;
        }
      }

      for (const row of rows) {
        const revisiStages = stagesByRevisi[row.id] ?? [];
        const active = resolveActiveStage(revisiStages, row.jenis);
        row.activeStage = active
          ? {
              signerRole: active.signer_role,
              currentStatus: active.current_status,
            }
          : null;

        let latestSubmittedAt = null;
        for (const stage of revisiStages) {
          const stageLatest = latestSubmittedByStage[stage.id];
          if (
            stageLatest &&
            (!latestSubmittedAt || stageLatest > latestSubmittedAt)
          ) {
            latestSubmittedAt = stageLatest;
          }
        }
        row.latest_submitted_at = latestSubmittedAt;
      }
    }

    return res.json({ ok: true, data: rows });
  } catch (err) {
    next(err);
  }
};

exports.getKaprodiRevisi = async (req, res, next) => {
  try {
    if (!req.user.hasRole("KAPRODI")) {
      return res.status(403).json({ ok: false, message: "Forbidden" });
    }

    const pagination = parsePagination(req.query);
    const q = String(req.query.q ?? "").trim();
    const status = String(req.query.status ?? "").trim();
    const validStatuses = ["MENUNGGU_TTD", "MENUNGGU_MAHASISWA", "PERLU_REVISI", "SELESAI"];
    if (status && !validStatuses.includes(status)) {
      return res.status(400).json({ ok: false, message: "status tidak valid" });
    }
    const staffUsrId = await getStaffUsrId(req.user.id);
    const programStudiIds = staffUsrId
      ? await getKaprodiProgramStudiIds(staffUsrId)
      : [];
    if (programStudiIds.length === 0) {
      return res.json({
        ok: true,
        data: [],
        summary: { total: 0, menungguTtd: 0, menungguMahasiswa: 0, selesai: 0 },
      });
    }

    const placeholders = programStudiIds.map(() => "?").join(",");
    const jenisFilter = ["SKRIPSI", "SEMINAR_BISNIS_DIGITAL"].includes(req.query.jenis)
      ? req.query.jenis
      : null;
    const searchCondition = [
      q
        ? "AND (m.nama LIKE ? OR m.npm LIKE ? OR sk.judul LIKE ? OR lanjutan.judul_seminar LIKE ? OR s.judul_baru LIKE ?)"
        : "",
      jenisFilter ? "AND s.jenis = ?" : "",
    ].join(" ");
    const searchParams = [
      ...(q ? Array(5).fill(`%${q}%`) : []),
      ...(jenisFilter ? [jenisFilter] : []),
    ];
    const activeStageStatus = `(SELECT rs.current_status
      FROM revisi_pasca_sidang_stages rs
      WHERE rs.revisi_id = rps.id AND rs.current_status != 'APPROVED'
      ORDER BY FIELD(rs.signer_role, 'PENGUJI_2', 'PENGUJI_1', 'PEMBIMBING_2', 'PEMBIMBING_1')
      LIMIT 1)`;
    const statusCondition =
      status === "SELESAI"
        ? "AND rps.is_completed = 1"
        : status === "PERLU_REVISI"
          ? `AND rps.is_completed = 0 AND ${activeStageStatus} = 'NEED_REVISION'`
          : status === "MENUNGGU_TTD"
            ? `AND rps.is_completed = 0 AND ${activeStageStatus} = 'SUBMITTED'`
            : status === "MENUNGGU_MAHASISWA"
              ? `AND rps.is_completed = 0 AND ${activeStageStatus} IN ('WAITING_SUBMISSION', 'NEED_REVISION')`
              : "";
    // Card counters: the same filters except status and pagination.
    const [[summaryRow]] = await db.query(
      `SELECT
         COUNT(*) AS total,
         COALESCE(SUM(rps.is_completed = 0 AND ${activeStageStatus} = 'SUBMITTED'), 0) AS menunggu_ttd,
         COALESCE(SUM(rps.is_completed = 0 AND ${activeStageStatus} IN ('WAITING_SUBMISSION', 'NEED_REVISION')), 0) AS menunggu_mahasiswa,
         COALESCE(SUM(rps.is_completed = 1), 0) AS selesai
       FROM revisi_pasca_sidang rps
       JOIN sidang s ON s.id = rps.sidang_id
       JOIN skripsi sk ON sk.id = s.skripsi_id
       JOIN mahasiswa m ON m.npm = sk.npm
       JOIN program_studi prog ON prog.id = sk.program_studi_id
       LEFT JOIN pengajuan_sk_skripsi_lanjutan lanjutan ON lanjutan.seminar_sidang_id = s.id
       WHERE prog.id IN (${placeholders}) ${searchCondition}`,
      [...programStudiIds, ...searchParams],
    );
    const summary = {
      total: Number(summaryRow.total),
      menungguTtd: Number(summaryRow.menunggu_ttd),
      menungguMahasiswa: Number(summaryRow.menunggu_mahasiswa),
      selesai: Number(summaryRow.selesai),
    };
    const [[countRow]] = await db.query(
      `SELECT COUNT(*) AS total
       FROM revisi_pasca_sidang rps
       JOIN sidang s ON s.id = rps.sidang_id
       JOIN skripsi sk ON sk.id = s.skripsi_id
       JOIN mahasiswa m ON m.npm = sk.npm
       JOIN program_studi prog ON prog.id = sk.program_studi_id
       LEFT JOIN pengajuan_sk_skripsi_lanjutan lanjutan ON lanjutan.seminar_sidang_id = s.id
       WHERE prog.id IN (${placeholders}) ${searchCondition} ${statusCondition}`,
      [...programStudiIds, ...searchParams],
    );
    const [rows] = await db.query(
      `SELECT
         rps.id, rps.is_completed,
         s.id AS sidang_id, s.skripsi_id, s.jenis, m.npm, m.nama AS nama_mahasiswa,
         COALESCE(lanjutan.judul_seminar, sk.judul) AS judul_skripsi, psk_k.tanggal_sidang,
         sk.pembimbing1_nidn, d1.nama AS pembimbing1_nama,
         sk.pembimbing2_nidn, d2.nama AS pembimbing2_nama,
         psk_k.penguji1_nidn, d_pg1.nama AS penguji1_nama,
         psk_k.penguji2_nidn, d_pg2.nama AS penguji2_nama
       FROM revisi_pasca_sidang rps
       JOIN sidang s ON s.id = rps.sidang_id
       JOIN skripsi sk ON sk.id = s.skripsi_id
       JOIN mahasiswa m ON m.npm = sk.npm
       JOIN program_studi prog ON prog.id = sk.program_studi_id
       LEFT JOIN dosen d1 ON d1.nidn = sk.pembimbing1_nidn
       LEFT JOIN dosen d2 ON d2.nidn = sk.pembimbing2_nidn
       LEFT JOIN pengajuan_sidang_kaprodi psk_k
              ON psk_k.pengajuan_sidang_id = s.pengajuan_sidang_id
       LEFT JOIN dosen d_pg1 ON d_pg1.nidn = psk_k.penguji1_nidn
       LEFT JOIN dosen d_pg2 ON d_pg2.nidn = psk_k.penguji2_nidn
       LEFT JOIN pengajuan_sk_skripsi_lanjutan lanjutan ON lanjutan.seminar_sidang_id = s.id
       WHERE prog.id IN (${placeholders}) ${searchCondition} ${statusCondition}
       ORDER BY rps.created_at DESC${pagination.enabled ? " LIMIT ? OFFSET ?" : ""}`,
      pagination.enabled
        ? [
            ...programStudiIds,
            ...searchParams,
            pagination.limit,
            pagination.offset,
          ]
        : [...programStudiIds, ...searchParams],
    );

    if (rows.length) {
      const revisiIds = rows.map((r) => r.id);
      const [stages] = await db.query(
        `SELECT id, revisi_id, signer_role, current_status
         FROM revisi_pasca_sidang_stages
         WHERE revisi_id IN (?)`,
        [revisiIds],
      );
      const stagesByRevisi = {};
      for (const stage of stages) {
        if (!stagesByRevisi[stage.revisi_id])
          stagesByRevisi[stage.revisi_id] = [];
        stagesByRevisi[stage.revisi_id].push(stage);
      }

      const stageIds = stages.map((s) => s.id);
      const latestSubmittedByStage = {};
      if (stageIds.length) {
        const [latestSubs] = await db.query(
          `SELECT stage_id, MAX(submitted_at) AS latest_submitted_at
           FROM revisi_pasca_sidang_submissions
           WHERE stage_id IN (?)
           GROUP BY stage_id`,
          [stageIds],
        );
        for (const row of latestSubs) {
          latestSubmittedByStage[row.stage_id] = row.latest_submitted_at;
        }
      }

      for (const row of rows) {
        const revisiStages = stagesByRevisi[row.id] ?? [];
        const active = resolveActiveStage(revisiStages, row.jenis);
        row.activeStage = active
          ? {
              signerRole: active.signer_role,
              currentStatus: active.current_status,
            }
          : null;

        let latestSubmittedAt = null;
        for (const stage of revisiStages) {
          const stageLatest = latestSubmittedByStage[stage.id];
          if (
            stageLatest &&
            (!latestSubmittedAt || stageLatest > latestSubmittedAt)
          ) {
            latestSubmittedAt = stageLatest;
          }
        }
        row.latest_submitted_at = latestSubmittedAt;
      }
    }

    pagination.totalItems = Number(countRow.total);
    return listResponse(res, { rows, pagination, extra: { summary } });
  } catch (err) {
    next(err);
  }
};

function sendDocx(res, fileRow) {
  return res.json({
    ok: true,
    data: {
      file_name: fileRow.file_name,
      mime_type: mimeFromFileName(fileRow.file_name),
      file_content: fileRow.file_content,
    },
  });
}

// The revisi file downloads share this lookup: identity and participant NIDNs for the access check.
// Pass jenis to read a specific type's revisi (e.g. the Seminar one after the record moved on).
async function getRevisiForFileAccess(skripsiId, jenis, sidangId = null) {
  if (!sidangId) jenis = jenis ?? (await resolveJenis(db, skripsiId));
  const [[revisi]] = await db.query(
    `SELECT rps.id, m.npm, sk.program_studi_id, ps.fakultas_id,
            sk.pembimbing1_nidn, sk.pembimbing2_nidn,
            psk_k.penguji1_nidn, psk_k.penguji2_nidn
     FROM sidang s
     LEFT JOIN revisi_pasca_sidang rps ON rps.sidang_id = s.id
     JOIN skripsi sk ON sk.id = s.skripsi_id
     JOIN mahasiswa m ON m.npm = sk.npm
     JOIN program_studi ps ON ps.id = sk.program_studi_id
     LEFT JOIN pengajuan_sidang_kaprodi psk_k
            ON psk_k.pengajuan_sidang_id = s.pengajuan_sidang_id
     WHERE s.skripsi_id = ? AND ${sidangId ? "s.id = ?" : "s.jenis = ?"} ORDER BY s.id DESC LIMIT 1`,
    [skripsiId, sidangId ?? jenis],
  );
  return revisi?.id ? revisi : null;
}

// GET /revisi-pasca-sidang/:skripsiId/files/submission
exports.getSubmissionFile = async (req, res, next) => {
  try {
    const skripsiId = Number(req.params.skripsiId);
    if (!Number.isFinite(skripsiId) || skripsiId <= 0) {
      return res.status(400).json({ ok: false, message: "Invalid skripsiId" });
    }

    const target = await resolveReadTarget(req, res, skripsiId);
    if (!target) return;
    const revisi = await getRevisiForFileAccess(skripsiId, target.jenis, target.sidangId);
    if (!revisi) {
      return res
        .status(404)
        .json({ ok: false, message: "Revisi tidak ditemukan" });
    }

    if (!(await canAccessRevisi(req, revisi))) {
      return res.status(403).json({ ok: false, message: "Forbidden" });
    }

    // Return the most recently submitted file across all stages of this revisi
    const [stages] = await db.query(
      `SELECT id FROM revisi_pasca_sidang_stages WHERE revisi_id = ?`,
      [revisi.id],
    );
    const stageIds = stages.map((s) => s.id);
    if (!stageIds.length) {
      return res
        .status(404)
        .json({ ok: false, message: "Belum ada file revisi yang diunggah" });
    }

    const [[fileRow]] = await db.query(
      `SELECT file_name, file_content FROM revisi_pasca_sidang_submissions
       WHERE stage_id IN (?) ORDER BY submitted_at DESC, id DESC LIMIT 1`,
      [stageIds],
    );
    if (!fileRow) {
      return res
        .status(404)
        .json({ ok: false, message: "Belum ada file revisi yang diunggah" });
    }

    return sendDocx(res, fileRow);
  } catch (err) {
    next(err);
  }
};

// GET /revisi-pasca-sidang/reviews/:reviewId/file
exports.getReviewFile = async (req, res, next) => {
  try {
    const reviewId = Number(req.params.reviewId);
    if (!Number.isFinite(reviewId) || reviewId <= 0) {
      return res.status(400).json({ ok: false, message: "Invalid reviewId" });
    }

    const [[file]] = await db.query(
      `SELECT
         rf.id, rf.file_content, rf.file_name, rf.mime_type,
         m.npm, sk.program_studi_id, sk.pembimbing1_nidn, sk.pembimbing2_nidn,
         psk_k.penguji1_nidn, psk_k.penguji2_nidn
       FROM revisi_pasca_sidang_review_file rf
       INNER JOIN revisi_pasca_sidang_reviews rev ON rev.id = rf.revisi_pasca_sidang_review_id
       INNER JOIN revisi_pasca_sidang_stages st ON st.id = rev.stage_id
       INNER JOIN revisi_pasca_sidang rps ON rps.id = st.revisi_id
       JOIN sidang s ON s.id = rps.sidang_id
       JOIN skripsi sk ON sk.id = s.skripsi_id
       JOIN mahasiswa m ON m.npm = sk.npm
       LEFT JOIN pengajuan_sidang_kaprodi psk_k
              ON psk_k.pengajuan_sidang_id = s.pengajuan_sidang_id
       WHERE rf.revisi_pasca_sidang_review_id = ?
       LIMIT 1`,
      [reviewId],
    );
    if (!file) {
      return res
        .status(404)
        .json({ ok: false, message: "Review file not found" });
    }

    if (!(await canAccessRevisi(req, file))) {
      return res.status(403).json({ ok: false, message: "Forbidden" });
    }

    return res.json({
      ok: true,
      data: {
        file_name: file.file_name,
        mime_type: file.mime_type,
        file_content: file.file_content,
      },
    });
  } catch (err) {
    next(err);
  }
};

// GET /revisi-pasca-sidang/:skripsiId/files/halaman-pengesahan-majelis-penguji
exports.getHalamanMajelisFile = async (req, res, next) => {
  try {
    const skripsiId = Number(req.params.skripsiId);
    if (!Number.isFinite(skripsiId) || skripsiId <= 0) {
      return res.status(400).json({ ok: false, message: "Invalid skripsiId" });
    }

    const target = await resolveReadTarget(req, res, skripsiId);
    if (!target) return;
    const revisi = await getRevisiForFileAccess(
      skripsiId,
      target.sidangId ? target.jenis : undefined,
      target.sidangId,
    );
    if (!revisi) {
      return res
        .status(404)
        .json({ ok: false, message: "Revisi tidak ditemukan" });
    }

    if (!(await canAccessRevisi(req, revisi))) {
      return res.status(403).json({ ok: false, message: "Forbidden" });
    }

    const [[fileRow]] = await db.query(
      `SELECT file_name, file_content FROM revisi_pasca_sidang_files
       WHERE revisi_id = ? AND file_type = 'HALAMAN_PENGESAHAN_MAJELIS_PENGUJI' LIMIT 1`,
      [revisi.id],
    );
    if (!fileRow) {
      return res.status(404).json({
        ok: false,
        message: "Halaman pengesahan majelis penguji belum tersedia",
      });
    }

    return sendDocx(res, fileRow);
  } catch (err) {
    next(err);
  }
};

// GET /revisi-pasca-sidang/:skripsiId/files/halaman-pengesahan-seminar
// Always the Seminar revisi: it stays downloadable after the record moves on to Skripsi.
exports.getHalamanSeminarFile = async (req, res, next) => {
  try {
    const skripsiId = Number(req.params.skripsiId);
    if (!Number.isFinite(skripsiId) || skripsiId <= 0) {
      return res.status(400).json({ ok: false, message: "Invalid skripsiId" });
    }

    const revisi = await getRevisiForFileAccess(
      skripsiId,
      JENIS.SEMINAR_BISNIS_DIGITAL,
    );
    if (!revisi) {
      return res
        .status(404)
        .json({ ok: false, message: "Revisi seminar tidak ditemukan" });
    }

    if (!(await canAccessRevisi(req, revisi))) {
      return res.status(403).json({ ok: false, message: "Forbidden" });
    }

    const [[fileRow]] = await db.query(
      `SELECT file_name, file_content FROM revisi_pasca_sidang_files
       WHERE revisi_id = ? AND file_type = 'HALAMAN_PENGESAHAN_SEMINAR_BD' LIMIT 1`,
      [revisi.id],
    );
    if (!fileRow) {
      return res.status(404).json({
        ok: false,
        message: "Halaman pengesahan proposal skripsi belum tersedia",
      });
    }

    return sendDocx(res, fileRow);
  } catch (err) {
    next(err);
  }
};

// GET /revisi-pasca-sidang/:skripsiId/files/halaman-pengesahan-dekan
exports.getHalamanDekanFile = async (req, res, next) => {
  try {
    const skripsiId = Number(req.params.skripsiId);
    if (!Number.isFinite(skripsiId) || skripsiId <= 0) {
      return res.status(400).json({ ok: false, message: "Invalid skripsiId" });
    }

    const target = await resolveReadTarget(req, res, skripsiId);
    if (!target) return;
    const revisi = await getRevisiForFileAccess(
      skripsiId,
      target.sidangId ? target.jenis : undefined,
      target.sidangId,
    );
    if (!revisi) {
      return res
        .status(404)
        .json({ ok: false, message: "Revisi tidak ditemukan" });
    }

    if (!(await canAccessRevisi(req, revisi, { allowDekan: true }))) {
      return res.status(403).json({ ok: false, message: "Forbidden" });
    }

    const [[fileRow]] = await db.query(
      `SELECT file_name, file_content FROM revisi_pasca_sidang_files
       WHERE revisi_id = ? AND file_type = 'HALAMAN_PENGESAHAN_DEKAN' LIMIT 1`,
      [revisi.id],
    );
    if (!fileRow) {
      return res.status(404).json({
        ok: false,
        message: "Halaman pengesahan dekan belum tersedia",
      });
    }

    return sendDocx(res, fileRow);
  } catch (err) {
    next(err);
  }
};
