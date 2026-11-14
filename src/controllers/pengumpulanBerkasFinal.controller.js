"use strict";

const db = require("../db");
const { insertNotification } = require("../utils/notify");
const { parsePagination, listResponse } = require("../utils/pagination");
const {
  generateSuratKeteranganPenyerahanSkripsiFTI,
} = require("../services/generateSuratKeteranganPenyerahanSkripsiFTI");
const {
  getStudentNpm,
  getLecturerNidn,
  getStaffUsrId,
  getKaprodiProgramStudiIds,
  getSekprodiProgramStudiIds,
  getSekprodiUserIds,
  isKaprodiOfProgramStudi,
} = require("../utils/identity");
const {
  assertSignatures,
  hasSignature,
  getStaffSignature,
  getDosenSignature,
  getUserSignature,
  getMahasiswaSignature,
} = require("../utils/signature");
const { formatTanggal } = require("../utils/dates");
const { mimeFromFileName } = require("../utils/mime");
const { UPLOAD_RULES, validateUpload } = require("../utils/upload");

const BERKAS_CHANGED_MESSAGE =
  "Data berkas final berubah saat sedang diproses. Silakan muat ulang halaman dan kirim kembali.";
const MAX_FILE_NAME_LENGTH = 255;
const SURAT_FILE_NAME = "surat_pernyataan_penyerahan_skripsi.pdf";
const INSTITUTION_ROLE_CODE = { PERPUSTAKAAN: "PERPUSTAKAAN_STAFF", LPPM: "LPPM" };

function recipientLink(role, skripsiId) {
  switch (role) {
    case "PERPUSTAKAAN":
      return `/perpustakaan/berkas-final/${skripsiId}`;
    case "LPPM":
      return `/lppm/berkas-final/${skripsiId}`;
    case "SEKPRODI":
      return `/sekprodi/berkas-final/${skripsiId}`;
    case "PEMBIMBING_1":
    case "PEMBIMBING_2":
    case "PENGUJI_1":
    case "PENGUJI_2":
      return `/pembimbing/berkas-final/${skripsiId}`;
    case "STUDENT":
    default:
      return `/student/berkas-final`;
  }
}

// Row of the pengumpulan with everything the surat, the access checks and the recipients need.
// Penguji come from the pengajuan_sidang_kaprodi of the latest SKRIPSI sidang (deterministic, also for no_hp).
async function getPengumpulanContext(queryable, skripsiId) {
  const [[ctx]] = await queryable.query(
    `SELECT pbf.id, pbf.skripsi_id, pbf.status, pbf.is_completed, pbf.created_at, pbf.updated_at,
            sk.npm, sk.judul AS judul_skripsi, sk.program_studi_id,
            sk.pembimbing1_nidn, sk.pembimbing2_nidn,
            psk_k.penguji1_nidn, psk_k.penguji2_nidn, psk_k.no_hp,
            m.nama AS nama_mahasiswa,
            prog.nama AS program_studi_nama,
            d1.nama AS pembimbing1_nama, d2.nama AS pembimbing2_nama,
            dp1.nama AS penguji1_nama, dp2.nama AS penguji2_nama
     FROM pengumpulan_berkas_final pbf
     JOIN skripsi sk ON sk.id = pbf.skripsi_id
     JOIN mahasiswa m ON m.npm = sk.npm
     LEFT JOIN program_studi prog ON prog.id = sk.program_studi_id
     LEFT JOIN dosen d1 ON d1.nidn = sk.pembimbing1_nidn
     LEFT JOIN dosen d2 ON d2.nidn = sk.pembimbing2_nidn
     LEFT JOIN sidang s ON s.id = (SELECT MAX(id) FROM sidang WHERE skripsi_id = pbf.skripsi_id AND jenis = 'SKRIPSI')
     LEFT JOIN pengajuan_sidang_kaprodi psk_k ON psk_k.pengajuan_sidang_id = s.pengajuan_sidang_id
     LEFT JOIN dosen dp1 ON dp1.nidn = psk_k.penguji1_nidn
     LEFT JOIN dosen dp2 ON dp2.nidn = psk_k.penguji2_nidn
     WHERE pbf.skripsi_id = ?
     LIMIT 1`,
    [skripsiId],
  );
  return ctx ?? null;
}

function dosenNidnForRole(ctx, role) {
  switch (role) {
    case "PEMBIMBING_1":
      return ctx.pembimbing1_nidn ?? null;
    case "PEMBIMBING_2":
      return ctx.pembimbing2_nidn ?? null;
    case "PENGUJI_1":
      return ctx.penguji1_nidn ?? null;
    case "PENGUJI_2":
      return ctx.penguji2_nidn ?? null;
    default:
      return null;
  }
}

function dosenNamaForRole(ctx, role) {
  return (
    {
      PEMBIMBING_1: ctx.pembimbing1_nama,
      PEMBIMBING_2: ctx.pembimbing2_nama,
      PENGUJI_1: ctx.penguji1_nama,
      PENGUJI_2: ctx.penguji2_nama,
    }[role] ?? ""
  );
}

async function getConfirmations(queryable, pengumpulanId, { forUpdate = false } = {}) {
  const [rows] = await queryable.query(
    `SELECT id, recipient_role, user_id, confirmed_at
     FROM pengumpulan_berkas_final_confirmations
     WHERE pengumpulan_id = ?
     ORDER BY FIELD(recipient_role, 'PERPUSTAKAAN','LPPM','PEMBIMBING_1','PEMBIMBING_2','PENGUJI_1','PENGUJI_2')${forUpdate ? " FOR UPDATE" : ""}`,
    [pengumpulanId],
  );
  return rows;
}

// Identifies which confirmations (and by whom) a rendered surat was based on.
function confirmationsFingerprint(rows, excludeRole = null) {
  return rows
    .filter((r) => r.recipient_role !== excludeRole && r.confirmed_at)
    .map((r) => `${r.recipient_role}|${r.user_id ?? ""}|${new Date(r.confirmed_at).getTime()}`)
    .sort()
    .join(";");
}

// Dosen recipients are found by NIDN at send time; confirmations.user_id can be NULL.
async function resolveDosenUserId(queryable, nidn) {
  if (!nidn) return null;
  const [[row]] = await queryable.query(
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

async function getUserIdByRole(conn, role) {
  const [[row]] = await conn.query(
    `SELECT u.id FROM users u
     INNER JOIN user_roles ur ON ur.user_id = u.id
     INNER JOIN roles r ON r.id = ur.role_id
     WHERE r.code = ? AND ur.is_active = 1 AND u.is_active = 1
     ORDER BY u.id ASC
     LIMIT 1`,
    [role],
  );
  return row?.id ?? null;
}

// Signature of the Perpustakaan/LPPM account: the one that confirmed, or (before that) any active
// account holding the role.
async function getInstitutionSignature(queryable, recipientRole, confirmation) {
  if (confirmation?.confirmed_at && confirmation.user_id) {
    return getUserSignature(queryable, confirmation.user_id);
  }
  const [rows] = await queryable.query(
    `SELECT u.signature_image
     FROM users u
     JOIN user_roles ur ON ur.user_id = u.id AND ur.is_active = 1
     JOIN roles r ON r.id = ur.role_id AND r.code = ?
     WHERE u.is_active = 1`,
    [INSTITUTION_ROLE_CODE[recipientRole]],
  );
  return rows.find((r) => hasSignature(r.signature_image))?.signature_image ?? null;
}

async function getSekprodiOfProgramStudi(queryable, programStudiId) {
  const [[row]] = await queryable.query(
    `SELECT ps.sekprodi_staff_usr_id AS staff_usr_id, s.nama
     FROM program_studi ps
     LEFT JOIN staf s ON s.usr_id = ps.sekprodi_staff_usr_id
     WHERE ps.id = ? LIMIT 1`,
    [programStudiId],
  );
  return row ?? null;
}

// A 409 (ambiguous SIMIKO name) means the signature cannot be determined: treat it as missing.
async function getStaffSignatureOrNull(queryable, staffUsrId) {
  try {
    return await getStaffSignature(queryable, staffUsrId);
  } catch (err) {
    if (err.statusCode !== 409) throw err;
    return null;
  }
}

// Signatures the Surat Pernyataan Penyerahan will need that are missing now (no rendering, one round
// of lookups). Empty once the process is COMPLETED.
async function computeMissingSignatures(ctx, confirmations) {
  if (ctx.is_completed) return [];
  const confByRole = new Map(confirmations.map((c) => [c.recipient_role, c]));
  const missing = [];
  const check = (role, nama, kind, promise) =>
    promise.then((sig) => {
      if (!hasSignature(sig)) missing.push({ role, nama: nama ?? "", kind });
    });

  const lookups = [
    check("Mahasiswa", ctx.nama_mahasiswa, "MAHASISWA", getMahasiswaSignature(db, ctx.npm)),
    check("Perpustakaan", "", "PERPUSTAKAAN", getInstitutionSignature(db, "PERPUSTAKAAN", confByRole.get("PERPUSTAKAAN"))),
    check("LPPM", "", "LPPM", getInstitutionSignature(db, "LPPM", confByRole.get("LPPM"))),
  ];
  for (const [role, label] of [
    ["PEMBIMBING_1", "Pembimbing 1"],
    ["PEMBIMBING_2", "Pembimbing 2"],
    ["PENGUJI_1", "Penguji 1"],
    ["PENGUJI_2", "Penguji 2"],
  ]) {
    lookups.push(check(label, dosenNamaForRole(ctx, role), "DOSEN", getDosenSignature(db, dosenNidnForRole(ctx, role))));
  }
  const sekprodi = await getSekprodiOfProgramStudi(db, ctx.program_studi_id);
  lookups.push(
    check(
      "Sekretaris Prodi",
      sekprodi?.nama,
      "SEKPRODI",
      sekprodi?.staff_usr_id ? getStaffSignatureOrNull(db, sekprodi.staff_usr_id) : Promise.resolve(null),
    ),
  );
  await Promise.all(lookups);

  const order = ["Mahasiswa", "Perpustakaan", "LPPM", "Pembimbing 1", "Pembimbing 2", "Penguji 1", "Penguji 2", "Sekretaris Prodi"];
  return missing.sort((a, b) => order.indexOf(a.role) - order.indexOf(b.role));
}

// confirmations: rows ({ recipient_role, user_id, confirmed_at }) the surat is rendered from.
// sekprodi: { signatureImage, nama } to print and require the Sekprodi signature, or null.
async function generateSuratDoc(queryable, ctx, confirmations, sekprodi = null) {
  const confMap = {};
  for (const c of confirmations) confMap[c.recipient_role] = c;

  const [sigMhs, sigPerpus, sigLppm, sigPb1, sigPb2, sigPg1, sigPg2] = await Promise.all([
    getMahasiswaSignature(queryable, ctx.npm),
    getInstitutionSignature(queryable, "PERPUSTAKAAN", confMap.PERPUSTAKAAN),
    getInstitutionSignature(queryable, "LPPM", confMap.LPPM),
    getDosenSignature(queryable, ctx.pembimbing1_nidn),
    getDosenSignature(queryable, ctx.pembimbing2_nidn),
    getDosenSignature(queryable, ctx.penguji1_nidn),
    getDosenSignature(queryable, ctx.penguji2_nidn),
  ]);

  assertSignatures([
    { role: "Mahasiswa", nama: ctx.nama_mahasiswa, signatureImage: sigMhs },
    { role: "Perpustakaan", signatureImage: sigPerpus },
    { role: "LPPM", signatureImage: sigLppm },
    { role: "Pembimbing 1", nama: ctx.pembimbing1_nama, signatureImage: sigPb1 },
    { role: "Pembimbing 2", nama: ctx.pembimbing2_nama, signatureImage: sigPb2 },
    { role: "Penguji 1", nama: ctx.penguji1_nama, signatureImage: sigPg1 },
    { role: "Penguji 2", nama: ctx.penguji2_nama, signatureImage: sigPg2 },
    ...(sekprodi
      ? [{ role: "Sekretaris Prodi", nama: sekprodi.nama, signatureImage: sekprodi.signatureImage }]
      : []),
  ]);

  const confirmationData = (role, signatureBase64) => ({
    tanggal: confMap[role]?.confirmed_at ? formatTanggal(confMap[role].confirmed_at) : "",
    signatureBase64,
  });

  return generateSuratKeteranganPenyerahanSkripsiFTI({
    mahasiswa: {
      nama: ctx.nama_mahasiswa ?? "",
      npm: ctx.npm,
      nomorHp: ctx.no_hp ?? "",
      programStudi: ctx.program_studi_nama ?? "",
      judulSkripsi: ctx.judul_skripsi ?? "",
      signatureBase64: sigMhs,
    },
    penerimaan: {
      perpustakaan: confirmationData("PERPUSTAKAAN", sigPerpus),
      lppm: confirmationData("LPPM", sigLppm),
      pembimbingPertama: confirmationData("PEMBIMBING_1", sigPb1),
      pembimbingKedua: confirmationData("PEMBIMBING_2", sigPb2),
      pengujiUtama: confirmationData("PENGUJI_1", sigPg1),
      anggotaPenguji: confirmationData("PENGUJI_2", sigPg2),
    },
    sekretarisProgramStudi: {
      nama: sekprodi?.nama ?? "",
      signatureBase64: sekprodi?.signatureImage ?? null,
    },
    tanggalDibuat: formatTanggal(new Date()),
  });
}

// DELETE + INSERT (UNIQUE on pengumpulan_id + file_type).
async function storeSurat(conn, pengumpulanId, docBuffer) {
  await conn.query(
    `DELETE FROM pengumpulan_berkas_final_files
     WHERE pengumpulan_id = ? AND file_type = 'SURAT_PERNYATAAN_PENYERAHAN'`,
    [pengumpulanId],
  );
  await conn.query(
    `INSERT INTO pengumpulan_berkas_final_files (pengumpulan_id, file_type, file_name, mime_type, file_content)
     VALUES (?, 'SURAT_PERNYATAAN_PENYERAHAN', ?, 'application/pdf', ?)`,
    [pengumpulanId, SURAT_FILE_NAME, Buffer.from(docBuffer).toString("base64")],
  );
}

async function lockPengumpulan(conn, pengumpulanId) {
  const [[row]] = await conn.query(
    `SELECT id, status FROM pengumpulan_berkas_final WHERE id = ? FOR UPDATE`,
    [pengumpulanId],
  );
  return row ?? null;
}

// Student, one of the four dosen, Perpustakaan, LPPM, Sekretariat, the Kaprodi of the prodi, or its Sekprodi.
async function canAccessPengumpulan(req, ctx) {
  const userId = Number(req.user.id);
  const [npm, nidn] = await Promise.all([getStudentNpm(userId), getLecturerNidn(userId)]);
  if (npm && npm === ctx.npm) return true;
  if (
    nidn &&
    [ctx.pembimbing1_nidn, ctx.pembimbing2_nidn, ctx.penguji1_nidn, ctx.penguji2_nidn].includes(nidn)
  ) {
    return true;
  }
  if (
    req.user.hasRole("PERPUSTAKAAN_STAFF") ||
    req.user.hasRole("LPPM") ||
    req.user.hasRole("SEKRETARIAT")
  ) {
    return true;
  }
  if (req.user.hasRole("KAPRODI") && (await isKaprodiOfProgramStudi(userId, ctx.program_studi_id))) {
    return true;
  }
  if (req.user.hasRole("SEKPRODI")) {
    const ids = await getSekprodiProgramStudiIds(await getStaffUsrId(userId));
    if (ids.includes(Number(ctx.program_studi_id))) return true;
  }
  return false;
}

// POST /pengumpulan-berkas-final/:skripsiId/init
exports.initPengumpulan = async (req, res, next) => {
  const conn = await db.getConnection();
  let txStarted = false;
  try {
    const skripsiId = Number(req.params.skripsiId);
    if (!Number.isFinite(skripsiId) || skripsiId <= 0) {
      return res.status(400).json({ ok: false, message: "Invalid skripsiId" });
    }
    const npm = await getStudentNpm(req.user.id);
    if (!npm) return res.status(403).json({ ok: false, message: "Forbidden" });

    await conn.beginTransaction();
    txStarted = true;

    const [[skripsiRow]] = await conn.query(
      `SELECT id, npm FROM skripsi WHERE id = ? LIMIT 1`,
      [skripsiId],
    );
    if (!skripsiRow) {
      await conn.rollback();
      txStarted = false;
      return res
        .status(404)
        .json({ ok: false, message: "Skripsi tidak ditemukan" });
    }
    if (skripsiRow.npm !== npm) {
      await conn.rollback();
      txStarted = false;
      return res.status(403).json({ ok: false, message: "Forbidden" });
    }

    // Prerequisite: the latest sidang's revisi_pasca_sidang.is_completed = 1 (an earlier
    // failed attempt's completed revisi must not count)
    const [[revisiRow]] = await conn.query(
      `SELECT rps.id, rps.is_completed
       FROM revisi_pasca_sidang rps
       JOIN sidang s ON s.id = rps.sidang_id
       WHERE s.skripsi_id = ? AND s.jenis = 'SKRIPSI' ORDER BY s.id DESC LIMIT 1`,
      [skripsiId],
    );
    if (!revisiRow || !revisiRow.is_completed) {
      await conn.rollback();
      txStarted = false;
      return res
        .status(409)
        .json({ ok: false, message: "Revisi pasca sidang belum selesai" });
    }

    // Prerequisite: latest sidang must be LULUS
    const [[latestSidang]] = await conn.query(
      `SELECT hasil_sidang FROM sidang WHERE skripsi_id = ? AND jenis = 'SKRIPSI' ORDER BY id DESC LIMIT 1`,
      [skripsiId],
    );
    if (!latestSidang || latestSidang.hasil_sidang !== "LULUS") {
      await conn.rollback();
      txStarted = false;
      return res
        .status(409)
        .json({ ok: false, message: "Sidang terakhir belum dinyatakan lulus" });
    }

    await conn.query(
      `INSERT IGNORE INTO pengumpulan_berkas_final (skripsi_id, status) VALUES (?, 'DRAFT')`,
      [skripsiId],
    );

    const [[row]] = await conn.query(
      `SELECT id, status, is_completed FROM pengumpulan_berkas_final WHERE skripsi_id = ? LIMIT 1 FOR UPDATE`,
      [skripsiId],
    );
    if (!row) {
      await conn.rollback();
      txStarted = false;
      return res
        .status(409)
        .json({
          ok: false,
          message: "Gagal menginisiasi pengumpulan berkas, silakan coba lagi",
        });
    }

    await conn.commit();
    txStarted = false;
    return res.json({
      ok: true,
      data: { id: row.id, status: row.status, is_completed: row.is_completed },
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

// POST /pengumpulan-berkas-final/:skripsiId/submit
// A student submits once: only a DRAFT is accepted, under a row lock, so confirmations are never wiped.
exports.submitPengumpulan = async (req, res, next) => {
  let conn = null;
  let txStarted = false;
  try {
    const skripsiId = Number(req.params.skripsiId);
    if (!Number.isFinite(skripsiId) || skripsiId <= 0) {
      return res.status(400).json({ ok: false, message: "Invalid skripsiId" });
    }
    const npm = await getStudentNpm(req.user.id);
    if (!npm) return res.status(403).json({ ok: false, message: "Forbidden" });

    const { fileSkripsi, artikelPenelitian } = req.body ?? {};
    const uploads = [
      { fileType: "FILE_SKRIPSI", label: "File Skripsi", noun: "file skripsi", file: fileSkripsi },
      { fileType: "ARTIKEL_PENELITIAN", label: "Artikel Penelitian", noun: "artikel penelitian", file: artikelPenelitian },
    ];
    for (const { noun, label, file } of uploads) {
      if (
        typeof file?.fileContent !== "string" ||
        typeof file?.fileName !== "string" ||
        !file.fileContent ||
        !file.fileName
      ) {
        return res.status(400).json({ ok: false, message: "fileSkripsi dan artikelPenelitian wajib diisi" });
      }
      if (file.fileName.length > MAX_FILE_NAME_LENGTH) {
        return res.status(400).json({
          ok: false,
          message: `Nama ${noun} maksimal ${MAX_FILE_NAME_LENGTH} karakter`,
        });
      }
      const uploadError = validateUpload(file.fileContent, file.fileName, UPLOAD_RULES.PDF, label);
      if (uploadError) return res.status(400).json({ ok: false, message: uploadError });
    }

    const ctx = await getPengumpulanContext(db, skripsiId);
    if (!ctx || ctx.npm !== npm) {
      return res.status(404).json({ ok: false, message: "Pengumpulan berkas belum diinisiasi" });
    }
    if (ctx.status !== "DRAFT") {
      return res
        .status(409)
        .json({ ok: false, message: "Berkas final sudah dikirim dan tidak dapat diubah." });
    }
    if (!hasSignature(await getMahasiswaSignature(db, npm))) {
      return res.status(400).json({
        ok: false,
        message:
          "Tanda tangan Anda belum tersimpan. Simpan tanda tangan di halaman profil (/profil) sebelum mengirim berkas final.",
      });
    }

    const perpustakaanUserId = await getUserIdByRole(db, "PERPUSTAKAAN_STAFF");
    const lppmUserId = await getUserIdByRole(db, "LPPM");
    const [pb1UserId, pb2UserId, pg1UserId, pg2UserId] = await Promise.all(
      ["PEMBIMBING_1", "PEMBIMBING_2", "PENGUJI_1", "PENGUJI_2"].map((role) =>
        resolveDosenUserId(db, dosenNidnForRole(ctx, role)),
      ),
    );
    const confirmRows = [
      { role: "PERPUSTAKAAN", userId: perpustakaanUserId },
      { role: "LPPM", userId: lppmUserId },
      { role: "PEMBIMBING_1", userId: pb1UserId },
      { role: "PEMBIMBING_2", userId: pb2UserId },
      { role: "PENGUJI_1", userId: pg1UserId },
      { role: "PENGUJI_2", userId: pg2UserId },
    ];

    conn = await db.getConnection();
    await conn.beginTransaction();
    txStarted = true;

    const locked = await lockPengumpulan(conn, ctx.id);
    if (!locked || locked.status !== "DRAFT") {
      await conn.rollback();
      txStarted = false;
      return res
        .status(409)
        .json({ ok: false, message: "Berkas final sudah dikirim dan tidak dapat diubah." });
    }

    for (const { fileType, file } of uploads) {
      await conn.query(
        `DELETE FROM pengumpulan_berkas_final_files WHERE pengumpulan_id = ? AND file_type = ?`,
        [ctx.id, fileType],
      );
      await conn.query(
        `INSERT INTO pengumpulan_berkas_final_files (pengumpulan_id, file_type, file_name, mime_type, file_content)
         VALUES (?, ?, ?, ?, ?)`,
        [ctx.id, fileType, file.fileName, mimeFromFileName(file.fileName), file.fileContent],
      );
    }

    await conn.query(
      `DELETE FROM pengumpulan_berkas_final_confirmations WHERE pengumpulan_id = ?`,
      [ctx.id],
    );
    for (const row of confirmRows) {
      await conn.query(
        `INSERT INTO pengumpulan_berkas_final_confirmations (pengumpulan_id, recipient_role, user_id)
         VALUES (?, ?, ?)`,
        [ctx.id, row.role, row.userId ?? null],
      );
    }

    await conn.query(`UPDATE pengumpulan_berkas_final SET status = 'SUBMITTED' WHERE id = ?`, [ctx.id]);

    for (const row of confirmRows) {
      if (row.userId) {
        await insertNotification(
          conn,
          row.userId,
          "PENGUMPULAN_BERKAS_FINAL",
          `Mahasiswa dengan npm ${npm} telah mengunggah berkas final skripsi. Silakan konfirmasi penerimaan.`,
          recipientLink(row.role, skripsiId),
        );
      }
    }

    await conn.commit();
    txStarted = false;
    return res.json({ ok: true, data: { id: ctx.id, status: "SUBMITTED" } });
  } catch (err) {
    try {
      if (txStarted) await conn.rollback();
    } catch (_) {}
    next(err);
  } finally {
    conn?.release();
  }
};

// POST /pengumpulan-berkas-final/:skripsiId/confirm
// The 6th confirmation renders the surat before the transaction (no lock or pool connection held while
// Chromium runs); the transaction then locks the pengumpulan row first, so confirmations are serialized
// and the last confirmer always sees 6/6, and refuses with 409 if the rows the surat was rendered from changed.
exports.confirmPengumpulan = async (req, res, next) => {
  let conn = null;
  let txStarted = false;
  try {
    const skripsiId = Number(req.params.skripsiId);
    if (!Number.isFinite(skripsiId) || skripsiId <= 0) {
      return res.status(400).json({ ok: false, message: "Invalid skripsiId" });
    }
    const userId = Number(req.user.id);

    const ctx = await getPengumpulanContext(db, skripsiId);
    if (!ctx) {
      return res.status(404).json({ ok: false, message: "Pengumpulan berkas tidak ditemukan" });
    }
    if (ctx.status !== "SUBMITTED") {
      return res.status(409).json({ ok: false, message: "Berkas belum disubmit oleh mahasiswa" });
    }

    let matchedRole = null;
    if (req.user.hasRole("PERPUSTAKAAN_STAFF")) {
      matchedRole = "PERPUSTAKAAN";
    } else if (req.user.hasRole("LPPM")) {
      matchedRole = "LPPM";
    } else {
      const nidn = await getLecturerNidn(userId);
      if (nidn) {
        matchedRole =
          ["PEMBIMBING_1", "PEMBIMBING_2", "PENGUJI_1", "PENGUJI_2"].find(
            (role) => dosenNidnForRole(ctx, role) === nidn,
          ) ?? null;
      }
    }
    if (!matchedRole) {
      return res.status(403).json({ ok: false, message: "Anda tidak termasuk penerima berkas ini" });
    }

    const now = new Date(Math.floor(Date.now() / 1000) * 1000);
    const rows = await getConfirmations(db, ctx.id);
    const ownRow = rows.find((r) => r.recipient_role === matchedRole);
    if (!ownRow) {
      return res.status(404).json({ ok: false, message: "Data konfirmasi tidak ditemukan" });
    }
    if (ownRow.confirmed_at) {
      return res.status(409).json({ ok: false, message: "Anda sudah mengkonfirmasi sebelumnya" });
    }

    const renderedFingerprint = confirmationsFingerprint(rows, matchedRole);
    const othersConfirmed = rows.filter((r) => r.recipient_role !== matchedRole && r.confirmed_at).length;
    let docBuffer = null;
    if (othersConfirmed === rows.length - 1) {
      const withMine = rows.map((r) =>
        r.recipient_role === matchedRole ? { ...r, user_id: userId, confirmed_at: now } : r,
      );
      docBuffer = await generateSuratDoc(db, ctx, withMine);
    }

    conn = await db.getConnection();
    await conn.beginTransaction();
    txStarted = true;

    const locked = await lockPengumpulan(conn, ctx.id);
    const lockedRows = locked ? await getConfirmations(conn, ctx.id, { forUpdate: true }) : [];
    const lockedOwn = lockedRows.find((r) => r.recipient_role === matchedRole);
    const abort = async (status, message) => {
      await conn.rollback();
      txStarted = false;
      return res.status(status).json({ ok: false, message });
    };
    if (!locked || locked.status !== "SUBMITTED" || !lockedOwn) {
      return abort(409, BERKAS_CHANGED_MESSAGE);
    }
    if (lockedOwn.confirmed_at) {
      return abort(409, "Anda sudah mengkonfirmasi sebelumnya");
    }
    const isLast =
      lockedRows.filter((r) => r.recipient_role !== matchedRole && r.confirmed_at).length ===
      lockedRows.length - 1;
    if (isLast !== (docBuffer !== null) || confirmationsFingerprint(lockedRows, matchedRole) !== renderedFingerprint) {
      return abort(409, BERKAS_CHANGED_MESSAGE);
    }

    await conn.query(
      `UPDATE pengumpulan_berkas_final_confirmations SET confirmed_at = ?, user_id = ? WHERE id = ?`,
      [now, userId, lockedOwn.id],
    );
    const total = lockedRows.length;
    const confirmed = lockedRows.filter((r) => r.confirmed_at).length + 1;

    if (isLast) {
      await storeSurat(conn, ctx.id, docBuffer);
      await conn.query(`UPDATE pengumpulan_berkas_final SET status = 'WAITING_SIGNATURE' WHERE id = ?`, [ctx.id]);

      if (ctx.program_studi_id) {
        for (const sekprodiUserId of await getSekprodiUserIds(conn, ctx.program_studi_id)) {
          await insertNotification(
            conn,
            sekprodiUserId,
            "PENGUMPULAN_BERKAS_FINAL",
            `Semua pihak telah mengkonfirmasi berkas final skripsi mahasiswa npm ${ctx.npm}. Silakan tanda tangani surat penyerahan.`,
            recipientLink("SEKPRODI", skripsiId),
          );
        }
      }
      const studentUserId = await getUserIdByNpm(conn, ctx.npm);
      if (studentUserId) {
        await insertNotification(
          conn,
          studentUserId,
          "PENGUMPULAN_BERKAS_FINAL",
          "Semua pihak telah mengkonfirmasi berkas final skripsi Anda. Menunggu tanda tangan Sekretaris Prodi.",
          recipientLink("STUDENT", skripsiId),
        );
      }
    } else {
      const studentUserId = await getUserIdByNpm(conn, ctx.npm);
      if (studentUserId) {
        await insertNotification(
          conn,
          studentUserId,
          "PENGUMPULAN_BERKAS_FINAL",
          `Konfirmasi penerimaan berkas telah diterima (${confirmed}/${total}).`,
          recipientLink("STUDENT", skripsiId),
        );
      }
    }

    await conn.commit();
    txStarted = false;
    return res.json({ ok: true, data: { confirmed, total } });
  } catch (err) {
    try {
      if (txStarted) await conn.rollback();
    } catch (_) {}
    next(err);
  } finally {
    conn?.release();
  }
};

// POST /pengumpulan-berkas-final/:skripsiId/sign
// Checks, signatures and the render happen before the transaction; the transaction locks the row and
// re-checks WAITING_SIGNATURE, so a double sign gets one success and one 409.
exports.signPengumpulan = async (req, res, next) => {
  let conn = null;
  let txStarted = false;
  try {
    const skripsiId = Number(req.params.skripsiId);
    if (!Number.isFinite(skripsiId) || skripsiId <= 0) {
      return res.status(400).json({ ok: false, message: "Invalid skripsiId" });
    }
    if (!req.user.hasRole("SEKPRODI")) {
      return res.status(403).json({ ok: false, message: "Forbidden" });
    }
    const staffUsrId = await getStaffUsrId(req.user.id);
    if (!staffUsrId) return res.status(403).json({ ok: false, message: "Forbidden" });

    const ctx = await getPengumpulanContext(db, skripsiId);
    if (!ctx) {
      return res.status(404).json({ ok: false, message: "Pengumpulan berkas tidak ditemukan" });
    }
    if (ctx.status !== "WAITING_SIGNATURE") {
      return res
        .status(409)
        .json({ ok: false, message: "Belum semua pihak mengkonfirmasi penerimaan" });
    }

    const sekprodiProgramStudiIds = await getSekprodiProgramStudiIds(staffUsrId);
    if (!sekprodiProgramStudiIds.includes(Number(ctx.program_studi_id))) {
      return res
        .status(403)
        .json({ ok: false, message: "Anda bukan Sekretaris Prodi dari program studi ini" });
    }

    const sekprodiSig = await getStaffSignature(db, staffUsrId);
    const [[stafRow]] = await db.query(`SELECT nama FROM staf WHERE usr_id = ? LIMIT 1`, [staffUsrId]);
    const confirmations = await getConfirmations(db, ctx.id);
    const docBuffer = await generateSuratDoc(db, ctx, confirmations, {
      signatureImage: sekprodiSig,
      nama: stafRow?.nama ?? "",
    });

    conn = await db.getConnection();
    await conn.beginTransaction();
    txStarted = true;

    const locked = await lockPengumpulan(conn, ctx.id);
    if (!locked || locked.status !== "WAITING_SIGNATURE") {
      await conn.rollback();
      txStarted = false;
      return res.status(409).json({
        ok: false,
        message:
          locked?.status === "COMPLETED"
            ? "Surat penyerahan sudah ditandatangani."
            : BERKAS_CHANGED_MESSAGE,
      });
    }

    await storeSurat(conn, ctx.id, docBuffer);
    await conn.query(
      `UPDATE pengumpulan_berkas_final SET status = 'COMPLETED', is_completed = 1 WHERE id = ?`,
      [ctx.id],
    );

    const studentUserId = await getUserIdByNpm(conn, ctx.npm);
    if (studentUserId) {
      await insertNotification(
        conn,
        studentUserId,
        "PENGUMPULAN_BERKAS_FINAL",
        "Surat Pernyataan Penyerahan Skripsi telah ditandatangani. Proses pengumpulan berkas final selesai.",
        recipientLink("STUDENT", skripsiId),
      );
    }

    await conn.commit();
    txStarted = false;
    return res.json({ ok: true, data: { status: "COMPLETED", is_completed: 1 } });
  } catch (err) {
    try {
      if (txStarted) await conn.rollback();
    } catch (_) {}
    next(err);
  } finally {
    conn?.release();
  }
};

// GET /pengumpulan-berkas-final/:skripsiId
exports.getPengumpulan = async (req, res, next) => {
  try {
    const skripsiId = Number(req.params.skripsiId);
    if (!Number.isFinite(skripsiId) || skripsiId <= 0) {
      return res.status(400).json({ ok: false, message: "Invalid skripsiId" });
    }

    const pengumpulan = await getPengumpulanContext(db, skripsiId);
    if (!pengumpulan) {
      return res.status(404).json({ ok: false, message: "Pengumpulan berkas tidak ditemukan" });
    }
    if (!(await canAccessPengumpulan(req, pengumpulan))) {
      return res.status(403).json({ ok: false, message: "Forbidden" });
    }

    const confirmations = await getConfirmations(db, pengumpulan.id);

    const [files] = await db.query(
      `SELECT id, file_type, file_name, mime_type, created_at
       FROM pengumpulan_berkas_final_files
       WHERE pengumpulan_id = ? AND file_type != 'SURAT_PERNYATAAN_PENYERAHAN'`,
      [pengumpulan.id],
    );

    const [[suratFile]] = await db.query(
      `SELECT id, file_name, created_at
       FROM pengumpulan_berkas_final_files
       WHERE pengumpulan_id = ? AND file_type = 'SURAT_PERNYATAAN_PENYERAHAN'
       LIMIT 1`,
      [pengumpulan.id],
    );

    const missingSignatures = await computeMissingSignatures(pengumpulan, confirmations);

    return res.json({
      ok: true,
      data: {
        id: pengumpulan.id,
        skripsiId: pengumpulan.skripsi_id,
        npm: pengumpulan.npm,
        namaMahasiswa: pengumpulan.nama_mahasiswa ?? null,
        judulSkripsi: pengumpulan.judul_skripsi ?? null,
        programStudiNama: pengumpulan.program_studi_nama ?? null,
        pembimbing1Nama: pengumpulan.pembimbing1_nama ?? null,
        pembimbing2Nama: pengumpulan.pembimbing2_nama ?? null,
        penguji1Nama: pengumpulan.penguji1_nama ?? null,
        penguji2Nama: pengumpulan.penguji2_nama ?? null,
        status: pengumpulan.status,
        isCompleted: !!pengumpulan.is_completed,
        createdAt: pengumpulan.created_at,
        updatedAt: pengumpulan.updated_at,
        missingSignatures,
        confirmations: confirmations.map((c) => ({
          id: c.id,
          recipientRole: c.recipient_role,
          nama: dosenNamaForRole(pengumpulan, c.recipient_role) || null,
          userId: c.user_id,
          confirmedAt: c.confirmed_at,
        })),
        files: files.map((f) => ({
          id: f.id,
          fileType: f.file_type,
          fileName: f.file_name,
          mimeType: f.mime_type,
          createdAt: f.created_at,
        })),
        suratPenyerahan: suratFile
          ? {
              id: suratFile.id,
              fileName: suratFile.file_name,
              createdAt: suratFile.created_at,
            }
          : null,
      },
    });
  } catch (err) {
    next(err);
  }
};

// GET /pengumpulan-berkas-final/:skripsiId/files/:fileType
exports.getFile = async (req, res, next) => {
  try {
    const skripsiId = Number(req.params.skripsiId);
    if (!Number.isFinite(skripsiId) || skripsiId <= 0) {
      return res.status(400).json({ ok: false, message: "Invalid skripsiId" });
    }
    const fileType = req.params.fileType?.toUpperCase();

    const pengumpulan = await getPengumpulanContext(db, skripsiId);
    if (!pengumpulan) return res.status(404).json({ ok: false, message: "Tidak ditemukan" });
    if (!(await canAccessPengumpulan(req, pengumpulan))) {
      return res.status(403).json({ ok: false, message: "Forbidden" });
    }

    const [[fileRow]] = await db.query(
      `SELECT file_content, file_name, mime_type
       FROM pengumpulan_berkas_final_files
       WHERE pengumpulan_id = ? AND file_type = ?
       LIMIT 1`,
      [pengumpulan.id, fileType],
    );
    if (!fileRow) return res.status(404).json({ ok: false, message: "File tidak ditemukan" });

    return res.json({
      ok: true,
      data: {
        fileName: fileRow.file_name,
        mimeType: fileRow.mime_type ?? mimeFromFileName(fileRow.file_name),
        fileContent: fileRow.file_content,
      },
    });
  } catch (err) {
    next(err);
  }
};

// GET /lecturer/pengumpulan-berkas-final
exports.listForLecturer = async (req, res, next) => {
  try {
    const nidn = await getLecturerNidn(req.user.id);
    if (!nidn) return res.status(403).json({ ok: false, message: "Forbidden" });

    const statusFilter = req.query.status;

    const [rows] = await db.query(
      `SELECT t.*, conf.confirmed_at AS caller_confirmed_at
       FROM (
         SELECT pbf.id, pbf.skripsi_id, sk.npm, pbf.status, pbf.is_completed,
                pbf.created_at, pbf.updated_at,
                m.nama AS nama_mahasiswa,
                sk.judul AS judul_skripsi,
                CASE
                  WHEN sk.pembimbing1_nidn = ? THEN 'PEMBIMBING_1'
                  WHEN sk.pembimbing2_nidn = ? THEN 'PEMBIMBING_2'
                  WHEN psk_k.penguji1_nidn = ? THEN 'PENGUJI_1'
                  WHEN psk_k.penguji2_nidn = ? THEN 'PENGUJI_2'
                END AS caller_role
         FROM pengumpulan_berkas_final pbf
         JOIN skripsi sk ON sk.id = pbf.skripsi_id
         INNER JOIN sidang s ON s.id = (SELECT MAX(id) FROM sidang WHERE skripsi_id = pbf.skripsi_id AND jenis = 'SKRIPSI')
         LEFT JOIN pengajuan_sidang_kaprodi psk_k
                ON psk_k.pengajuan_sidang_id = s.pengajuan_sidang_id
         LEFT JOIN mahasiswa m ON m.npm = sk.npm
         WHERE pbf.status != 'DRAFT'
           AND (sk.pembimbing1_nidn = ?
             OR sk.pembimbing2_nidn = ?
             OR psk_k.penguji1_nidn = ?
             OR psk_k.penguji2_nidn = ?)
       ) t
       LEFT JOIN pengumpulan_berkas_final_confirmations conf
         ON conf.pengumpulan_id = t.id AND conf.recipient_role = t.caller_role
       ORDER BY t.created_at DESC`,
      [nidn, nidn, nidn, nidn, nidn, nidn, nidn, nidn],
    );

    const filtered = statusFilter
      ? rows.filter((r) => r.status === statusFilter)
      : rows;

    return res.json({
      ok: true,
      data: filtered.map((r) => ({
        id: r.id,
        skripsiId: r.skripsi_id,
        npm: r.npm,
        namaMahasiswa: r.nama_mahasiswa,
        judulSkripsi: r.judul_skripsi,
        status: r.status,
        isCompleted: !!r.is_completed,
        callerRole: r.caller_role,
        callerConfirmedAt: r.caller_confirmed_at,
        createdAt: r.created_at,
        updatedAt: r.updated_at,
      })),
    });
  } catch (err) {
    next(err);
  }
};

// GET /sekretariat-prodi/pengumpulan-berkas-final
exports.listForSekretariatProdi = async (req, res, next) => {
  try {
    if (!req.user.hasRole("SEKPRODI")) {
      return res.status(403).json({ ok: false, message: "Forbidden" });
    }
    const staffUsrId = await getStaffUsrId(req.user.id);
    if (!staffUsrId) {
      return res.status(403).json({ ok: false, message: "Forbidden" });
    }
    const programStudiIds = await getSekprodiProgramStudiIds(staffUsrId);
    if (programStudiIds.length === 0) {
      return res.json({ ok: true, data: [] });
    }

    const [rows] = await db.query(
      `SELECT pbf.id, pbf.skripsi_id, sk.npm, pbf.status, pbf.is_completed,
              pbf.created_at, pbf.updated_at,
              m.nama as nama_mahasiswa,
              sk.judul as judul_skripsi,
              (SELECT COUNT(*) FROM pengumpulan_berkas_final_confirmations c
               WHERE c.pengumpulan_id = pbf.id AND c.confirmed_at IS NOT NULL) as confirmed_count
       FROM pengumpulan_berkas_final pbf
       JOIN skripsi sk ON sk.id = pbf.skripsi_id
       INNER JOIN sidang s ON s.skripsi_id = pbf.skripsi_id AND s.id = (SELECT MAX(id) FROM sidang WHERE skripsi_id = pbf.skripsi_id AND jenis = 'SKRIPSI')
       LEFT JOIN mahasiswa m ON m.npm = sk.npm
       WHERE sk.program_studi_id IN (?)
       ORDER BY pbf.created_at DESC`,
      [programStudiIds],
    );

    const statusFilter = req.query.status;
    const filtered = statusFilter
      ? rows.filter((r) => r.status === statusFilter)
      : rows;

    return res.json({
      ok: true,
      data: filtered.map((r) => ({
        id: r.id,
        skripsiId: r.skripsi_id,
        npm: r.npm,
        namaMahasiswa: r.nama_mahasiswa,
        judulSkripsi: r.judul_skripsi,
        status: r.status,
        isCompleted: !!r.is_completed,
        confirmedCount: Number(r.confirmed_count),
        createdAt: r.created_at,
        updatedAt: r.updated_at,
      })),
    });
  } catch (err) {
    next(err);
  }
};

const VALID_PENGUMPULAN_STATUSES = [
  "DRAFT",
  "SUBMITTED",
  "WAITING_SIGNATURE",
  "COMPLETED",
];

exports.getKaprodiPengumpulan = async (req, res, next) => {
  try {
    if (!req.user.hasRole("KAPRODI")) {
      return res.status(403).json({ ok: false, message: "Forbidden" });
    }

    const { status } = req.query;
    const q = String(req.query.q ?? "").trim();
    const pagination = parsePagination(req.query);
    if (status !== undefined && !VALID_PENGUMPULAN_STATUSES.includes(status)) {
      return res.status(400).json({
        ok: false,
        message: `status harus salah satu dari: ${VALID_PENGUMPULAN_STATUSES.join(", ")}`,
      });
    }

    const staffUsrId = await getStaffUsrId(req.user.id);
    const programStudiIds = staffUsrId
      ? await getKaprodiProgramStudiIds(staffUsrId)
      : [];
    if (programStudiIds.length === 0) {
      return res.json({ ok: true, data: [] });
    }

    const placeholders = programStudiIds.map(() => "?").join(",");
    const searchCondition = q
      ? "AND (m.nama LIKE ? OR sk.npm LIKE ? OR sk.judul LIKE ?)"
      : "";
    const searchParams = q ? [`%${q}%`, `%${q}%`, `%${q}%`] : [];
    const [[countRow]] = await db.query(
      `SELECT COUNT(*) AS total
       FROM pengumpulan_berkas_final pbf
       JOIN skripsi sk ON sk.id = pbf.skripsi_id
       LEFT JOIN mahasiswa m ON m.npm = sk.npm
       WHERE sk.program_studi_id IN (${placeholders})
         AND (? IS NULL OR pbf.status = ?) ${searchCondition}`,
      [...programStudiIds, status ?? null, status ?? null, ...searchParams],
    );
    const [rows] = await db.query(
      `SELECT
         pbf.id, pbf.skripsi_id, sk.npm, m.nama AS nama_mahasiswa, sk.judul AS judul_skripsi,
         pbf.status, pbf.is_completed, pbf.created_at,
         (SELECT COUNT(*) FROM pengumpulan_berkas_final_confirmations c
          WHERE c.pengumpulan_id = pbf.id AND c.confirmed_at IS NOT NULL) AS confirmed_count
       FROM pengumpulan_berkas_final pbf
       JOIN skripsi sk ON sk.id = pbf.skripsi_id
       LEFT JOIN mahasiswa m ON m.npm = sk.npm
       WHERE sk.program_studi_id IN (${placeholders})
         AND (? IS NULL OR pbf.status = ?)
         ${searchCondition}
       ORDER BY pbf.created_at DESC${pagination.enabled ? " LIMIT ? OFFSET ?" : ""}`,
      pagination.enabled
        ? [...programStudiIds, status ?? null, status ?? null, ...searchParams, pagination.limit, pagination.offset]
        : [...programStudiIds, status ?? null, status ?? null, ...searchParams],
    );

    pagination.totalItems = Number(countRow.total);
    return listResponse(res, { rows, pagination });
  } catch (err) {
    next(err);
  }
};

async function listForInstitutionRole(roleCode, recipientRole, req, res, next) {
  try {
    if (!req.user.hasRole(roleCode)) {
      return res.status(403).json({ ok: false, message: "Forbidden" });
    }

    const statusFilter = req.query.status;

    const [rows] = await db.query(
      `SELECT pbf.id, pbf.skripsi_id, sk.npm, pbf.status, pbf.is_completed,
              pbf.created_at, pbf.updated_at,
              m.nama as nama_mahasiswa,
              sk.judul as judul_skripsi,
              conf.confirmed_at as caller_confirmed_at
       FROM pengumpulan_berkas_final pbf
       JOIN skripsi sk ON sk.id = pbf.skripsi_id
       LEFT JOIN mahasiswa m ON m.npm = sk.npm
       INNER JOIN pengumpulan_berkas_final_confirmations conf
         ON conf.pengumpulan_id = pbf.id AND conf.recipient_role = ?
       WHERE pbf.status != 'DRAFT'
       ORDER BY pbf.created_at DESC`,
      [recipientRole],
    );

    const filtered = statusFilter
      ? rows.filter((r) => r.status === statusFilter)
      : rows;

    return res.json({
      ok: true,
      data: filtered.map((r) => ({
        id: r.id,
        skripsiId: r.skripsi_id,
        npm: r.npm,
        namaMahasiswa: r.nama_mahasiswa,
        judulSkripsi: r.judul_skripsi,
        status: r.status,
        isCompleted: !!r.is_completed,
        callerRole: recipientRole,
        callerConfirmedAt: r.caller_confirmed_at,
        createdAt: r.created_at,
        updatedAt: r.updated_at,
      })),
    });
  } catch (err) {
    next(err);
  }
}

// GET /perpustakaan/pengumpulan-berkas-final
exports.listForPerpustakaan = (req, res, next) =>
  listForInstitutionRole("PERPUSTAKAAN_STAFF", "PERPUSTAKAAN", req, res, next);

// GET /lppm/pengumpulan-berkas-final
exports.listForLppm = (req, res, next) =>
  listForInstitutionRole("LPPM", "LPPM", req, res, next);
