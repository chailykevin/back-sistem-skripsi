const db = require("../db");
const { insertNotification } = require("../utils/notify");
const path = require("path");
const { readFile } = require("fs/promises");
const { patchDocument, PatchType, TextRun, ImageRun } = require("docx");

const BULAN_ID = [
  "Januari", "Februari", "Maret", "April", "Mei", "Juni",
  "Juli", "Agustus", "September", "Oktober", "November", "Desember",
];

function formatDateId(date) {
  const d = date instanceof Date ? date : new Date(date);
  return `${d.getDate()} ${BULAN_ID[d.getMonth()]} ${d.getFullYear()}`;
}

function checkbox(value) {
  return value ? "☑" : "☐";
}

function buildFormulirFileName(npm, namaMahasiswa) {
  const safeNpm = String(npm ?? "").trim().replace(/[^\w.-]+/g, "_");
  const safeNama = String(namaMahasiswa ?? "").trim().replace(/[^\w.-]+/g, "_");
  return `${safeNpm} - ${safeNama} - Formulir Pengajuan Disposisi Pembimbing.docx`;
}

function textPatch(value) {
  return {
    type: PatchType.PARAGRAPH,
    children: [new TextRun(String(value ?? ""))],
  };
}

function decodeSignatureToBuffer(signatureValue) {
  if (signatureValue == null) return null;
  const raw = String(signatureValue).trim();
  if (!raw) return null;
  const dataUrlMatch = raw.match(/^data:image\/([a-zA-Z0-9.+-]+);base64,(.+)$/i);
  if (dataUrlMatch) {
    try {
      const mimeType = dataUrlMatch[1].toLowerCase();
      const type = mimeType === "jpeg" ? "jpg" : mimeType;
      return { buffer: Buffer.from(dataUrlMatch[2], "base64"), type };
    } catch (_) { return null; }
  }
  const normalized = raw.replace(/\s+/g, "");
  const looksLikeBase64 = /^[A-Za-z0-9+/=]+$/.test(normalized) && normalized.length % 4 === 0;
  if (looksLikeBase64) {
    try {
      const buffer = Buffer.from(normalized, "base64");
      const type = buffer[0] === 0x89 && buffer[1] === 0x50 ? "png" : "jpg";
      return { buffer, type };
    } catch (_) { return null; }
  }
  return null;
}

function signatureImagePatch(signatureValue) {
  const decoded = decodeSignatureToBuffer(signatureValue);
  if (!decoded || decoded.buffer.length === 0) return textPatch("");
  try {
    return {
      type: PatchType.PARAGRAPH,
      children: [new ImageRun({ type: decoded.type, data: decoded.buffer, transformation: { width: 160, height: 60 } })],
    };
  } catch (_) { return textPatch(""); }
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

async function generateFormulirDoc(data) {
  const {
    npm, namaMahasiswa, programStudiNama, noHp, sks, judulSkripsi,
    pembimbing1Nama, pembimbing2Nama, perluSuratPengantar, namaPerusahaan,
    studentSignature, submittedAt,
    // kaprodi review fields (optional)
    programStudiNamaUpper, disposisiDate, keputusan,
    dosenPembimbing1, dosenPembimbing2, catatan,
    syaratTranskrip, syaratKrs, syaratMetodologi,
    namaKaprodi, kaprodiSignature,
  } = data;

  const templateBuffer = await readFile(
    path.join(__dirname, "../templates/template_formulir_pengajuan_disposisi_pembimbing_skripsi.docx"),
  );

  const patches = {
    npm: textPatch(npm ?? ""),
    nama_mahasiswa: textPatch(namaMahasiswa ?? ""),
    nama: textPatch(namaMahasiswa ?? ""),
    program_studi: textPatch(programStudiNama ?? ""),
    no_hp: textPatch(noHp ?? ""),
    sks: textPatch(String(sks ?? "")),
    judul: textPatch(judulSkripsi ?? ""),
    calon_dosen_pembimbing_1: textPatch(pembimbing1Nama ?? ""),
    calon_dosen_pembimbing_2: textPatch(pembimbing2Nama ?? ""),
    perlu_surat_pengantar: textPatch(
      perluSuratPengantar
        ? "☑ Ya    ☐ Tidak"
        : "☐ Ya    ☑ Tidak"
    ),
    nama_perusahaan: textPatch(namaPerusahaan || "-"),
    today_date: textPatch(formatDateId(submittedAt ?? new Date())),
    signature: signatureImagePatch(studentSignature),
    // kaprodi section
    nama_program_studi: textPatch(programStudiNamaUpper ?? (programStudiNama ? String(programStudiNama).toUpperCase() : "")),
    disposisi_date: textPatch(disposisiDate ? formatDateId(disposisiDate) : ""),
    keputusan: textPatch(keputusan ?? ""),
    dosen_pembimbing_1: textPatch(dosenPembimbing1 ?? ""),
    dosen_pembimbing_2: textPatch(dosenPembimbing2 ?? ""),
    catatan: textPatch(catatan || "-"),
    syarat_transkrip: textPatch(checkbox(syaratTranskrip)),
    syarat_krs: textPatch(checkbox(syaratKrs)),
    syarat_metodologi: textPatch(checkbox(syaratMetodologi)),
    nama_kaprodi: textPatch(namaKaprodi ?? ""),
    kaprodi_signature: signatureImagePatch(kaprodiSignature),
  };

  const outputBuffer = await patchDocument({ outputType: "nodebuffer", data: templateBuffer, patches });
  return outputBuffer.toString("base64");
}

async function getStudentNpm(userId) {
  const [urows] = await db.query(
    `SELECT npm
     FROM users
     WHERE id = ? AND is_active = 1
     LIMIT 1`,
    [userId],
  );
  return urows[0]?.npm ?? null;
}

const toBit = (v, fallback = 0) => (v === undefined ? fallback : v ? 1 : 0);

function mapNewFileRowsToLegacyKeys(fileRows = [], fallback = {}) {
  const mapped = {
    file_pengajuan_disposisi_pembimbing: null,
    file_pengajuan_disposisi_pembimbing_name: null,
    file_transkrip: null,
    file_transkrip_name: null,
    file_krs: null,
    file_krs_name: null,
    file_metodologi: null,
    file_metodologi_name: null,
  };

  const byType = {
    PENGAJUAN_DISPOSISI_PEMBIMBING: ["file_pengajuan_disposisi_pembimbing", "file_pengajuan_disposisi_pembimbing_name"],
    TRANSKRIP: ["file_transkrip", "file_transkrip_name"],
    KRS: ["file_krs", "file_krs_name"],
    METODOLOGI: ["file_metodologi", "file_metodologi_name"],
  };

  for (const row of fileRows) {
    const keyPair = byType[row.file_type];
    if (!keyPair) continue;
    const [fileKey, fileNameKey] = keyPair;
    mapped[fileKey] = row.file_content ?? mapped[fileKey];
    mapped[fileNameKey] = row.file_name ?? mapped[fileNameKey];
  }

  return mapped;
}


async function upsertFileByType(
  conn,
  pengajuanDisposisiPembimbingId,
  fileType,
  fileContent,
  fileName,
) {
  await conn.query(
    `DELETE FROM pengajuan_disposisi_pembimbing_file
     WHERE pengajuan_disposisi_pembimbing_id = ? AND file_type = ?`,
    [pengajuanDisposisiPembimbingId, fileType],
  );

  await conn.query(
    `INSERT INTO pengajuan_disposisi_pembimbing_file (
       pengajuan_disposisi_pembimbing_id, file_type, file_content, file_name
     ) VALUES (?, ?, ?, ?)`,
    [pengajuanDisposisiPembimbingId, fileType, fileContent, fileName],
  );
}

async function hydratePengajuanDisposisiPembimbingReadData(baseRow) {
  if (!baseRow?.id) return baseRow;

  const [fileRows] = await db.query(
    `SELECT file_type, file_content, file_name
     FROM pengajuan_disposisi_pembimbing_file
     WHERE pengajuan_disposisi_pembimbing_id = ?`,
    [baseRow.id],
  );

  const fileMapped = mapNewFileRowsToLegacyKeys(fileRows);

  return {
    ...baseRow,
    ...fileMapped,
  };
}

// Create Formulir Pengajuan Disposisi Pembimbing Skripsi
exports.createPengajuanDisposisiPembimbing = async (req, res, next) => {
  let conn;
  let txStarted = false;
  try {
    if (!req.user.hasRole("STUDENT")) {
      return res.status(403).json({ ok: false, message: "Only students" });
    }

    const npm = await getStudentNpm(req.user.id);
    if (!npm) {
      return res
        .status(400)
        .json({ ok: false, message: "Mahasiswa tidak valid" });
    }

    const outlineId = Number(req.body.outlineId);
    if (!Number.isFinite(outlineId) || outlineId <= 0) {
      return res.status(400).json({ ok: false, message: "outlineId invalid" });
    }

    // Pastikan outline milik mahasiswa dan sudah ACCEPTED (sesuai workflow kamu)
    const [orows] = await db.query(
      `SELECT id
       FROM outline
       WHERE id = ? AND npm = ? AND status = 'ACCEPTED'
       LIMIT 1`,
      [outlineId, npm],
    );
    if (orows.length === 0) {
      return res.status(400).json({
        ok: false,
        message: "Outline not found or not ACCEPTED",
      });
    }

    const programStudiId = req.user?.programStudiId ?? null;
    if (!programStudiId) {
      return res
        .status(400)
        .json({ ok: false, message: "Program studi tidak valid" });
    }

    // Cegah duplikasi pengajuan untuk outline yang sama
    const [existing] = await db.query(
      `SELECT id, status
       FROM pengajuan_disposisi_pembimbing
       WHERE outline_id = ? AND npm = ?
       LIMIT 1`,
      [outlineId, npm],
    );
    if (existing.length > 0) {
      return res.status(409).json({
        ok: false,
        message: "Pengajuan disposisi pembimbing already exists for this outline",
        data: existing[0],
      });
    }

    const {
      noHp,
      pembimbing1DiajukanNidn,
      pembimbing2DiajukanNidn,
      perluSuratPengantar,
      namaPerusahaan,
      syaratTranskrip,
      syaratKrs,
      syaratMetodologi,
      fileTranskrip,
      fileTranskripName,
      fileKrs,
      fileKrsName,
      fileMetodologi,
      fileMetodologiName,
    } = req.body || {};

    const noHpVal = noHp != null ? String(noHp).trim() : "";
    if (!noHpVal || !/^08[0-9]{7,13}$/.test(noHpVal)) {
      return res.status(400).json({
        ok: false,
        message: "No. HP tidak valid (harus diawali 08, 9-15 digit angka)",
      });
    }

    const pembimbing1Val =
      pembimbing1DiajukanNidn != null ? String(pembimbing1DiajukanNidn).trim() : "";
    const pembimbing2Val =
      pembimbing2DiajukanNidn != null ? String(pembimbing2DiajukanNidn).trim() : "";

    if (!pembimbing1Val || !pembimbing2Val) {
      return res.status(400).json({
        ok: false,
        message: "Dosen pembimbing 1 dan 2 wajib diisi",
      });
    }

    if (pembimbing1Val === pembimbing2Val) {
      return res.status(400).json({
        ok: false,
        message: "Pembimbing 1 and Pembimbing 2 cannot be the same",
      });
    }

    const [dosenRows] = await db.query(
      `SELECT nidn FROM dosen WHERE nidn IN (?, ?)`,
      [pembimbing1Val, pembimbing2Val],
    );
    const foundNidns = new Set(dosenRows.map((row) => row.nidn));
    if (!foundNidns.has(pembimbing1Val) || !foundNidns.has(pembimbing2Val)) {
      return res.status(400).json({
        ok: false,
        message: "Dosen pembimbing yang dipilih tidak valid",
      });
    }

    const namaPerusahaanVal =
      namaPerusahaan != null ? String(namaPerusahaan).trim() : "";
    if (perluSuratPengantar && !namaPerusahaanVal) {
      return res.status(400).json({
        ok: false,
        message: "namaPerusahaan is required when perluSuratPengantar is true",
      });
    }

    if (perluSuratPengantar && namaPerusahaanVal.length < 2) {
      return res.status(400).json({
        ok: false,
        message: "Nama perusahaan minimal 2 karakter",
      });
    }

    conn = await db.getConnection();
    await conn.beginTransaction();
    txStarted = true;

    const [result] = await conn.query(
      `INSERT INTO pengajuan_disposisi_pembimbing (
         outline_id, npm, program_studi_id,
         no_hp,
         pembimbing1_diajukan_nidn, pembimbing2_diajukan_nidn,
         perlu_surat_pengantar, nama_perusahaan,
         syarat_transkrip, syarat_krs, syarat_metodologi_nilai_min_c,
         status, submitted_at
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'SUBMITTED', CURRENT_TIMESTAMP)`,
      [
        outlineId,
        npm,
        programStudiId,
        noHpVal,
        pembimbing1Val,
        pembimbing2Val,
        perluSuratPengantar ? 1 : 0,
        namaPerusahaanVal || null,
        toBit(syaratTranskrip, 0),
        toBit(syaratKrs, 0),
        toBit(syaratMetodologi, 0),
      ],
    );

    const pengajuanDisposisiPembimbingId = result.insertId;

    const [docDataRows] = await conn.query(
      `SELECT
         m.nama AS nama_mahasiswa, m.sks,
         ps.nama AS program_studi_nama,
         o.judul AS judul_skripsi,
         d1.nama AS pembimbing1_nama,
         d2.nama AS pembimbing2_nama,
         u.signature_image
       FROM pengajuan_disposisi_pembimbing pj
       JOIN mahasiswa m ON m.npm = pj.npm
       JOIN program_studi ps ON ps.id = pj.program_studi_id
       JOIN outline o ON o.id = pj.outline_id
       LEFT JOIN dosen d1 ON d1.nidn = pj.pembimbing1_diajukan_nidn
       LEFT JOIN dosen d2 ON d2.nidn = pj.pembimbing2_diajukan_nidn
       LEFT JOIN users u ON u.npm = pj.npm AND u.is_active = 1
       WHERE pj.id = ?
       LIMIT 1`,
      [pengajuanDisposisiPembimbingId],
    );
    const docData = docDataRows[0] ?? {};

    assertSignatures([
      { role: "Mahasiswa", nama: docData.nama_mahasiswa, signatureImage: docData.signature_image },
    ]);

    const formulirBase64 = await generateFormulirDoc({
      npm,
      namaMahasiswa: docData.nama_mahasiswa,
      programStudiNama: docData.program_studi_nama,
      noHp: noHpVal,
      sks: docData.sks,
      judulSkripsi: docData.judul_skripsi,
      pembimbing1Nama: docData.pembimbing1_nama ?? pembimbing1Val,
      pembimbing2Nama: docData.pembimbing2_nama ?? pembimbing2Val,
      perluSuratPengantar: Boolean(perluSuratPengantar),
      namaPerusahaan: namaPerusahaanVal || null,
      studentSignature: docData.signature_image,
      submittedAt: new Date(),
    });
    await upsertFileByType(
      conn,
      pengajuanDisposisiPembimbingId,
      "PENGAJUAN_DISPOSISI_PEMBIMBING",
      formulirBase64,
      buildFormulirFileName(npm, docData.nama_mahasiswa),
    );

    if (fileTranskrip !== undefined && fileTranskrip !== null) {
      await upsertFileByType(
        conn,
        pengajuanDisposisiPembimbingId,
        "TRANSKRIP",
        String(fileTranskrip),
        fileTranskripName !== undefined && fileTranskripName !== null
          ? String(fileTranskripName).trim()
          : null,
      );
    }
    if (fileKrs !== undefined && fileKrs !== null) {
      await upsertFileByType(
        conn,
        pengajuanDisposisiPembimbingId,
        "KRS",
        String(fileKrs),
        fileKrsName !== undefined && fileKrsName !== null
          ? String(fileKrsName).trim()
          : null,
      );
    }
    if (fileMetodologi !== undefined && fileMetodologi !== null) {
      await upsertFileByType(
        conn,
        pengajuanDisposisiPembimbingId,
        "METODOLOGI",
        String(fileMetodologi),
        fileMetodologiName !== undefined && fileMetodologiName !== null
          ? String(fileMetodologiName).trim()
          : null,
      );
    }

    const [mahasiswaRows] = await conn.query(
      `SELECT m.nama FROM mahasiswa m WHERE m.npm = ? LIMIT 1`,
      [npm],
    );
    const namaMahasiswa = mahasiswaRows[0]?.nama ?? npm;

    const [kaprodiUserRows] = await conn.query(
      `SELECT u.id FROM users u
       JOIN user_roles ur ON ur.user_id = u.id
       JOIN roles r ON r.id = ur.role_id
       JOIN program_studi ps ON ps.kaprodi_nidn = u.nidn
       WHERE r.code = 'KAPRODI' AND ur.program_studi_id = ?
       LIMIT 1`,
      [programStudiId],
    );
    if (kaprodiUserRows[0]?.id) {
      await insertNotification(
        conn,
        kaprodiUserRows[0].id,
        "TITLE_SUBMITTED",
        `Mahasiswa ${namaMahasiswa} mengajukan judul skripsi`,
        "/kaprodi/pengajuan-outline/pengajuan-disposisi-pembimbing",
      );
    }

    await conn.commit();
    txStarted = false;

    return res.status(201).json({
      ok: true,
      message: "Created",
      data: { id: pengajuanDisposisiPembimbingId },
    });
  } catch (err) {
    try {
      if (conn && txStarted) {
        await conn.rollback();
      }
    } catch (_) {}
    next(err);
  } finally {
    if (conn) {
      conn.release();
    }
  }
};

exports.listMine = async (req, res, next) => {
  try {
    if (!req.user.hasRole("STUDENT")) {
      return res.status(403).json({ ok: false, message: "Only students" });
    }

    const npm = await getStudentNpm(req.user.id);
    if (!npm) {
      return res
        .status(400)
        .json({ ok: false, message: "Mahasiswa tidak valid" });
    }

    // Join outline untuk ambil judul (karena judul ada di outline)
    const [rows] = await db.query(
      `SELECT
         pj.id,
         pj.outline_id,
         pj.status,
         pj.submitted_at,
         pj.created_at,
         pj.updated_at,
         o.judul AS outline_judul
       FROM pengajuan_disposisi_pembimbing pj
       INNER JOIN outline o ON o.id = pj.outline_id
       WHERE pj.npm = ?
       ORDER BY pj.created_at DESC`,
      [npm],
    );

    return res.json({ ok: true, data: rows });
  } catch (err) {
    next(err);
  }
};

exports.getLatestMine = async (req, res, next) => {
  try {
    if (!req.user.hasRole("STUDENT")) {
      return res.status(403).json({
        ok: false,
        message: "Only students can access their latest pengajuan disposisi pembimbing",
      });
    }

    const npm = await getStudentNpm(req.user.id);
    if (!npm) {
      return res
        .status(400)
        .json({ ok: false, message: "Mahasiswa tidak valid" });
    }

    const [rows] = await db.query(
      `SELECT
         pj.*,
         o.judul AS outline_judul,
         m.nama AS mahasiswa_nama,
         m.sks AS sks_diperoleh,
         ps.id AS program_studi_id,
         ps.nama AS program_studi_nama,
         d1.nama AS pembimbing1_diajukan_nama,
         d2.nama AS pembimbing2_diajukan_nama,
         d3.nama AS pembimbing1_ditetapkan_nama,
         d4.nama AS pembimbing2_ditetapkan_nama
       FROM pengajuan_disposisi_pembimbing pj
       INNER JOIN outline o ON o.id = pj.outline_id
       INNER JOIN mahasiswa m ON m.npm = pj.npm
       INNER JOIN program_studi ps ON ps.id = m.program_studi_id
       LEFT JOIN dosen d1 ON d1.nidn = pj.pembimbing1_diajukan_nidn
       LEFT JOIN dosen d2 ON d2.nidn = pj.pembimbing2_diajukan_nidn
       LEFT JOIN dosen d3 ON d3.nidn = pj.pembimbing1_ditetapkan_nidn
       LEFT JOIN dosen d4 ON d4.nidn = pj.pembimbing2_ditetapkan_nidn
       WHERE pj.npm = ?
       ORDER BY pj.updated_at DESC, pj.id DESC
       LIMIT 1`,
      [npm],
    );

    if (!rows || rows.length === 0) {
      return res.json({
        ok: true,
        data: null,
        message: "Pengajuan disposisi pembimbing not found",
      });
    }

    const hydrated = await hydratePengajuanDisposisiPembimbingReadData(rows[0]);
    return res.json({ ok: true, data: hydrated });
  } catch (err) {
    next(err);
  }
};

exports.getById = async (req, res, next) => {
  try {
    const id = Number(req.params.id);
    if (!Number.isFinite(id) || id <= 0) {
      return res.status(400).json({ ok: false, message: "Invalid id" });
    }

    // STUDENT: hanya boleh lihat miliknya
    if (req.user.hasRole("STUDENT")) {
      const [urows] = await db.query(
        `SELECT npm FROM users WHERE id = ? AND is_active = 1 LIMIT 1`,
        [req.user.id],
      );
      const npm = urows[0]?.npm;
      if (!npm) {
        return res
          .status(400)
          .json({ ok: false, message: "Mahasiswa tidak valid" });
      }

      const [rows] = await db.query(
        `
        SELECT
          pj.id,
          pj.outline_id,
          pj.npm,
          pj.no_hp,
          pj.pembimbing1_diajukan_nidn,
          pj.pembimbing2_diajukan_nidn,
          pj.perlu_surat_pengantar,
          pj.nama_perusahaan,
          pj.status,
          pj.submitted_at,
          pj.pembimbing1_ditetapkan_nidn,
          pj.pembimbing2_ditetapkan_nidn,
          pj.catatan_kaprodi,
          pj.disposisi_at,
          pj.decided_by_user_id,
          pj.created_at,
          pj.updated_at,

          o.judul AS outline_judul,

          m.nama AS mahasiswa_nama,
          m.sks AS sks_diperoleh,
          ps.id AS program_studi_id,
          ps.nama AS program_studi_nama,
          dkap.nama AS kaprodi_nama,

          d1.nama AS pembimbing1_diajukan_nama,
          d2.nama AS pembimbing2_diajukan_nama,
          d3.nama AS pembimbing1_ditetapkan_nama,
          d4.nama AS pembimbing2_ditetapkan_nama

        FROM pengajuan_disposisi_pembimbing pj
        INNER JOIN outline o ON o.id = pj.outline_id
        INNER JOIN mahasiswa m ON m.npm = pj.npm
        INNER JOIN program_studi ps ON ps.id = m.program_studi_id
        LEFT JOIN dosen dkap ON dkap.nidn = ps.kaprodi_nidn

        LEFT JOIN dosen d1 ON d1.nidn = pj.pembimbing1_diajukan_nidn
        LEFT JOIN dosen d2 ON d2.nidn = pj.pembimbing2_diajukan_nidn
        LEFT JOIN dosen d3 ON d3.nidn = pj.pembimbing1_ditetapkan_nidn
        LEFT JOIN dosen d4 ON d4.nidn = pj.pembimbing2_ditetapkan_nidn

        WHERE pj.id = ? AND pj.npm = ?
        LIMIT 1
        `,
        [id, npm],
      );

      if (rows.length === 0) {
        return res.status(404).json({ ok: false, message: "Not found" });
      }

      const hydrated = await hydratePengajuanDisposisiPembimbingReadData(rows[0]);
      return res.json({ ok: true, data: hydrated });
    }

    // LECTURER (Kaprodi): hanya boleh pengajuan dari prodinya
    if (req.user.hasRole("LECTURER", "KAPRODI")) {
      const [urows] = await db.query(
        `SELECT nidn FROM users WHERE id = ? AND is_active = 1 LIMIT 1`,
        [req.user.id],
      );
      const nidn = urows[0]?.nidn;
      if (!nidn) {
        return res
          .status(400)
          .json({ ok: false, message: "Dosen tidak valid" });
      }

      const [rows] = await db.query(
        `
        SELECT
          pj.id,
          pj.outline_id,
          pj.npm,
          pj.no_hp,
          pj.pembimbing1_diajukan_nidn,
          pj.pembimbing2_diajukan_nidn,
          pj.perlu_surat_pengantar,
          pj.nama_perusahaan,
          pj.status,
          pj.submitted_at,
          pj.pembimbing1_ditetapkan_nidn,
          pj.pembimbing2_ditetapkan_nidn,
          pj.catatan_kaprodi,
          pj.disposisi_at,
          pj.decided_by_user_id,
          pj.created_at,
          pj.updated_at,

          o.judul AS outline_judul,

          m.nama AS mahasiswa_nama,
          m.sks AS sks_diperoleh,
          ps.id AS program_studi_id,
          ps.nama AS program_studi_nama,
          dkap.nama AS kaprodi_nama,

          d1.nama AS pembimbing1_diajukan_nama,
          d2.nama AS pembimbing2_diajukan_nama,
          d3.nama AS pembimbing1_ditetapkan_nama,
          d4.nama AS pembimbing2_ditetapkan_nama

        FROM pengajuan_disposisi_pembimbing pj
        INNER JOIN outline o ON o.id = pj.outline_id
        INNER JOIN mahasiswa m ON m.npm = pj.npm
        INNER JOIN program_studi ps ON ps.id = m.program_studi_id
        LEFT JOIN dosen dkap ON dkap.nidn = ps.kaprodi_nidn

        LEFT JOIN dosen d1 ON d1.nidn = pj.pembimbing1_diajukan_nidn
        LEFT JOIN dosen d2 ON d2.nidn = pj.pembimbing2_diajukan_nidn
        LEFT JOIN dosen d3 ON d3.nidn = pj.pembimbing1_ditetapkan_nidn
        LEFT JOIN dosen d4 ON d4.nidn = pj.pembimbing2_ditetapkan_nidn

        WHERE pj.id = ?
          AND ps.kaprodi_nidn = ?
        LIMIT 1
        `,
        [id, nidn],
      );

      if (rows.length === 0) {
        return res.status(404).json({ ok: false, message: "Not found" });
      }

      const hydrated = await hydratePengajuanDisposisiPembimbingReadData(rows[0]);
      return res.json({ ok: true, data: hydrated });
    }

    return res.status(403).json({ ok: false, message: "Forbidden" });
  } catch (err) {
    next(err);
  }
};

exports.resubmit = async (req, res, next) => {
  let conn;
  let txStarted = false;
  try {
    if (!req.user || !req.user.hasRole("STUDENT")) {
      return res.status(403).json({
        ok: false,
        message: "Only students can resubmit pengajuan disposisi pembimbing",
      });
    }

    const id = Number(req.params.id);
    if (!Number.isFinite(id) || id <= 0) {
      return res
        .status(400)
        .json({ ok: false, message: "Invalid pengajuan disposisi pembimbing id" });
    }

    const {
      noHp,
      pembimbing1DiajukanNidn,
      pembimbing2DiajukanNidn,
      perluSuratPengantar,
      namaPerusahaan,
      syaratTranskrip,
      syaratKrs,
      syaratMetodologi,
      fileTranskrip,
      fileTranskripName,
      fileKrs,
      fileKrsName,
      fileMetodologi,
      fileMetodologiName,
    } = req.body || {};

    const noHpVal =
      noHp !== undefined && noHp !== null ? String(noHp).trim() : null;
    if (noHpVal !== null && noHpVal.length > 0 && !/^08[0-9]{7,13}$/.test(noHpVal)) {
      return res.status(400).json({
        ok: false,
        message: "No. HP tidak valid (harus diawali 08, 9-15 digit angka)",
      });
    }
    const pembimbing1Val =
      pembimbing1DiajukanNidn !== undefined && pembimbing1DiajukanNidn !== null
        ? String(pembimbing1DiajukanNidn).trim()
        : null;
    const pembimbing2Val =
      pembimbing2DiajukanNidn !== undefined && pembimbing2DiajukanNidn !== null
        ? String(pembimbing2DiajukanNidn).trim()
        : null;
    const perluSuratProvided = perluSuratPengantar !== undefined;
    const namaPerusahaanVal =
      namaPerusahaan !== undefined && namaPerusahaan !== null
        ? String(namaPerusahaan).trim()
        : null;
    const fileTranskripVal =
      fileTranskrip !== undefined && fileTranskrip !== null
        ? String(fileTranskrip)
        : null;
    const fileTranskripNameVal =
      fileTranskripName !== undefined && fileTranskripName !== null
        ? String(fileTranskripName).trim()
        : null;
    const fileKrsVal =
      fileKrs !== undefined && fileKrs !== null ? String(fileKrs) : null;
    const fileKrsNameVal =
      fileKrsName !== undefined && fileKrsName !== null
        ? String(fileKrsName).trim()
        : null;
    const fileMetodologiVal =
      fileMetodologi !== undefined && fileMetodologi !== null
        ? String(fileMetodologi)
        : null;
    const fileMetodologiNameVal =
      fileMetodologiName !== undefined && fileMetodologiName !== null
        ? String(fileMetodologiName).trim()
        : null;

    const hasMeaningfulUpdate =
      (noHpVal !== null && noHpVal.length > 0) ||
      (pembimbing1Val !== null && pembimbing1Val.length > 0) ||
      (pembimbing2Val !== null && pembimbing2Val.length > 0) ||
      perluSuratProvided ||
      (namaPerusahaanVal !== null && namaPerusahaanVal.length > 0) ||
      syaratTranskrip !== undefined ||
      syaratKrs !== undefined ||
      syaratMetodologi !== undefined ||
      (fileTranskripVal !== null && fileTranskripVal.length > 0) ||
      (fileKrsVal !== null && fileKrsVal.length > 0) ||
      (fileMetodologiVal !== null && fileMetodologiVal.length > 0);

    if (!hasMeaningfulUpdate) {
      return res.status(400).json({
        ok: false,
        message: "At least one meaningful field must be provided",
      });
    }

    if (
      pembimbing1Val &&
      pembimbing2Val &&
      pembimbing1Val.length > 0 &&
      pembimbing1Val === pembimbing2Val
    ) {
      return res.status(400).json({
        ok: false,
        message: "Pembimbing 1 and Pembimbing 2 cannot be the same",
      });
    }

    if (
      perluSuratProvided &&
      Boolean(perluSuratPengantar) &&
      (!namaPerusahaanVal || namaPerusahaanVal.length === 0)
    ) {
      return res.status(400).json({
        ok: false,
        message: "namaPerusahaan is required when perluSuratPengantar is true",
      });
    }

    if (
      perluSuratProvided &&
      Boolean(perluSuratPengantar) &&
      namaPerusahaanVal &&
      namaPerusahaanVal.length < 2
    ) {
      return res.status(400).json({
        ok: false,
        message: "Nama perusahaan minimal 2 karakter",
      });
    }

    const nidnsToCheck = [pembimbing1Val, pembimbing2Val].filter(
      (val) => val && val.length > 0,
    );
    if (nidnsToCheck.length > 0) {
      const [dosenRows] = await db.query(
        `SELECT nidn FROM dosen WHERE nidn IN (${nidnsToCheck.map(() => "?").join(",")})`,
        nidnsToCheck,
      );
      const foundNidns = new Set(dosenRows.map((row) => row.nidn));
      if (nidnsToCheck.some((val) => !foundNidns.has(val))) {
        return res.status(400).json({
          ok: false,
          message: "Dosen pembimbing yang dipilih tidak valid",
        });
      }
    }

    const npm = await getStudentNpm(req.user.id);
    if (!npm) {
      return res
        .status(400)
        .json({ ok: false, message: "Mahasiswa tidak valid" });
    }

    conn = await db.getConnection();
    await conn.beginTransaction();
    txStarted = true;

    const [rows] = await conn.query(
      `SELECT id, status, syarat_transkrip, syarat_krs, syarat_metodologi_nilai_min_c
       FROM pengajuan_disposisi_pembimbing
       WHERE id = ? AND npm = ?
       LIMIT 1
       FOR UPDATE`,
      [id, npm],
    );

    if (rows.length === 0) {
      await conn.rollback();
      txStarted = false;
      return res.status(404).json({
        ok: false,
        message: "Pengajuan disposisi pembimbing not found",
      });
    }

    const currentStatus = String(rows[0].status || "").toUpperCase();
    if (!["REJECTED", "NEED_REVISION"].includes(currentStatus)) {
      await conn.rollback();
      txStarted = false;
      return res.status(409).json({
        ok: false,
        message: "Pengajuan disposisi pembimbing status is not eligible for resubmit",
      });
    }

    const sets = [];
    const params = [];

    if (noHpVal !== null && noHpVal.length > 0) {
      sets.push("no_hp = ?");
      params.push(noHpVal);
    }
    if (pembimbing1Val !== null && pembimbing1Val.length > 0) {
      sets.push("pembimbing1_diajukan_nidn = ?");
      params.push(pembimbing1Val);
    }
    if (pembimbing2Val !== null && pembimbing2Val.length > 0) {
      sets.push("pembimbing2_diajukan_nidn = ?");
      params.push(pembimbing2Val);
    }
    if (perluSuratProvided) {
      sets.push("perlu_surat_pengantar = ?");
      params.push(Boolean(perluSuratPengantar) ? 1 : 0);
      if (!Boolean(perluSuratPengantar)) {
        sets.push("nama_perusahaan = NULL");
      }
    }
    if (
      namaPerusahaanVal !== null &&
      namaPerusahaanVal.length > 0 &&
      (!perluSuratProvided || Boolean(perluSuratPengantar))
    ) {
      sets.push("nama_perusahaan = ?");
      params.push(namaPerusahaanVal);
    }
    const currentRow = rows[0];
    sets.push("syarat_transkrip = ?");
    params.push(toBit(syaratTranskrip, currentRow.syarat_transkrip ?? 0));
    sets.push("syarat_krs = ?");
    params.push(toBit(syaratKrs, currentRow.syarat_krs ?? 0));
    sets.push("syarat_metodologi_nilai_min_c = ?");
    params.push(toBit(syaratMetodologi, currentRow.syarat_metodologi_nilai_min_c ?? 0));
    sets.push("status = 'SUBMITTED'");
    sets.push("submitted_at = CURRENT_TIMESTAMP");
    sets.push("disposisi_at = NULL");
    sets.push("catatan_kaprodi = NULL");
    sets.push("decided_by_user_id = NULL");
    sets.push("pembimbing1_ditetapkan_nidn = NULL");
    sets.push("pembimbing2_ditetapkan_nidn = NULL");
    sets.push("updated_at = CURRENT_TIMESTAMP");

    const sql = `UPDATE pengajuan_disposisi_pembimbing SET ${sets.join(", ")} WHERE id = ?`;
    params.push(id);
    await conn.query(sql, params);

    const [resubDocDataRows] = await conn.query(
      `SELECT
         m.nama AS nama_mahasiswa, m.sks,
         ps.nama AS program_studi_nama,
         o.judul AS judul_skripsi,
         pj.no_hp, pj.perlu_surat_pengantar, pj.nama_perusahaan,
         pj.pembimbing1_diajukan_nidn, pj.pembimbing2_diajukan_nidn,
         d1.nama AS pembimbing1_nama,
         d2.nama AS pembimbing2_nama,
         u.signature_image
       FROM pengajuan_disposisi_pembimbing pj
       JOIN mahasiswa m ON m.npm = pj.npm
       JOIN program_studi ps ON ps.id = pj.program_studi_id
       JOIN outline o ON o.id = pj.outline_id
       LEFT JOIN dosen d1 ON d1.nidn = pj.pembimbing1_diajukan_nidn
       LEFT JOIN dosen d2 ON d2.nidn = pj.pembimbing2_diajukan_nidn
       LEFT JOIN users u ON u.npm = pj.npm AND u.is_active = 1
       WHERE pj.id = ?
       LIMIT 1`,
      [id],
    );
    const resubDocData = resubDocDataRows[0] ?? {};

    assertSignatures([
      { role: "Mahasiswa", nama: resubDocData.nama_mahasiswa, signatureImage: resubDocData.signature_image },
    ]);

    const resubFormulirBase64 = await generateFormulirDoc({
      npm,
      namaMahasiswa: resubDocData.nama_mahasiswa,
      programStudiNama: resubDocData.program_studi_nama,
      noHp: resubDocData.no_hp,
      sks: resubDocData.sks,
      judulSkripsi: resubDocData.judul_skripsi,
      pembimbing1Nama: resubDocData.pembimbing1_nama ?? resubDocData.pembimbing1_diajukan_nidn ?? "",
      pembimbing2Nama: resubDocData.pembimbing2_nama ?? resubDocData.pembimbing2_diajukan_nidn ?? "",
      perluSuratPengantar: Boolean(resubDocData.perlu_surat_pengantar),
      namaPerusahaan: resubDocData.nama_perusahaan ?? null,
      studentSignature: resubDocData.signature_image,
      submittedAt: new Date(),
    });
    await upsertFileByType(
      conn,
      id,
      "PENGAJUAN_DISPOSISI_PEMBIMBING",
      resubFormulirBase64,
      buildFormulirFileName(npm, resubDocData.nama_mahasiswa),
    );

    if (fileTranskripVal !== null && fileTranskripVal.length > 0) {
      await upsertFileByType(
        conn,
        id,
        "TRANSKRIP",
        fileTranskripVal,
        fileTranskripNameVal !== null && fileTranskripNameVal.length > 0
          ? fileTranskripNameVal
          : null,
      );
    }
    if (fileKrsVal !== null && fileKrsVal.length > 0) {
      await upsertFileByType(
        conn,
        id,
        "KRS",
        fileKrsVal,
        fileKrsNameVal !== null && fileKrsNameVal.length > 0
          ? fileKrsNameVal
          : null,
      );
    }
    if (fileMetodologiVal !== null && fileMetodologiVal.length > 0) {
      await upsertFileByType(
        conn,
        id,
        "METODOLOGI",
        fileMetodologiVal,
        fileMetodologiNameVal !== null && fileMetodologiNameVal.length > 0
          ? fileMetodologiNameVal
          : null,
      );
    }

    const [resubMahasiswaRows] = await conn.query(
      `SELECT m.nama, m.program_studi_id FROM mahasiswa m WHERE m.npm = ? LIMIT 1`,
      [npm],
    );
    const resubNama = resubMahasiswaRows[0]?.nama ?? npm;
    const resubProgramStudiId = resubMahasiswaRows[0]?.program_studi_id ?? null;
    if (resubProgramStudiId) {
      const [resubKaprodiRows] = await conn.query(
        `SELECT u.id FROM users u
         JOIN user_roles ur ON ur.user_id = u.id
         JOIN roles r ON r.id = ur.role_id
         JOIN program_studi ps ON ps.kaprodi_nidn = u.nidn
         WHERE r.code = 'KAPRODI' AND ur.program_studi_id = ?
         LIMIT 1`,
        [resubProgramStudiId],
      );
      if (resubKaprodiRows[0]?.id) {
        await insertNotification(
          conn,
          resubKaprodiRows[0].id,
          "TITLE_RESUBMITTED",
          `Mahasiswa ${resubNama} mengajukan ulang judul skripsi`,
          "/kaprodi/pengajuan-outline/pengajuan-disposisi-pembimbing",
        );
      }
    }

    await conn.commit();
    txStarted = false;

    return res.json({
      ok: true,
      message: "Pengajuan disposisi pembimbing resubmitted",
    });
  } catch (err) {
    try {
      if (conn && txStarted) {
        await conn.rollback();
      }
    } catch (_) {}
    next(err);
  } finally {
    if (conn) {
      conn.release();
    }
  }
};
