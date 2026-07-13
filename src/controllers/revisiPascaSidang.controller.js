const db = require("../db");
const path = require("path");
const { readFile } = require("fs/promises");
const { patchDocument, PatchType, TextRun, ImageRun } = require("docx");
const { insertNotification } = require("../utils/notify");

const BULAN_ID = [
  "Januari",
  "Februari",
  "Maret",
  "April",
  "Mei",
  "Juni",
  "Juli",
  "Agustus",
  "September",
  "Oktober",
  "November",
  "Desember",
];

const STAGE_ORDER = ["PENGUJI_2", "PENGUJI_1", "PEMBIMBING_2", "PEMBIMBING_1"];

const NOTULEN_ROLE_LABEL = {
  PENGUJI_1: "Penguji Utama",
  PENGUJI_2: "Anggota Penguji",
};

function formatTanggal(date) {
  return `${date.getDate()} ${BULAN_ID[date.getMonth()]} ${date.getFullYear()}`;
}

function textPatch(value) {
  return {
    type: PatchType.PARAGRAPH,
    children: [new TextRun(String(value ?? ""))],
  };
}

function decodeSignatureToBuffer(signatureValue) {
  if (!signatureValue) return null;
  const base64 = signatureValue.includes(",")
    ? signatureValue.split(",")[1]
    : signatureValue;
  try {
    return Buffer.from(base64, "base64");
  } catch {
    return null;
  }
}

function signaturePatch(signatureValue) {
  const buf = decodeSignatureToBuffer(signatureValue);
  if (!buf) return textPatch("");
  return {
    type: PatchType.PARAGRAPH,
    children: [
      new ImageRun({ data: buf, transformation: { width: 100, height: 50 } }),
    ],
  };
}

async function getLecturerNidn(userId) {
  const [rows] = await db.query(
    `SELECT nidn FROM users WHERE id = ? AND is_active = 1 LIMIT 1`,
    [userId],
  );
  return rows[0]?.nidn ?? null;
}

async function getStudentNpm(userId) {
  const [rows] = await db.query(
    `SELECT npm FROM users WHERE id = ? AND is_active = 1 LIMIT 1`,
    [userId],
  );
  return rows[0]?.npm ?? null;
}

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

async function getSigByUserId(conn, userId) {
  if (!userId) return null;
  const [[row]] = await conn.query(
    `SELECT signature_image FROM users WHERE id = ? LIMIT 1`,
    [userId],
  );
  return row?.signature_image ?? null;
}

async function getSigByNidn(conn, nidn) {
  if (!nidn) return null;
  const [[row]] = await conn.query(
    `SELECT signature_image FROM users WHERE nidn = ? AND is_active = 1 ORDER BY id ASC LIMIT 1`,
    [nidn],
  );
  return row?.signature_image ?? null;
}

async function getSigByNidnAndRole(conn, nidn, roleCode) {
  if (!nidn) return null;
  const [[row]] = await conn.query(
    `SELECT u.signature_image
     FROM users u
     JOIN user_roles ur ON ur.user_id = u.id
     JOIN roles r ON r.id = ur.role_id
     WHERE u.nidn = ? AND u.is_active = 1 AND r.code = ?
     LIMIT 1`,
    [nidn, roleCode],
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

function hasSignature(signatureValue) {
  return Boolean(decodeSignatureToBuffer(signatureValue));
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

// Returns the first stage that is not yet APPROVED, or null if all approved / none created
function resolveActiveStage(stages) {
  for (const role of STAGE_ORDER) {
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

function getNamaForRole(sidangRow, role) {
  if (role === "PENGUJI_2") return sidangRow.penguji2_nama;
  if (role === "PENGUJI_1") return sidangRow.penguji1_nama;
  if (role === "PEMBIMBING_2") return sidangRow.pembimbing2_nama;
  if (role === "PEMBIMBING_1") return sidangRow.pembimbing1_nama;
  return null;
}

function getRoleLabel(role) {
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
    { role: "Mahasiswa", nama: sidangRow.nama_mahasiswa, signatureImage: sigMhs },
    { role: "Pembimbing 1", nama: sidangRow.pembimbing1_nama, signatureImage: sig1 },
    { role: "Pembimbing 2", nama: sidangRow.pembimbing2_nama, signatureImage: sig2 },
    { role: "Penguji 1", nama: sidangRow.penguji1_nama, signatureImage: sigPg1 },
    { role: "Penguji 2", nama: sidangRow.penguji2_nama, signatureImage: sigPg2 },
  ]);

  const templatePath = path.join(
    __dirname,
    "../templates/template_halaman_pengesahan_majelis_penguji.docx",
  );
  const templateBuffer = await readFile(templatePath);
  const outputBuffer = await patchDocument({
    outputType: "nodebuffer",
    data: templateBuffer,
    patches: {
      judul_skripsi: textPatch(sidangRow.judul_skripsi),
      nama_mahasiswa: textPatch(sidangRow.nama_mahasiswa),
      npm: textPatch(sidangRow.npm),
      tanggal_sidang: textPatch(tanggalStr),
      ttd_mahasiswa: signaturePatch(sigMhs),
      nama_pembimbing1: textPatch(sidangRow.pembimbing1_nama),
      ttd_pembimbing1: signaturePatch(sig1),
      nama_pembimbing2: textPatch(sidangRow.pembimbing2_nama),
      ttd_pembimbing2: signaturePatch(sig2),
      nama_penguji1: textPatch(sidangRow.penguji1_nama),
      ttd_penguji1: signaturePatch(sigPg1),
      nama_penguji2: textPatch(sidangRow.penguji2_nama),
      ttd_penguji2: signaturePatch(sigPg2),
    },
  });
  return outputBuffer;
}

async function generateHalamanPengesahanDekanDoc(conn, sidangRow) {
  const tahun = sidangRow.tanggal_sidang
    ? new Date(sidangRow.tanggal_sidang).getFullYear()
    : new Date().getFullYear();

  const [[prodiRow]] = await conn.query(
    `SELECT ps.fakultas_id, f.dekan_nidn, d.nama AS dekan_nama
     FROM program_studi ps
     LEFT JOIN fakultas f ON f.id = ps.fakultas_id
     LEFT JOIN dosen d ON d.nidn = f.dekan_nidn
     WHERE ps.id = ?
     LIMIT 1`,
    [sidangRow.program_studi_id],
  );

  const dekanNidn = prodiRow?.dekan_nidn ?? null;
  const dekanNama = prodiRow?.dekan_nama ?? "";

  const [sigMhs, sig1, sig2, sigDekan] = await Promise.all([
    getSigByNpm(conn, sidangRow.npm),
    getSigByNidn(conn, sidangRow.pembimbing1_nidn),
    getSigByNidn(conn, sidangRow.pembimbing2_nidn),
    getSigByNidnAndRole(conn, dekanNidn, "DEKAN"),
  ]);

  assertSignatures([
    { role: "Mahasiswa", nama: sidangRow.nama_mahasiswa, signatureImage: sigMhs },
    { role: "Pembimbing 1", nama: sidangRow.pembimbing1_nama, signatureImage: sig1 },
    { role: "Pembimbing 2", nama: sidangRow.pembimbing2_nama, signatureImage: sig2 },
    { role: "Dekan", nama: dekanNama, signatureImage: sigDekan },
  ]);

  const templatePath = path.join(
    __dirname,
    "../templates/template_halaman_pengesahan_dekan.docx",
  );
  const templateBuffer = await readFile(templatePath);
  const outputBuffer = await patchDocument({
    outputType: "nodebuffer",
    data: templateBuffer,
    patches: {
      judul_skripsi: textPatch(sidangRow.judul_skripsi),
      nama_mahasiswa: textPatch(sidangRow.nama_mahasiswa),
      npm: textPatch(sidangRow.npm),
      ttd_mahasiswa: signaturePatch(sigMhs),
      nama_pembimbing1: textPatch(sidangRow.pembimbing1_nama),
      ttd_pembimbing1: signaturePatch(sig1),
      nama_pembimbing2: textPatch(sidangRow.pembimbing2_nama),
      ttd_pembimbing2: signaturePatch(sig2),
      nama_dekan: textPatch(dekanNama),
      ttd_dekan: signaturePatch(sigDekan),
      prodi: textPatch((sidangRow.program_studi_nama ?? "").toUpperCase()),
      tahun_penulisan: textPatch(String(tahun)),
    },
  });
  return outputBuffer;
}

// POST /revisi-pasca-sidang/:skripsiId/init
exports.initRevisi = async (req, res, next) => {
  const conn = await db.getConnection();
  let txStarted = false;
  try {
    const skripsiId = Number(req.params.skripsiId);
    if (!Number.isFinite(skripsiId) || skripsiId <= 0) {
      return res
        .status(400)
        .json({ ok: false, message: "Invalid skripsiId" });
    }

    const npm = await getStudentNpm(req.user.id);
    if (!npm) {
      return res
        .status(403)
        .json({
          ok: false,
          message: "Hanya mahasiswa yang dapat menginisiasi revisi",
        });
    }

    const [[sidang]] = await db.query(
      `SELECT s.id, s.status, s.pengajuan_sidang_id,
              m.npm,
              psk_k.penguji2_nidn
       FROM sidang s
       JOIN skripsi sk ON sk.id = s.skripsi_id
       JOIN mahasiswa m ON m.npm = sk.npm
       LEFT JOIN pengajuan_sidang_kaprodi psk_k
              ON psk_k.pengajuan_sidang_id = s.pengajuan_sidang_id
       WHERE s.skripsi_id = ?
       ORDER BY s.id DESC LIMIT 1`,
      [skripsiId],
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

    // Return existing if already created
    const [[existing]] = await db.query(
      `SELECT rps.id, rps.is_completed
       FROM revisi_pasca_sidang rps
       JOIN sidang s ON s.id = rps.sidang_id
       WHERE s.skripsi_id = ? LIMIT 1`,
      [skripsiId],
    );
    if (existing) {
      const [[existingStage]] = await db.query(
        `SELECT id FROM revisi_pasca_sidang_stages WHERE revisi_id = ? AND signer_role = 'PENGUJI_2' LIMIT 1`,
        [existing.id],
      );
      if (!existingStage && !existing.is_completed) {
        const pg2UserId = await resolveUserId(conn, sidang.penguji2_nidn);
        await conn.query(
          `INSERT INTO revisi_pasca_sidang_stages (revisi_id, signer_role, user_id)
           VALUES (?, 'PENGUJI_2', ?)`,
          [existing.id, pg2UserId],
        );
      }
      return res.json({
        ok: true,
        data: { id: existing.id, isCompleted: !!existing.is_completed },
      });
    }

    await conn.beginTransaction();
    txStarted = true;

    const [result] = await conn.query(
      `INSERT INTO revisi_pasca_sidang (sidang_id) VALUES (?)`,
      [sidang.id],
    );
    const revisiId = result.insertId;

    // Create first stage lazily: PENGUJI_2
    const pg2UserId = await resolveUserId(conn, sidang.penguji2_nidn);
    await conn.query(
      `INSERT INTO revisi_pasca_sidang_stages (revisi_id, signer_role, user_id)
       VALUES (?, 'PENGUJI_2', ?)`,
      [revisiId, pg2UserId],
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
    conn.release();
  }
};

// POST /revisi-pasca-sidang/:skripsiId/submit
exports.submitRevisi = async (req, res, next) => {
  const conn = await db.getConnection();
  let txStarted = false;
  try {
    const skripsiId = Number(req.params.skripsiId);
    if (!Number.isFinite(skripsiId) || skripsiId <= 0) {
      return res
        .status(400)
        .json({ ok: false, message: "Invalid skripsiId" });
    }

    const npm = await getStudentNpm(req.user.id);
    if (!npm) {
      return res
        .status(403)
        .json({
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

    await conn.beginTransaction();
    txStarted = true;

    const [[revisi]] = await conn.query(
      `SELECT rps.*,
              m.npm, m.nama AS nama_mahasiswa,
              sk.pembimbing1_nidn, sk.pembimbing2_nidn,
              psk_k.penguji1_nidn, psk_k.penguji2_nidn,
              d1.nama AS pembimbing1_nama, d2.nama AS pembimbing2_nama,
              d_pg1.nama AS penguji1_nama, d_pg2.nama AS penguji2_nama
       FROM revisi_pasca_sidang rps
       JOIN sidang s ON s.id = rps.sidang_id
       JOIN skripsi sk ON sk.id = s.skripsi_id
       JOIN mahasiswa m ON m.npm = sk.npm
       LEFT JOIN dosen d1 ON d1.nidn = sk.pembimbing1_nidn
       LEFT JOIN dosen d2 ON d2.nidn = sk.pembimbing2_nidn
       LEFT JOIN pengajuan_sidang_kaprodi psk_k
              ON psk_k.pengajuan_sidang_id = s.pengajuan_sidang_id
       LEFT JOIN dosen d_pg1 ON d_pg1.nidn = psk_k.penguji1_nidn
       LEFT JOIN dosen d_pg2 ON d_pg2.nidn = psk_k.penguji2_nidn
       WHERE s.skripsi_id = ? LIMIT 1`,
      [skripsiId],
    );
    if (!revisi) {
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

    const activeStage = resolveActiveStage(stages);
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

    await insertNotification(
      conn,
      activeStage.user_id,
      "REVISI_PASCA_SIDANG",
      `Mahasiswa ${revisi.nama_mahasiswa} telah mengunggah revisi dan menunggu review Anda`,
      `/revisi-pasca-sidang/${skripsiId}`,
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
    conn.release();
  }
};

// POST /revisi-pasca-sidang/:skripsiId/review
exports.reviewRevisi = async (req, res, next) => {
  const conn = await db.getConnection();
  let txStarted = false;
  try {
    const skripsiId = Number(req.params.skripsiId);
    if (!Number.isFinite(skripsiId) || skripsiId <= 0) {
      return res
        .status(400)
        .json({ ok: false, message: "Invalid skripsiId" });
    }

    const nidn = await getLecturerNidn(req.user.id);
    if (!nidn) {
      return res
        .status(403)
        .json({ ok: false, message: "Hanya dosen yang dapat mereview revisi" });
    }

    const { decision, catatan, reviewFile, reviewFileName, reviewFileMimeType } = req.body;
    if (!decision || !["APPROVED", "NEED_REVISION"].includes(decision)) {
      return res
        .status(400)
        .json({
          ok: false,
          message: "decision harus APPROVED atau NEED_REVISION",
        });
    }
    if (decision === "NEED_REVISION" && (!catatan || !catatan.trim())) {
      return res
        .status(400)
        .json({
          ok: false,
          message: "catatan wajib diisi untuk NEED_REVISION",
        });
    }

    const hasReviewFile =
      reviewFile !== undefined && reviewFile !== null && String(reviewFile) !== "";
    const safeReviewFileName = String(reviewFileName ?? "").trim();
    if (hasReviewFile && !safeReviewFileName) {
      return res.status(400).json({
        ok: false,
        message: "reviewFileName is required when reviewFile is provided",
      });
    }

    await conn.beginTransaction();
    txStarted = true;

    const [[revisi]] = await conn.query(
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
       WHERE s.skripsi_id = ? ORDER BY s.id DESC LIMIT 1`,
      [skripsiId],
    );
    if (!revisi) {
      await conn.rollback();
      txStarted = false;
      return res
        .status(404)
        .json({ ok: false, message: "Revisi tidak ditemukan" });
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

    const activeStage = resolveActiveStage(stages);
    if (!activeStage) {
      await conn.rollback();
      txStarted = false;
      return res
        .status(409)
        .json({ ok: false, message: "Tidak ada tahap aktif saat ini" });
    }
    // Compare by NIDN so that any account sharing the same NIDN can review
    // (resolveUserId picks the lowest-id account, but the caller may be on a different account)
    const [[stageUserRow]] = await conn.query(
      `SELECT nidn FROM users WHERE id = ? LIMIT 1`,
      [activeStage.user_id],
    );
    if (!stageUserRow || stageUserRow.nidn !== nidn) {
      await conn.rollback();
      txStarted = false;
      return res
        .status(403)
        .json({ ok: false, message: "Belum giliran Anda untuk mereview" });
    }
    if (activeStage.current_status !== "SUBMITTED") {
      await conn.rollback();
      txStarted = false;
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

    const [reviewIns] = await conn.query(
      `INSERT INTO revisi_pasca_sidang_reviews (stage_id, submission_no, decision, catatan, reviewed_at)
       VALUES (?, ?, ?, ?, NOW())`,
      [
        activeStage.id,
        activeStage.current_submission_no,
        decision,
        catatan?.trim() ?? null,
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
          reviewFileMimeType ?? null,
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
        `${getRoleLabel(activeStage.signer_role)} meminta revisi: ${catatan.trim()}`,
        `/revisi-pasca-sidang/${skripsiId}`,
      );
    } else {
      // APPROVED
      await conn.query(
        `UPDATE revisi_pasca_sidang_stages SET current_status = 'APPROVED', finished_at = NOW(), updated_at = NOW() WHERE id = ?`,
        [activeStage.id],
      );

      const currentRoleIndex = STAGE_ORDER.indexOf(activeStage.signer_role);
      const nextRole = STAGE_ORDER[currentRoleIndex + 1] ?? null;

      if (["PENGUJI_2", "PENGUJI_1"].includes(activeStage.signer_role)) {
        const [[notulenRow]] = await conn.query(
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
        if (notulenRow && notulenRow.submitted_at) {
          const sigImage = await getSigByUserId(conn, activeStage.user_id);
          assertSignatures([
            {
              role: getRoleLabel(activeStage.signer_role),
              nama:
                activeStage.signer_role === "PENGUJI_1"
                  ? notulenRow.penguji1_nama
                  : notulenRow.penguji2_nama,
              signatureImage: sigImage,
            },
          ]);
          try {
            const templateBuffer = await readFile(
              path.join(__dirname, "../templates/template_notulen_penguji.docx"),
            );
            const outputBuffer = await patchDocument({
              outputType: "nodebuffer",
              data: templateBuffer,
              patches: {
                npm: textPatch(notulenRow.npm),
                nama_mahasiswa: textPatch(notulenRow.nama_mahasiswa),
                prodi: textPatch(notulenRow.program_studi_nama),
                judul_skripsi: textPatch(notulenRow.judul_skripsi),
                nama_pembimbing1: textPatch(notulenRow.pembimbing1_nama),
                nama_pembimbing2: textPatch(notulenRow.pembimbing2_nama),
                tanggal_sidang: textPatch(
                  notulenRow.tanggal_sidang
                    ? formatTanggal(new Date(notulenRow.tanggal_sidang))
                    : "",
                ),
                hasil_sidang: textPatch(notulenRow.hasil_sidang),
                role: textPatch(NOTULEN_ROLE_LABEL[activeStage.signer_role]),
                note: textPatch(notulenRow.note),
                nama_penguji: textPatch(
                  activeStage.signer_role === "PENGUJI_1"
                    ? notulenRow.penguji1_nama
                    : notulenRow.penguji2_nama,
                ),
                ttd_penguji: signaturePatch(sigImage),
              },
            });
            await conn.query(
              `UPDATE sidang_notulen SET file_content = ?, updated_at = NOW() WHERE sidang_id = ? AND role = ?`,
              [
                outputBuffer.toString("base64"),
                revisi.sidang_id,
                activeStage.signer_role,
              ],
            );
          } catch (_) {
            // non-fatal: notulen regeneration failure (unrelated to missing signatures) must not block revisi approval
          }
        }
      }

      if (nextRole) {
        const nextNidn = getNidnForRole(revisi, nextRole);
        const nextUserId = await resolveUserId(conn, nextNidn);

        await conn.query(
          `INSERT INTO revisi_pasca_sidang_stages (revisi_id, signer_role, user_id)
           VALUES (?, ?, ?)`,
          [revisi.id, nextRole, nextUserId],
        );

        const studentUserId = await getUserIdByNpm(conn, revisi.mahasiswa_npm);
        await insertNotification(
          conn,
          studentUserId,
          "REVISI_PASCA_SIDANG",
          `${getRoleLabel(activeStage.signer_role)} menyetujui revisi. Silakan unggah file ke ${getRoleLabel(nextRole)}`,
          `/revisi-pasca-sidang/${skripsiId}`,
        );

        await insertNotification(
          conn,
          nextUserId,
          "REVISI_PASCA_SIDANG",
          `Mahasiswa ${revisi.nama_mahasiswa} akan mengunggah revisi untuk ditandatangani`,
          `/revisi-pasca-sidang/${skripsiId}`,
        );
      } else {
        // PEMBIMBING_1 approved — last stage
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

          const majelisBuffer = await generateHalamanPengesahanMajelisDoc(
            conn,
            sidangForDoc,
          );
          await conn.query(
            `INSERT INTO revisi_pasca_sidang_files (revisi_id, file_type, file_name, file_content)
             VALUES (?, 'HALAMAN_PENGESAHAN_MAJELIS_PENGUJI', ?, ?)
             ON DUPLICATE KEY UPDATE file_name = VALUES(file_name), file_content = VALUES(file_content)`,
            [
              revisi.id,
              `Halaman_Pengesahan_Majelis_Penguji_${revisi.mahasiswa_npm}.docx`,
              majelisBuffer.toString("base64"),
            ],
          );

          const dekanBuffer = await generateHalamanPengesahanDekanDoc(
            conn,
            sidangForDoc,
          );
          await conn.query(
            `INSERT INTO revisi_pasca_sidang_files (revisi_id, file_type, file_name, file_content)
             VALUES (?, 'HALAMAN_PENGESAHAN_DEKAN', ?, ?)
             ON DUPLICATE KEY UPDATE file_name = VALUES(file_name), file_content = VALUES(file_content)`,
            [
              revisi.id,
              `Halaman_Pengesahan_Dekan_${revisi.mahasiswa_npm}.docx`,
              dekanBuffer.toString("base64"),
            ],
          );
        }

        await conn.query(
          `UPDATE revisi_pasca_sidang SET is_completed = 1, updated_at = NOW() WHERE id = ?`,
          [revisi.id],
        );

        const studentUserId = await getUserIdByNpm(conn, revisi.mahasiswa_npm);
        const completionMessage =
          revisi.hasil_sidang === "LULUS"
            ? "Revisi pasca sidang Anda telah selesai. Halaman pengesahan telah digenerate."
            : "Revisi pasca sidang Anda telah selesai. Silakan daftar ujian ulang.";
        await insertNotification(
          conn,
          studentUserId,
          "REVISI_PASCA_SIDANG",
          completionMessage,
          `/revisi-pasca-sidang/${skripsiId}`,
        );

        if (revisi.hasil_sidang === "TIDAK_LULUS") {
          const [[{ sidangCount }]] = await conn.query(
            `SELECT COUNT(*) AS sidangCount FROM sidang WHERE skripsi_id = ?`,
            [skripsiId],
          );
          const ujianKe = Number(sidangCount) + 1;
          await conn.query(
            `INSERT INTO pengajuan_sidang (skripsi_id, status, ujian_ke) VALUES (?, 'DRAFT', ?)`,
            [skripsiId, ujianKe],
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
    conn.release();
  }
};

// GET /revisi-pasca-sidang/:skripsiId
exports.getRevisi = async (req, res, next) => {
  try {
    const skripsiId = Number(req.params.skripsiId);
    if (!Number.isFinite(skripsiId) || skripsiId <= 0) {
      return res
        .status(400)
        .json({ ok: false, message: "Invalid skripsiId" });
    }

    const [[revisi]] = await db.query(
      `SELECT rps.*,
              sk.pembimbing1_nidn, sk.pembimbing2_nidn,
              psk_k.penguji1_nidn, psk_k.penguji2_nidn,
              m.nama AS nama_mahasiswa, m.npm AS mahasiswa_npm,
              sk.judul AS judul_skripsi,
              ps.nama AS program_studi_nama,
              d1.nama AS pembimbing1_nama,
              d2.nama AS pembimbing2_nama,
              dq1.nama AS penguji1_nama,
              dq2.nama AS penguji2_nama,
              s.status AS sidang_status, s.hasil_sidang
       FROM revisi_pasca_sidang rps
       JOIN sidang s ON s.id = rps.sidang_id
       JOIN skripsi sk ON sk.id = s.skripsi_id
       JOIN mahasiswa m ON m.npm = sk.npm
       JOIN program_studi ps ON ps.id = sk.program_studi_id
       LEFT JOIN dosen d1 ON d1.nidn = sk.pembimbing1_nidn
       LEFT JOIN dosen d2 ON d2.nidn = sk.pembimbing2_nidn
       LEFT JOIN pengajuan_sidang_kaprodi psk_k
              ON psk_k.pengajuan_sidang_id = s.pengajuan_sidang_id
       LEFT JOIN dosen dq1 ON dq1.nidn = psk_k.penguji1_nidn
       LEFT JOIN dosen dq2 ON dq2.nidn = psk_k.penguji2_nidn
       WHERE s.skripsi_id = ? LIMIT 1`,
      [skripsiId],
    );
    if (!revisi) {
      return res
        .status(404)
        .json({ ok: false, message: "Revisi tidak ditemukan" });
    }

    // Authorization
    const isStudent = req.user.hasRole("STUDENT");
    const isSekretariat = req.user.hasRole("SEKRETARIAT");
    const isKaprodi = req.user.hasRole("KAPRODI");

    if (isStudent) {
      const npm = await getStudentNpm(req.user.id);
      if (npm !== revisi.mahasiswa_npm) {
        return res.status(403).json({ ok: false, message: "Forbidden" });
      }
    } else if (!isSekretariat && !isKaprodi) {
      const nidn = await getLecturerNidn(req.user.id);
      if (!isRevisiParticipant(revisi, nidn)) {
        return res.status(403).json({ ok: false, message: "Forbidden" });
      }
    }

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

    const stagesWithData = stages.map((stage) => ({
      ...stage,
      submissions: subsByStage[stage.id] ?? [],
      reviews: reviewsByStage[stage.id] ?? [],
    }));

    const activeStage = resolveActiveStage(stages);

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
      return res
        .status(403)
        .json({
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
         s.skripsi_id, m.npm, m.nama AS nama_mahasiswa, sk.judul AS judul_skripsi, psk_k.tanggal_sidang,
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
        const active = resolveActiveStage(revisiStages);
        row.activeStage = active
          ? {
              signerRole: active.signer_role,
              currentStatus: active.current_status,
            }
          : null;

        let latestSubmittedAt = null;
        for (const stage of revisiStages) {
          const stageLatest = latestSubmittedByStage[stage.id];
          if (stageLatest && (!latestSubmittedAt || stageLatest > latestSubmittedAt)) {
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

const MIME_BY_EXT = {
  ".docx": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  ".doc": "application/msword",
  ".pdf": "application/pdf",
  ".xlsx": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
};

function mimeFromFileName(fileName) {
  const ext = fileName ? fileName.slice(fileName.lastIndexOf(".")).toLowerCase() : "";
  return MIME_BY_EXT[ext] ?? "application/octet-stream";
}

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

// GET /revisi-pasca-sidang/:skripsiId/files/submission
exports.getSubmissionFile = async (req, res, next) => {
  try {
    const skripsiId = Number(req.params.skripsiId);
    if (!Number.isFinite(skripsiId) || skripsiId <= 0) {
      return res
        .status(400)
        .json({ ok: false, message: "Invalid skripsiId" });
    }

    const [[revisi]] = await db.query(
      `SELECT rps.id, m.npm,
              sk.pembimbing1_nidn, sk.pembimbing2_nidn,
              psk_k.penguji1_nidn, psk_k.penguji2_nidn
       FROM revisi_pasca_sidang rps
       JOIN sidang s ON s.id = rps.sidang_id
       JOIN skripsi sk ON sk.id = s.skripsi_id
       JOIN mahasiswa m ON m.npm = sk.npm
       LEFT JOIN pengajuan_sidang_kaprodi psk_k
              ON psk_k.pengajuan_sidang_id = s.pengajuan_sidang_id
       WHERE s.skripsi_id = ? LIMIT 1`,
      [skripsiId],
    );
    if (!revisi) {
      return res
        .status(404)
        .json({ ok: false, message: "Revisi tidak ditemukan" });
    }

    const isStudent = req.user.hasRole("STUDENT");
    if (isStudent) {
      const npm = await getStudentNpm(req.user.id);
      if (npm !== revisi.npm)
        return res.status(403).json({ ok: false, message: "Forbidden" });
    } else if (
      !req.user.hasRole("SEKRETARIAT") &&
      !req.user.hasRole("KAPRODI")
    ) {
      const nidn = await getLecturerNidn(req.user.id);
      if (!isRevisiParticipant(revisi, nidn)) {
        return res.status(403).json({ ok: false, message: "Forbidden" });
      }
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
         m.npm, sk.pembimbing1_nidn, sk.pembimbing2_nidn,
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
      return res.status(404).json({ ok: false, message: "Review file not found" });
    }

    const isStudent = req.user.hasRole("STUDENT");
    if (isStudent) {
      const npm = await getStudentNpm(req.user.id);
      if (npm !== file.npm) {
        return res.status(403).json({ ok: false, message: "Forbidden" });
      }
    } else if (!req.user.hasRole("SEKRETARIAT") && !req.user.hasRole("KAPRODI")) {
      const nidn = await getLecturerNidn(req.user.id);
      if (!isRevisiParticipant(file, nidn)) {
        return res.status(403).json({ ok: false, message: "Forbidden" });
      }
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
      return res
        .status(400)
        .json({ ok: false, message: "Invalid skripsiId" });
    }

    const [[revisi]] = await db.query(
      `SELECT rps.id, m.npm,
              sk.pembimbing1_nidn, sk.pembimbing2_nidn,
              psk_k.penguji1_nidn, psk_k.penguji2_nidn
       FROM revisi_pasca_sidang rps
       JOIN sidang s ON s.id = rps.sidang_id
       JOIN skripsi sk ON sk.id = s.skripsi_id
       JOIN mahasiswa m ON m.npm = sk.npm
       LEFT JOIN pengajuan_sidang_kaprodi psk_k
              ON psk_k.pengajuan_sidang_id = s.pengajuan_sidang_id
       WHERE s.skripsi_id = ? LIMIT 1`,
      [skripsiId],
    );
    if (!revisi) {
      return res
        .status(404)
        .json({ ok: false, message: "Revisi tidak ditemukan" });
    }

    const isStudent = req.user.hasRole("STUDENT");
    if (isStudent) {
      const npm = await getStudentNpm(req.user.id);
      if (npm !== revisi.npm)
        return res.status(403).json({ ok: false, message: "Forbidden" });
    } else if (
      !req.user.hasRole("SEKRETARIAT") &&
      !req.user.hasRole("KAPRODI")
    ) {
      const nidn = await getLecturerNidn(req.user.id);
      if (!isRevisiParticipant(revisi, nidn)) {
        return res.status(403).json({ ok: false, message: "Forbidden" });
      }
    }

    const [[fileRow]] = await db.query(
      `SELECT file_name, file_content FROM revisi_pasca_sidang_files
       WHERE revisi_id = ? AND file_type = 'HALAMAN_PENGESAHAN_MAJELIS_PENGUJI' LIMIT 1`,
      [revisi.id],
    );
    if (!fileRow) {
      return res
        .status(404)
        .json({
          ok: false,
          message: "Halaman pengesahan majelis penguji belum tersedia",
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
      return res
        .status(400)
        .json({ ok: false, message: "Invalid skripsiId" });
    }

    const [[revisi]] = await db.query(
      `SELECT rps.id, m.npm,
              sk.pembimbing1_nidn, sk.pembimbing2_nidn,
              psk_k.penguji1_nidn, psk_k.penguji2_nidn
       FROM revisi_pasca_sidang rps
       JOIN sidang s ON s.id = rps.sidang_id
       JOIN skripsi sk ON sk.id = s.skripsi_id
       JOIN mahasiswa m ON m.npm = sk.npm
       LEFT JOIN pengajuan_sidang_kaprodi psk_k
              ON psk_k.pengajuan_sidang_id = s.pengajuan_sidang_id
       WHERE s.skripsi_id = ? LIMIT 1`,
      [skripsiId],
    );
    if (!revisi) {
      return res
        .status(404)
        .json({ ok: false, message: "Revisi tidak ditemukan" });
    }

    const isStudent = req.user.hasRole("STUDENT");
    if (isStudent) {
      const npm = await getStudentNpm(req.user.id);
      if (npm !== revisi.npm)
        return res.status(403).json({ ok: false, message: "Forbidden" });
    } else if (
      !req.user.hasRole("SEKRETARIAT") &&
      !req.user.hasRole("KAPRODI") &&
      !req.user.hasRole("DEKAN")
    ) {
      const nidn = await getLecturerNidn(req.user.id);
      if (!isRevisiParticipant(revisi, nidn)) {
        return res.status(403).json({ ok: false, message: "Forbidden" });
      }
    }

    const [[fileRow]] = await db.query(
      `SELECT file_name, file_content FROM revisi_pasca_sidang_files
       WHERE revisi_id = ? AND file_type = 'HALAMAN_PENGESAHAN_DEKAN' LIMIT 1`,
      [revisi.id],
    );
    if (!fileRow) {
      return res
        .status(404)
        .json({
          ok: false,
          message: "Halaman pengesahan dekan belum tersedia",
        });
    }

    return sendDocx(res, fileRow);
  } catch (err) {
    next(err);
  }
};
