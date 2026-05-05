const db = require("../db");
const path = require("path");
const { readFile } = require("fs/promises");
const { patchDocument, PatchType, TextRun, ImageRun } = require("docx");

async function getStudentNpm(userId) {
  const [rows] = await db.query(
    `SELECT npm FROM users WHERE id = ? AND is_active = 1 LIMIT 1`,
    [userId],
  );
  return rows[0]?.npm ?? null;
}

async function getLecturerNidn(userId) {
  const [rows] = await db.query(
    `SELECT nidn FROM users WHERE id = ? AND is_active = 1 LIMIT 1`,
    [userId],
  );
  return rows[0]?.nidn ?? null;
}

async function getKaprodiProgramStudiIdsByNidn(nidn) {
  const [rows] = await db.query(
    `SELECT id FROM program_studi WHERE kaprodi_nidn = ?`,
    [nidn],
  );
  return rows
    .map((row) => Number(row.id))
    .filter((id) => Number.isFinite(id) && id > 0);
}

function textPatch(value) {
  return {
    type: PatchType.PARAGRAPH,
    children: [new TextRun(String(value ?? ""))],
  };
}

function decodeSignatureToBuffer(signatureValue) {
  if (signatureValue === undefined || signatureValue === null) return null;

  const raw = String(signatureValue).trim();
  if (!raw) return null;

  const dataUrlMatch = raw.match(/^data:image\/[a-zA-Z0-9.+-]+;base64,(.+)$/i);
  if (dataUrlMatch?.[1]) {
    try {
      return Buffer.from(dataUrlMatch[1], "base64");
    } catch (_) {
      return null;
    }
  }

  const normalized = raw.replace(/\s+/g, "");
  const looksLikeBase64 =
    /^[A-Za-z0-9+/=]+$/.test(normalized) && normalized.length % 4 === 0;
  if (looksLikeBase64) {
    try {
      return Buffer.from(normalized, "base64");
    } catch (_) {
      return null;
    }
  }

  return null;
}

function signatureImagePatch(signatureValue) {
  const signatureBuffer = decodeSignatureToBuffer(signatureValue);
  if (!signatureBuffer || signatureBuffer.length === 0) {
    return textPatch("");
  }
  try {
    return {
      type: PatchType.PARAGRAPH,
      children: [
        new ImageRun({
          data: signatureBuffer,
          transformation: { width: 120, height: 50 },
        }),
      ],
    };
  } catch (_) {
    return textPatch("");
  }
}

const SIGNING_ORDER = ["MAHASISWA", "PEMBIMBING_2", "PEMBIMBING_1", "KAPRODI"];

function getNextExpectedRole(signatures) {
  const signedRoles = new Set(signatures.map((s) => s.signer_role));
  for (const role of SIGNING_ORDER) {
    if (!signedRoles.has(role)) return role;
  }
  return null;
}

async function inferSignerRole(req, kartu) {
  if (req.user.userType === "STUDENT") {
    const npm = await getStudentNpm(req.user.id);
    if (!npm || npm !== kartu.npm) {
      const err = new Error("Forbidden");
      err.statusCode = 403;
      throw err;
    }
    return { signerRole: "MAHASISWA" };
  }

  if (req.user.userType === "LECTURER") {
    const nidn = await getLecturerNidn(req.user.id);
    if (!nidn) {
      const err = new Error("Forbidden");
      err.statusCode = 403;
      throw err;
    }

    if (nidn === kartu.pembimbing2_nidn) {
      return { signerRole: "PEMBIMBING_2", nidn };
    }
    if (nidn === kartu.pembimbing1_nidn) {
      return { signerRole: "PEMBIMBING_1", nidn };
    }
    if (req.user.hasRole("KAPRODI")) {
      const programStudiIds = await getKaprodiProgramStudiIdsByNidn(nidn);
      if (programStudiIds.includes(Number(kartu.program_studi_id))) {
        return { signerRole: "KAPRODI", nidn };
      }
    }
  }

  const err = new Error("Forbidden");
  err.statusCode = 403;
  throw err;
}

async function buildHalamanPersetujuanDocxBuffer({
  kartu,
  signatures,
  programStudiNama,
  namaKaprodi,
}) {
  const templatePath = path.join(
    __dirname,
    "..",
    "templates",
    "template_halaman_persetujuan_judul_desain_skripsi.docx",
  );
  const templateBuffer = await readFile(templatePath);

  const sigMap = {};
  for (const s of signatures) {
    sigMap[s.signer_role] = s.signature_image;
  }

  const programStudi = programStudiNama ?? kartu.program_studi_nama ?? "";

  const patches = {
    nama_mahasiswa: textPatch(kartu.nama_mahasiswa),
    npm: textPatch(kartu.npm),
    program_studi1: textPatch(programStudi),
    program_studi2: textPatch(programStudi.toUpperCase()),
    judul_skripsi: textPatch((kartu.judul_skripsi ?? "").toUpperCase()),
    nama_pembimbing1: textPatch(kartu.pembimbing1_nama),
    nama_pembimbing2: textPatch(kartu.pembimbing2_nama),
    nama_kaprodi: textPatch(namaKaprodi ?? ""),
    tahun: textPatch(String(new Date().getFullYear())),
    ttd_mahasiswa: signatureImagePatch(sigMap["MAHASISWA"]),
    ttd_pembimbing2: signatureImagePatch(sigMap["PEMBIMBING_2"]),
    ttd_pembimbing1: signatureImagePatch(sigMap["PEMBIMBING_1"]),
    ttd_kaprodi: signatureImagePatch(sigMap["KAPRODI"]),
  };

  return patchDocument({
    outputType: "nodebuffer",
    data: templateBuffer,
    patches,
  });
}

async function generateAndStoreHalamanDocx(
  queryable,
  {
    halamanId,
    pengajuanJudulId,
    kartu,
    signatures,
    programStudiNama,
    namaKaprodi,
    generatedByUserId,
  },
) {
  const outputBuffer = await buildHalamanPersetujuanDocxBuffer({
    kartu,
    signatures,
    programStudiNama,
    namaKaprodi,
  });

  const mimeType =
    "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
  const fileName = `halaman-persetujuan-judul-${pengajuanJudulId}-${Date.now()}.docx`;

  const [ins] = await queryable.query(
    `INSERT INTO halaman_persetujuan_judul_file (
       halaman_persetujuan_judul_id,
       file_name,
       mime_type,
       file_content,
       generated_by_user_id,
       generated_at
     ) VALUES (?, ?, ?, ?, ?, CURRENT_TIMESTAMP)`,
    [
      halamanId,
      fileName,
      mimeType,
      outputBuffer.toString("base64"),
      generatedByUserId,
    ],
  );

  return { id: ins.insertId, fileName, mimeType };
}

exports.initHalamanPersetujuan = async (req, res, next) => {
  try {
    if (req.user.userType !== "STUDENT") {
      return res
        .status(403)
        .json({
          ok: false,
          message: "Only students can initialize halaman persetujuan",
        });
    }

    const pengajuanJudulId = Number(req.params.pengajuanJudulId);
    if (!Number.isFinite(pengajuanJudulId) || pengajuanJudulId <= 0) {
      return res
        .status(400)
        .json({ ok: false, message: "Invalid pengajuanJudulId" });
    }

    const npm = await getStudentNpm(req.user.id);
    if (!npm) {
      return res
        .status(400)
        .json({ ok: false, message: "Mahasiswa tidak valid" });
    }

    const [pjRows] = await db.query(
      `SELECT id FROM pengajuan_judul WHERE id = ? AND npm = ? AND status = 'APPROVED' LIMIT 1`,
      [pengajuanJudulId, npm],
    );
    if (pjRows.length === 0) {
      return res
        .status(400)
        .json({
          ok: false,
          message: "Pengajuan judul belum disetujui atau tidak ditemukan",
        });
    }

    const [kartuRows] = await db.query(
      `SELECT id FROM kartu_konsultasi_outline WHERE pengajuan_judul_id = ? AND npm = ? AND is_completed = 1 LIMIT 1`,
      [pengajuanJudulId, npm],
    );
    if (kartuRows.length === 0) {
      return res
        .status(400)
        .json({ ok: false, message: "Kartu konsultasi outline belum selesai" });
    }

    const [existingRows] = await db.query(
      `SELECT id FROM halaman_persetujuan_judul WHERE pengajuan_judul_id = ? LIMIT 1`,
      [pengajuanJudulId],
    );
    if (existingRows.length > 0) {
      return res
        .status(409)
        .json({ ok: false, message: "Halaman persetujuan sudah dibuat" });
    }

    const [ins] = await db.query(
      `INSERT INTO halaman_persetujuan_judul (pengajuan_judul_id, status) VALUES (?, 'PENDING')`,
      [pengajuanJudulId],
    );

    return res.status(201).json({
      ok: true,
      message: "Halaman persetujuan dibuat",
      data: { id: ins.insertId },
    });
  } catch (err) {
    next(err);
  }
};

exports.getHalamanPersetujuan = async (req, res, next) => {
  try {
    const pengajuanJudulId = Number(req.params.pengajuanJudulId);
    if (!Number.isFinite(pengajuanJudulId) || pengajuanJudulId <= 0) {
      return res
        .status(400)
        .json({ ok: false, message: "Invalid pengajuanJudulId" });
    }

    const [halamanRows] = await db.query(
      `SELECT * FROM halaman_persetujuan_judul WHERE pengajuan_judul_id = ? LIMIT 1`,
      [pengajuanJudulId],
    );
    const halaman = halamanRows[0] ?? null;
    if (!halaman) {
      return res
        .status(404)
        .json({ ok: false, message: "Halaman persetujuan tidak ditemukan" });
    }

    const [signatures] = await db.query(
      `SELECT id, signer_role, signed_at
       FROM halaman_persetujuan_judul_signatures
       WHERE halaman_persetujuan_judul_id = ?
       ORDER BY FIELD(signer_role, 'MAHASISWA', 'PEMBIMBING_2', 'PEMBIMBING_1', 'KAPRODI')`,
      [halaman.id],
    );

    const next_expected_role = getNextExpectedRole(signatures);

    return res.json({
      ok: true,
      data: { halaman, signatures, next_expected_role },
    });
  } catch (err) {
    next(err);
  }
};

exports.signHalamanPersetujuan = async (req, res, next) => {
  const conn = await db.getConnection();
  let txStarted = false;
  try {
    const pengajuanJudulId = Number(req.params.pengajuanJudulId);
    if (!Number.isFinite(pengajuanJudulId) || pengajuanJudulId <= 0) {
      return res
        .status(400)
        .json({ ok: false, message: "Invalid pengajuanJudulId" });
    }

    const signatureImage = req.body?.signatureImage;
    if (!signatureImage || !String(signatureImage).trim()) {
      return res
        .status(400)
        .json({ ok: false, message: "signatureImage is required" });
    }

    await conn.beginTransaction();
    txStarted = true;

    const [halamanRows] = await conn.query(
      `SELECT * FROM halaman_persetujuan_judul WHERE pengajuan_judul_id = ? LIMIT 1 FOR UPDATE`,
      [pengajuanJudulId],
    );
    const halaman = halamanRows[0] ?? null;
    if (!halaman) {
      await conn.rollback();
      txStarted = false;
      return res
        .status(404)
        .json({ ok: false, message: "Halaman persetujuan tidak ditemukan" });
    }
    if (halaman.status === "COMPLETED") {
      await conn.rollback();
      txStarted = false;
      return res
        .status(409)
        .json({
          ok: false,
          message: "Halaman persetujuan sudah selesai ditandatangani",
        });
    }

    const [kartuRows] = await conn.query(
      `SELECT * FROM kartu_konsultasi_outline WHERE pengajuan_judul_id = ? LIMIT 1`,
      [pengajuanJudulId],
    );
    const kartu = kartuRows[0] ?? null;
    if (!kartu) {
      await conn.rollback();
      txStarted = false;
      return res
        .status(404)
        .json({
          ok: false,
          message: "Kartu konsultasi outline tidak ditemukan",
        });
    }

    let signerRole;
    try {
      ({ signerRole } = await inferSignerRole(req, kartu));
    } catch (err) {
      await conn.rollback();
      txStarted = false;
      return res
        .status(err.statusCode ?? 403)
        .json({ ok: false, message: err.message });
    }

    const [existingSignatures] = await conn.query(
      `SELECT id, signer_role, signed_at
       FROM halaman_persetujuan_judul_signatures
       WHERE halaman_persetujuan_judul_id = ?
       FOR UPDATE`,
      [halaman.id],
    );

    const nextRole = getNextExpectedRole(existingSignatures);
    if (nextRole !== signerRole) {
      await conn.rollback();
      txStarted = false;
      return res.status(409).json({
        ok: false,
        message: `Belum giliran Anda untuk menandatangani. Menunggu tanda tangan dari: ${nextRole}`,
      });
    }

    await conn.query(
      `INSERT INTO halaman_persetujuan_judul_signatures
         (halaman_persetujuan_judul_id, signer_role, signature_image, signed_at)
       VALUES (?, ?, ?, CURRENT_TIMESTAMP)`,
      [halaman.id, signerRole, String(signatureImage)],
    );

    const [allSignatures] = await conn.query(
      `SELECT signer_role, signature_image, signed_at
       FROM halaman_persetujuan_judul_signatures
       WHERE halaman_persetujuan_judul_id = ?`,
      [halaman.id],
    );

    const isCompleted = allSignatures.length === 4;
    let generatedFile = null;

    if (isCompleted) {
      const [psRows] = await conn.query(
        `SELECT ps.nama AS program_studi_nama, d.nama AS kaprodi_nama
         FROM program_studi ps
         LEFT JOIN dosen d ON d.nidn = ps.kaprodi_nidn
         WHERE ps.id = ?
         LIMIT 1`,
        [kartu.program_studi_id],
      );
      const programStudiNama =
        psRows[0]?.program_studi_nama ?? kartu.program_studi_nama ?? "";
      const namaKaprodi = psRows[0]?.kaprodi_nama ?? "";

      generatedFile = await generateAndStoreHalamanDocx(conn, {
        halamanId: halaman.id,
        pengajuanJudulId,
        kartu,
        signatures: allSignatures,
        programStudiNama,
        namaKaprodi,
        generatedByUserId: req.user.id,
      });

      await conn.query(
        `UPDATE halaman_persetujuan_judul SET status = 'COMPLETED', updated_at = CURRENT_TIMESTAMP WHERE id = ?`,
        [halaman.id],
      );
    }

    await conn.commit();
    txStarted = false;

    return res.json({
      ok: true,
      message: "Tanda tangan berhasil disimpan",
      data: { signerRole, isCompleted, generatedFile },
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

exports.getHalamanPersetujuanFile = async (req, res, next) => {
  try {
    const pengajuanJudulId = Number(req.params.pengajuanJudulId);
    if (!Number.isFinite(pengajuanJudulId) || pengajuanJudulId <= 0) {
      return res
        .status(400)
        .json({ ok: false, message: "Invalid pengajuanJudulId" });
    }

    const [halamanRows] = await db.query(
      `SELECT * FROM halaman_persetujuan_judul WHERE pengajuan_judul_id = ? LIMIT 1`,
      [pengajuanJudulId],
    );
    const halaman = halamanRows[0] ?? null;
    if (!halaman) {
      return res
        .status(404)
        .json({ ok: false, message: "Halaman persetujuan tidak ditemukan" });
    }
    if (halaman.status !== "COMPLETED") {
      return res
        .status(409)
        .json({
          ok: false,
          message: "Halaman persetujuan belum selesai ditandatangani",
        });
    }

    const [fileRows] = await db.query(
      `SELECT id, file_name, mime_type, file_content, generated_at
       FROM halaman_persetujuan_judul_file
       WHERE halaman_persetujuan_judul_id = ?
       ORDER BY generated_at DESC
       LIMIT 1`,
      [halaman.id],
    );
    const file = fileRows[0] ?? null;
    if (!file) {
      return res
        .status(404)
        .json({
          ok: false,
          message: "File halaman persetujuan tidak ditemukan",
        });
    }

    return res.json({ ok: true, data: file });
  } catch (err) {
    next(err);
  }
};
