const db = require("../db");
const { insertNotification } = require("../utils/notify");
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
  const dataUrlMatch = raw.match(/^data:image\/([a-zA-Z0-9.+-]+);base64,(.+)$/i);
  if (dataUrlMatch) {
    try {
      const mimeType = dataUrlMatch[1].toLowerCase();
      const type = mimeType === "jpeg" ? "jpg" : mimeType;
      return { buffer: Buffer.from(dataUrlMatch[2], "base64"), type };
    } catch (_) {
      return null;
    }
  }
  const normalized = raw.replace(/\s+/g, "");
  const looksLikeBase64 =
    /^[A-Za-z0-9+/=]+$/.test(normalized) && normalized.length % 4 === 0;
  if (looksLikeBase64) {
    try {
      const buffer = Buffer.from(normalized, "base64");
      const type = buffer[0] === 0x89 && buffer[1] === 0x50 ? "png" : "jpg";
      return { buffer, type };
    } catch (_) {
      return null;
    }
  }
  return null;
}

function signatureImagePatch(signatureValue) {
  const decoded = decodeSignatureToBuffer(signatureValue);
  if (!decoded || decoded.buffer.length === 0) return textPatch("");
  try {
    return {
      type: PatchType.PARAGRAPH,
      children: [
        new ImageRun({
          type: decoded.type,
          data: decoded.buffer,
          transformation: { width: 120, height: 50 },
        }),
      ],
    };
  } catch (_) {
    return textPatch("");
  }
}

const BULAN_ID = [
  "Januari", "Februari", "Maret", "April", "Mei", "Juni",
  "Juli", "Agustus", "September", "Oktober", "November", "Desember",
];

const BULAN_ROMAWI = ["I","II","III","IV","V","VI","VII","VIII","IX","X","XI","XII"];

function formatTanggalIndonesia(date) {
  return `${date.getDate()} ${BULAN_ID[date.getMonth()]} ${date.getFullYear()}`;
}

async function buildSkDocxBuffer({ nomorSurat, prodi, namaMahasiswa, npm, dospem1Nama, dospem2Nama, judulSkripsi, tanggal, dekanSignature, namaDekan }) {
  const templatePath = path.join(__dirname, "../templates/template_SK_skripsi.docx");
  const templateBuffer = await readFile(templatePath);
  const patches = {
    nomor_surat: textPatch(nomorSurat),
    prodi: textPatch(prodi),
    nama_mahasiswa: textPatch(namaMahasiswa),
    npm: textPatch(npm),
    dospem1_nama: textPatch(dospem1Nama),
    dospem2_nama: textPatch(dospem2Nama),
    judul_skripsi: textPatch(judulSkripsi),
    tanggal: textPatch(tanggal),
    dekan_signature: signatureImagePatch(dekanSignature),
    nama_dekan: textPatch(namaDekan),
  };
  const outputBuffer = await patchDocument({ outputType: "nodebuffer", data: templateBuffer, patches });
  return outputBuffer;
}

async function buildSuratKeteranganDocxBuffer({ namaMahasiswa, npm, programStudi, lokasi, judul }) {
  const templatePath = path.join(__dirname, "../templates/template_surat_keterangan.docx");
  const templateBuffer = await readFile(templatePath);
  const patches = {
    nama_mahasiswa: textPatch(namaMahasiswa),
    npm: textPatch(npm),
    program_studi: textPatch(programStudi),
    lokasi: textPatch(lokasi),
    judul: textPatch(judul),
  };
  const outputBuffer = await patchDocument({ outputType: "nodebuffer", data: templateBuffer, patches });
  return outputBuffer;
}

async function generateSkDocuments(conn, sk, pengajuanJudulId) {
  // Fetch kartu konsultasi outline (has mahasiswa info + dospem names + program studi)
  const [[kartu]] = await conn.query(
    `SELECT k.nama_mahasiswa, k.npm, k.judul_skripsi,
            k.pembimbing1_nama, k.pembimbing2_nama, k.program_studi_id, k.program_studi_nama
     FROM kartu_konsultasi_outline k
     WHERE k.pengajuan_judul_id = ?
     LIMIT 1`,
    [pengajuanJudulId],
  );
  if (!kartu) throw Object.assign(new Error("Kartu konsultasi outline tidak ditemukan"), { status: 400 });

  // Fetch pengajuan judul for perlu_surat_pengantar + nama_perusahaan
  const [[pj]] = await conn.query(
    `SELECT perlu_surat_pengantar, nama_perusahaan FROM pengajuan_judul WHERE id = ? LIMIT 1`,
    [pengajuanJudulId],
  );
  if (!pj) throw Object.assign(new Error("Pengajuan judul tidak ditemukan"), { status: 400 });

  // Fetch program studi + fakultas
  const [[ps]] = await conn.query(
    `SELECT ps.kode AS ps_kode, ps.nama AS ps_nama, f.kode AS f_kode, f.dekan_nidn
     FROM program_studi ps
     LEFT JOIN fakultas f ON f.id = ps.fakultas_id
     WHERE ps.id = ?
     LIMIT 1`,
    [kartu.program_studi_id],
  );
  if (!ps) throw Object.assign(new Error("Program studi tidak ditemukan"), { status: 400 });
  if (!ps.f_kode || !ps.dekan_nidn) {
    throw Object.assign(new Error("Dekan belum dikonfigurasi untuk fakultas ini"), { status: 400 });
  }

  // Fetch dekan user + dosen name + signature
  const [[dekan]] = await conn.query(
    `SELECT u.signature_image, d.nama AS nama_dekan
     FROM users u
     JOIN user_roles ur ON ur.user_id = u.id
     JOIN roles r ON r.id = ur.role_id
     JOIN dosen d ON d.nidn = u.nidn
     WHERE r.code = 'DEKAN' AND u.nidn = ?
     LIMIT 1`,
    [ps.dekan_nidn],
  );
  if (!dekan) throw Object.assign(new Error("Dekan belum dikonfigurasi"), { status: 400 });

  // Generate nomor_surat sequence (count SKs completed this month for same prodi)
  const now = new Date();
  const year = now.getFullYear();
  const month = now.getMonth() + 1; // 1-based
  const [[{ seq }]] = await conn.query(
    `SELECT COUNT(*) AS seq
     FROM pengajuan_sk_penelitian psk
     JOIN kartu_konsultasi_outline k ON k.pengajuan_judul_id = psk.pengajuan_judul_id
     WHERE k.program_studi_id = ?
       AND psk.nomor_surat IS NOT NULL
       AND YEAR(psk.completed_at) = ?
       AND MONTH(psk.completed_at) = ?`,
    [kartu.program_studi_id, year, month],
  );
  const seqNum = Number(seq) + 1;
  const nomorSurat = `${String(seqNum).padStart(3, "0")}/${ps.f_kode}/${ps.ps_kode}/Skep-Skripsi/${BULAN_ROMAWI[month - 1]}/${year}`;

  // Update nomor_surat on the SK record
  await conn.query(
    `UPDATE pengajuan_sk_penelitian SET nomor_surat = ? WHERE id = ?`,
    [nomorSurat, sk.id],
  );

  const tanggal = formatTanggalIndonesia(now);

  // Generate SK_PENELITIAN DOCX
  const skBuffer = await buildSkDocxBuffer({
    nomorSurat,
    prodi: kartu.program_studi_nama,
    namaMahasiswa: kartu.nama_mahasiswa,
    npm: kartu.npm,
    dospem1Nama: kartu.pembimbing1_nama,
    dospem2Nama: kartu.pembimbing2_nama,
    judulSkripsi: kartu.judul_skripsi,
    tanggal,
    dekanSignature: dekan.signature_image,
    namaDekan: dekan.nama_dekan,
  });
  const skBase64 = skBuffer.toString("base64");
  const mimeDocx = "application/vnd.openxmlformats-officedocument.wordprocessingml.document";

  await conn.query(
    `DELETE FROM pengajuan_sk_penelitian_files WHERE pengajuan_sk_penelitian_id = ? AND file_type = 'SK_PENELITIAN'`,
    [sk.id],
  );
  await conn.query(
    `INSERT INTO pengajuan_sk_penelitian_files
       (pengajuan_sk_penelitian_id, file_type, file_name, mime_type, file_content, source, status)
     VALUES (?, 'SK_PENELITIAN', ?, ?, ?, 'GENERATED', 'VERIFIED')`,
    [sk.id, `SK_Skripsi_${kartu.npm}.docx`, mimeDocx, skBase64],
  );

  // Generate SURAT_KETERANGAN if needed
  if (pj.perlu_surat_pengantar) {
    const suratBuffer = await buildSuratKeteranganDocxBuffer({
      namaMahasiswa: kartu.nama_mahasiswa,
      npm: kartu.npm,
      programStudi: kartu.program_studi_nama,
      lokasi: pj.nama_perusahaan ?? "",
      judul: kartu.judul_skripsi,
    });
    const suratBase64 = suratBuffer.toString("base64");
    await conn.query(
      `DELETE FROM pengajuan_sk_penelitian_files WHERE pengajuan_sk_penelitian_id = ? AND file_type = 'SURAT_KETERANGAN'`,
      [sk.id],
    );
    await conn.query(
      `INSERT INTO pengajuan_sk_penelitian_files
         (pengajuan_sk_penelitian_id, file_type, file_name, mime_type, file_content, source, status)
       VALUES (?, 'SURAT_KETERANGAN', ?, ?, ?, 'GENERATED', 'VERIFIED')`,
      [sk.id, `Surat_Keterangan_${kartu.npm}.docx`, mimeDocx, suratBase64],
    );
  }
}

const VALID_FILE_TYPES = [
  "KRS",
  "REKAP_NILAI",
  "KARTU_KONSULTASI_OUTLINE",
  "FILE_OUTLINE",
  "HALAMAN_PERSETUJUAN",
  "SK_PENELITIAN",
  "SURAT_KETERANGAN",
];

const VALID_SK_STATUSES = [
  "DRAFT",
  "SUBMITTED",
  "VERIFIED",
  "REJECTED",
  "COMPLETED",
];

async function upsertSkFile(
  conn,
  skPenelitianId,
  fileType,
  fileName,
  mimeType,
  fileContent,
  source,
) {
  await conn.query(
    `DELETE FROM pengajuan_sk_penelitian_files WHERE pengajuan_sk_penelitian_id = ? AND file_type = ?`,
    [skPenelitianId, fileType],
  );
  await conn.query(
    `INSERT INTO pengajuan_sk_penelitian_files
       (pengajuan_sk_penelitian_id, file_type, file_name, mime_type, file_content, source)
     VALUES (?, ?, ?, ?, ?, ?)`,
    [skPenelitianId, fileType, fileName, mimeType ?? null, fileContent, source],
  );
}

exports.initSkPenelitian = async (req, res, next) => {
  try {
    if (req.user.userType !== "STUDENT") {
      return res
        .status(403)
        .json({
          ok: false,
          message: "Only students can initialize SK Penelitian",
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
      `SELECT id FROM pengajuan_judul WHERE id = ? LIMIT 1`,
      [pengajuanJudulId],
    );
    if (pjRows.length === 0) {
      return res
        .status(404)
        .json({ ok: false, message: "Pengajuan judul tidak ditemukan" });
    }

    const [halamanRows] = await db.query(
      `SELECT id FROM halaman_persetujuan_judul WHERE pengajuan_judul_id = ? AND status = 'COMPLETED' LIMIT 1`,
      [pengajuanJudulId],
    );
    if (halamanRows.length === 0) {
      return res
        .status(400)
        .json({
          ok: false,
          message: "Halaman persetujuan judul belum selesai",
        });
    }

    const [existingRows] = await db.query(
      `SELECT id FROM pengajuan_sk_penelitian WHERE pengajuan_judul_id = ? LIMIT 1`,
      [pengajuanJudulId],
    );
    if (existingRows.length > 0) {
      return res
        .status(409)
        .json({ ok: false, message: "SK Penelitian sudah dibuat" });
    }

    const [ins] = await db.query(
      `INSERT INTO pengajuan_sk_penelitian (pengajuan_judul_id, status) VALUES (?, 'DRAFT')`,
      [pengajuanJudulId],
    );

    return res.status(201).json({
      ok: true,
      message: "SK Penelitian dibuat",
      data: { id: ins.insertId },
    });
  } catch (err) {
    next(err);
  }
};

exports.getSkPenelitian = async (req, res, next) => {
  try {
    const pengajuanJudulId = Number(req.params.pengajuanJudulId);
    if (!Number.isFinite(pengajuanJudulId) || pengajuanJudulId <= 0) {
      return res
        .status(400)
        .json({ ok: false, message: "Invalid pengajuanJudulId" });
    }

    const [skRows] = await db.query(
      `SELECT
         sk.*,
         k.nama_mahasiswa,
         k.judul_skripsi,
         k.program_studi_nama
       FROM pengajuan_sk_penelitian sk
       LEFT JOIN kartu_konsultasi_outline k ON k.pengajuan_judul_id = sk.pengajuan_judul_id
       WHERE sk.pengajuan_judul_id = ?
       LIMIT 1`,
      [pengajuanJudulId],
    );
    const sk = skRows[0] ?? null;
    if (!sk) {
      return res
        .status(404)
        .json({ ok: false, message: "SK Penelitian tidak ditemukan" });
    }

    const [files] = await db.query(
      `SELECT id, file_type, file_name, mime_type, source, status, created_at
       FROM pengajuan_sk_penelitian_files
       WHERE pengajuan_sk_penelitian_id = ?
       ORDER BY file_type ASC`,
      [sk.id],
    );

    return res.json({ ok: true, data: { sk, files } });
  } catch (err) {
    next(err);
  }
};

exports.submitSkPenelitian = async (req, res, next) => {
  const conn = await db.getConnection();
  let txStarted = false;
  try {
    if (req.user.userType !== "STUDENT") {
      return res
        .status(403)
        .json({ ok: false, message: "Only students can submit SK Penelitian" });
    }

    const pengajuanJudulId = Number(req.params.pengajuanJudulId);
    if (!Number.isFinite(pengajuanJudulId) || pengajuanJudulId <= 0) {
      return res
        .status(400)
        .json({ ok: false, message: "Invalid pengajuanJudulId" });
    }

    await conn.beginTransaction();
    txStarted = true;

    const [skRows] = await conn.query(
      `SELECT * FROM pengajuan_sk_penelitian WHERE pengajuan_judul_id = ? LIMIT 1 FOR UPDATE`,
      [pengajuanJudulId],
    );
    const sk = skRows[0] ?? null;
    if (!sk) {
      await conn.rollback();
      txStarted = false;
      return res
        .status(404)
        .json({ ok: false, message: "SK Penelitian tidak ditemukan" });
    }
    if (sk.status !== "DRAFT" && sk.status !== "NEED_REVISION") {
      await conn.rollback();
      txStarted = false;
      return res
        .status(409)
        .json({
          ok: false,
          message: "SK Penelitian hanya bisa disubmit saat status DRAFT atau NEED_REVISION",
        });
    }

    // System-pull KRS
    const [krsRows] = await conn.query(
      `SELECT file_content, file_name FROM pengajuan_judul_file WHERE pengajuan_judul_id = ? AND file_type = 'KRS' LIMIT 1`,
      [pengajuanJudulId],
    );
    if (krsRows.length === 0) {
      await conn.rollback();
      txStarted = false;
      return res
        .status(400)
        .json({
          ok: false,
          message: "File KRS tidak ditemukan pada pengajuan judul",
        });
    }
    const krsRow = krsRows[0];

    // Resolve kartu_id
    const [kartuRows] = await conn.query(
      `SELECT id FROM kartu_konsultasi_outline WHERE pengajuan_judul_id = ? LIMIT 1`,
      [pengajuanJudulId],
    );
    if (kartuRows.length === 0) {
      await conn.rollback();
      txStarted = false;
      return res
        .status(400)
        .json({
          ok: false,
          message: "Kartu konsultasi outline tidak ditemukan",
        });
    }
    const kartuId = kartuRows[0].id;

    // System-pull Kartu Konsultasi Outline DOCX
    const [kartuFileRows] = await conn.query(
      `SELECT file_content, file_name, mime_type
       FROM kartu_konsultasi_outline_file
       WHERE kartu_konsultasi_outline_id = ? AND file_type = 'FINAL_DOCX' AND is_active = 1
       ORDER BY generated_at DESC
       LIMIT 1`,
      [kartuId],
    );
    if (kartuFileRows.length === 0) {
      await conn.rollback();
      txStarted = false;
      return res
        .status(400)
        .json({
          ok: false,
          message: "File kartu konsultasi outline belum digenerate",
        });
    }
    const kartuFile = kartuFileRows[0];

    // System-pull File Outline Skripsi (latest submission)
    const [outlineRows] = await conn.query(
      `SELECT s.file_outline, s.file_outline_name
       FROM konsultasi_outline_submission s
       INNER JOIN konsultasi_outline_stage st ON st.id = s.konsultasi_outline_stage_id
       WHERE st.kartu_konsultasi_outline_id = ?
       ORDER BY s.submitted_at DESC
       LIMIT 1`,
      [kartuId],
    );
    if (outlineRows.length === 0) {
      await conn.rollback();
      txStarted = false;
      return res
        .status(400)
        .json({ ok: false, message: "File outline skripsi tidak ditemukan" });
    }
    const outlineRow = outlineRows[0];

    // System-pull Halaman Persetujuan file
    const [halamanFileRows] = await conn.query(
      `SELECT f.file_content, f.file_name, f.mime_type
       FROM halaman_persetujuan_judul_file f
       INNER JOIN halaman_persetujuan_judul h ON h.id = f.halaman_persetujuan_judul_id
       WHERE h.pengajuan_judul_id = ?
       ORDER BY f.generated_at DESC
       LIMIT 1`,
      [pengajuanJudulId],
    );
    if (halamanFileRows.length === 0) {
      await conn.rollback();
      txStarted = false;
      return res
        .status(400)
        .json({
          ok: false,
          message: "File halaman persetujuan tidak ditemukan",
        });
    }
    const halamanFile = halamanFileRows[0];

    // System-pull Rekap Nilai (Transkrip)
    const [rekapRows] = await conn.query(
      `SELECT file_content, file_name FROM pengajuan_judul_file WHERE pengajuan_judul_id = ? AND file_type = 'TRANSKRIP' LIMIT 1`,
      [pengajuanJudulId],
    );
    if (rekapRows.length === 0) {
      await conn.rollback();
      txStarted = false;
      return res
        .status(400)
        .json({ ok: false, message: "File transkrip/rekap nilai tidak ditemukan pada pengajuan judul" });
    }
    const rekapRow = rekapRows[0];

    // Upsert all 5 files
    await upsertSkFile(
      conn,
      sk.id,
      "REKAP_NILAI",
      rekapRow.file_name,
      "application/octet-stream",
      rekapRow.file_content,
      "SYSTEM",
    );
    await upsertSkFile(
      conn,
      sk.id,
      "KRS",
      krsRow.file_name,
      "application/octet-stream",
      krsRow.file_content,
      "SYSTEM",
    );
    await upsertSkFile(
      conn,
      sk.id,
      "KARTU_KONSULTASI_OUTLINE",
      kartuFile.file_name,
      kartuFile.mime_type ?? "application/octet-stream",
      kartuFile.file_content,
      "SYSTEM",
    );
    await upsertSkFile(
      conn,
      sk.id,
      "FILE_OUTLINE",
      outlineRow.file_outline_name,
      "application/octet-stream",
      outlineRow.file_outline,
      "SYSTEM",
    );
    await upsertSkFile(
      conn,
      sk.id,
      "HALAMAN_PERSETUJUAN",
      halamanFile.file_name,
      halamanFile.mime_type ?? "application/octet-stream",
      halamanFile.file_content,
      "SYSTEM",
    );

    await conn.query(
      `UPDATE pengajuan_sk_penelitian
       SET status = 'SUBMITTED', submitted_at = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP
       WHERE id = ?`,
      [sk.id],
    );

    const [[studentRow]] = await conn.query(
      `SELECT u.npm, m.nama FROM users u LEFT JOIN mahasiswa m ON m.npm = u.npm WHERE u.id = ? LIMIT 1`,
      [req.user.id],
    );
    const namaMahasiswa = studentRow?.nama ?? studentRow?.npm ?? "";
    const [sekRows] = await conn.query(
      `SELECT u.id FROM users u JOIN user_roles ur ON ur.user_id = u.id JOIN roles r ON r.id = ur.role_id WHERE r.code = 'SEKRETARIAT'`,
    );
    for (const sek of sekRows) {
      await insertNotification(
        conn,
        sek.id,
        "SK_SUBMITTED",
        `Mahasiswa ${namaMahasiswa} mengajukan SK Penelitian`,
        "/sekretariat/sk-penelitian",
      );
    }

    await conn.commit();
    txStarted = false;

    return res.json({ ok: true, message: "SK Penelitian berhasil disubmit" });
  } catch (err) {
    try {
      if (txStarted) await conn.rollback();
    } catch (_) {}
    next(err);
  } finally {
    conn.release();
  }
};

const REQUIRED_FILE_TYPES = [
  "KRS",
  "REKAP_NILAI",
  "KARTU_KONSULTASI_OUTLINE",
  "FILE_OUTLINE",
  "HALAMAN_PERSETUJUAN",
];
const VALID_FILE_STATUSES = ["SUBMITTED", "NEED_REUPLOAD", "VERIFIED"];

exports.reviewSkPenelitian = async (req, res, next) => {
  const conn = await db.getConnection();
  let txStarted = false;
  try {
    if (!req.user.hasRole("SEKRETARIAT")) {
      return res
        .status(403)
        .json({ ok: false, message: "Only sekretariat can review SK Penelitian" });
    }

    const pengajuanJudulId = Number(req.params.pengajuanJudulId);
    if (!Number.isFinite(pengajuanJudulId) || pengajuanJudulId <= 0) {
      return res
        .status(400)
        .json({ ok: false, message: "Invalid pengajuanJudulId" });
    }

    const { action, catatanSekretariat, files } = req.body ?? {};

    if (action !== "VERIFY" && action !== "REJECT" && action !== "NEED_REVISION") {
      return res
        .status(400)
        .json({ ok: false, message: "action harus 'VERIFY', 'REJECT', atau 'NEED_REVISION'" });
    }
    if (
      (action === "REJECT" || action === "NEED_REVISION") &&
      (!catatanSekretariat || !String(catatanSekretariat).trim())
    ) {
      return res
        .status(400)
        .json({ ok: false, message: "catatanSekretariat wajib diisi" });
    }

    if (!Array.isArray(files) || files.length !== 5) {
      return res
        .status(400)
        .json({ ok: false, message: "files harus berisi tepat 5 entri" });
    }
    const fileTypes = files.map((f) => f?.fileType);
    const missingTypes = REQUIRED_FILE_TYPES.filter((t) => !fileTypes.includes(t));
    if (missingTypes.length > 0) {
      return res.status(400).json({
        ok: false,
        message: `fileType berikut tidak ada: ${missingTypes.join(", ")}`,
      });
    }
    if (new Set(fileTypes).size !== fileTypes.length) {
      return res
        .status(400)
        .json({ ok: false, message: "fileType tidak boleh duplikat" });
    }
    for (const f of files) {
      if (!VALID_FILE_STATUSES.includes(f?.status)) {
        return res.status(400).json({
          ok: false,
          message: `status tidak valid untuk ${f?.fileType}. Harus salah satu dari: ${VALID_FILE_STATUSES.join(", ")}`,
        });
      }
    }
    if (action === "VERIFY" && files.some((f) => f.status !== "VERIFIED")) {
      return res.status(400).json({
        ok: false,
        message: "Semua 5 file harus berstatus VERIFIED untuk melakukan VERIFY",
      });
    }

    await conn.beginTransaction();
    txStarted = true;

    const [skRows] = await conn.query(
      `SELECT * FROM pengajuan_sk_penelitian WHERE pengajuan_judul_id = ? LIMIT 1 FOR UPDATE`,
      [pengajuanJudulId],
    );
    const sk = skRows[0] ?? null;
    if (!sk) {
      await conn.rollback();
      txStarted = false;
      return res
        .status(404)
        .json({ ok: false, message: "SK Penelitian tidak ditemukan" });
    }
    if (sk.status !== "SUBMITTED") {
      await conn.rollback();
      txStarted = false;
      return res.status(409).json({
        ok: false,
        message: "SK Penelitian harus berstatus SUBMITTED untuk diverifikasi",
      });
    }

    for (const f of files) {
      await conn.query(
        `UPDATE pengajuan_sk_penelitian_files SET status = ? WHERE pengajuan_sk_penelitian_id = ? AND file_type = ?`,
        [f.status, sk.id, f.fileType],
      );
    }

    const [skStudentRows] = await conn.query(
      `SELECT u.id FROM users u
       JOIN mahasiswa m ON m.npm = u.npm
       JOIN pengajuan_judul pj ON pj.npm = m.npm AND pj.id = ?
       LIMIT 1`,
      [pengajuanJudulId]
    );
    const studentUserIdForSk = skStudentRows[0]?.id ?? null;

    if (action === "NEED_REVISION") {
      await conn.query(
        `UPDATE pengajuan_sk_penelitian
         SET status = 'NEED_REVISION',
             catatan_sekretariat = ?,
             updated_at = CURRENT_TIMESTAMP
         WHERE id = ?`,
        [String(catatanSekretariat).trim(), sk.id],
      );
      if (studentUserIdForSk) {
        await insertNotification(conn, studentUserIdForSk, "SK_FILE_NEED_REUPLOAD",
          "Sekretariat meminta Anda mengunggah ulang dokumen SK Penelitian", "/student/sk-penelitian");
      }
      await conn.commit();
      txStarted = false;
      return res.json({ ok: true, message: "SK Penelitian dikembalikan untuk revisi" });
    }

    if (action === "REJECT") {
      await conn.query(
        `UPDATE pengajuan_sk_penelitian
         SET status = 'REJECTED',
             catatan_sekretariat = ?,
             verified_by_user_id = ?,
             verified_at = CURRENT_TIMESTAMP,
             updated_at = CURRENT_TIMESTAMP
         WHERE id = ?`,
        [String(catatanSekretariat).trim(), req.user.id, sk.id],
      );
      if (studentUserIdForSk) {
        await insertNotification(conn, studentUserIdForSk, "SK_REJECTED",
          "SK Penelitian Anda ditolak", "/student/sk-penelitian");
      }
      await conn.commit();
      txStarted = false;
      return res.json({ ok: true, message: "SK Penelitian ditolak" });
    }

    // VERIFY — set COMPLETED then generate documents
    await conn.query(
      `UPDATE pengajuan_sk_penelitian
       SET status = 'COMPLETED',
           catatan_sekretariat = ?,
           verified_by_user_id = ?,
           verified_at = CURRENT_TIMESTAMP,
           completed_at = CURRENT_TIMESTAMP,
           updated_at = CURRENT_TIMESTAMP
       WHERE id = ?`,
      [
        catatanSekretariat ? String(catatanSekretariat).trim() : null,
        req.user.id,
        sk.id,
      ],
    );

    await generateSkDocuments(conn, sk, pengajuanJudulId);

    if (studentUserIdForSk) {
      await insertNotification(conn, studentUserIdForSk, "SK_COMPLETED",
        "SK Penelitian Anda telah diverifikasi", "/student/sk-penelitian");
    }

    await conn.commit();
    txStarted = false;

    return res.json({ ok: true, message: "SK Penelitian diverifikasi dan diselesaikan" });
  } catch (err) {
    try {
      if (txStarted) await conn.rollback();
    } catch (_) {}
    next(err);
  } finally {
    conn.release();
  }
};

exports.resubmitSkPenelitian = async (req, res, next) => {
  const conn = await db.getConnection();
  let txStarted = false;
  try {
    if (req.user.userType !== "STUDENT") {
      return res
        .status(403)
        .json({ ok: false, message: "Only students can resubmit SK Penelitian" });
    }

    const pengajuanJudulId = Number(req.params.pengajuanJudulId);
    if (!Number.isFinite(pengajuanJudulId) || pengajuanJudulId <= 0) {
      return res
        .status(400)
        .json({ ok: false, message: "Invalid pengajuanJudulId" });
    }

    const { files } = req.body ?? {};
    if (!Array.isArray(files) || files.length === 0) {
      return res
        .status(400)
        .json({ ok: false, message: "files harus berisi minimal 1 entri" });
    }
    for (const f of files) {
      if (!f?.fileType || !String(f.fileType).trim()) {
        return res.status(400).json({ ok: false, message: "Setiap file harus memiliki fileType" });
      }
      if (!VALID_FILE_TYPES.includes(f.fileType)) {
        return res.status(400).json({
          ok: false,
          message: `fileType tidak valid: ${f.fileType}. Harus salah satu dari: ${VALID_FILE_TYPES.join(", ")}`,
        });
      }
      if (!f?.content || !String(f.content).trim()) {
        return res.status(400).json({ ok: false, message: `content wajib diisi untuk ${f.fileType}` });
      }
      if (!f?.name || !String(f.name).trim()) {
        return res.status(400).json({ ok: false, message: `name wajib diisi untuk ${f.fileType}` });
      }
    }
    const fileTypes = files.map((f) => f.fileType);
    if (new Set(fileTypes).size !== fileTypes.length) {
      return res
        .status(400)
        .json({ ok: false, message: "fileType tidak boleh duplikat" });
    }

    await conn.beginTransaction();
    txStarted = true;

    const [skRows] = await conn.query(
      `SELECT * FROM pengajuan_sk_penelitian WHERE pengajuan_judul_id = ? LIMIT 1 FOR UPDATE`,
      [pengajuanJudulId],
    );
    const sk = skRows[0] ?? null;
    if (!sk) {
      await conn.rollback();
      txStarted = false;
      return res
        .status(404)
        .json({ ok: false, message: "SK Penelitian tidak ditemukan" });
    }
    if (sk.status !== "NEED_REVISION") {
      await conn.rollback();
      txStarted = false;
      return res.status(409).json({
        ok: false,
        message: "SK Penelitian harus berstatus NEED_REVISION untuk resubmit",
      });
    }

    for (const f of files) {
      const [fileRows] = await conn.query(
        `SELECT status FROM pengajuan_sk_penelitian_files WHERE pengajuan_sk_penelitian_id = ? AND file_type = ? LIMIT 1`,
        [sk.id, f.fileType],
      );
      if (fileRows.length === 0) {
        await conn.rollback();
        txStarted = false;
        return res
          .status(404)
          .json({ ok: false, message: `File ${f.fileType} tidak ditemukan` });
      }
      if (fileRows[0].status !== "NEED_REUPLOAD") {
        await conn.rollback();
        txStarted = false;
        return res.status(400).json({
          ok: false,
          message: `File ${f.fileType} tidak berstatus NEED_REUPLOAD`,
        });
      }
    }

    for (const f of files) {
      await upsertSkFile(
        conn,
        sk.id,
        f.fileType,
        String(f.name).trim(),
        f.mimeType ?? "application/octet-stream",
        String(f.content),
        "UPLOADED",
      );
    }

    await conn.query(
      `UPDATE pengajuan_sk_penelitian SET status = 'SUBMITTED', updated_at = CURRENT_TIMESTAMP WHERE id = ?`,
      [sk.id],
    );

    const [resubNpmRows] = await conn.query(
      `SELECT pj.npm FROM pengajuan_judul pj
       JOIN pengajuan_sk_penelitian psk ON psk.pengajuan_judul_id = pj.id
       WHERE psk.id = ? LIMIT 1`,
      [sk.id]
    );
    const resubNpm = resubNpmRows[0]?.npm ?? null;
    if (resubNpm) {
      const [mRows] = await conn.query(`SELECT nama FROM mahasiswa WHERE npm = ? LIMIT 1`, [resubNpm]);
      const namaMahasiswa = mRows[0]?.nama ?? resubNpm;
      const [sekRows] = await conn.query(
        `SELECT u.id FROM users u JOIN user_roles ur ON ur.user_id = u.id JOIN roles r ON r.id = ur.role_id WHERE r.code = 'SEKRETARIAT'`
      );
      for (const sek of sekRows) {
        await insertNotification(conn, sek.id, "SK_RESUBMITTED",
          `Mahasiswa ${namaMahasiswa} mengajukan ulang SK Penelitian`, "/sekretariat/sk-penelitian");
      }
    }

    await conn.commit();
    txStarted = false;

    return res.json({ ok: true, message: "File berhasil diresubmit" });
  } catch (err) {
    try {
      if (txStarted) await conn.rollback();
    } catch (_) {}
    next(err);
  } finally {
    conn.release();
  }
};

exports.getSkFile = async (req, res, next) => {
  try {
    const pengajuanJudulId = Number(req.params.pengajuanJudulId);
    if (!Number.isFinite(pengajuanJudulId) || pengajuanJudulId <= 0) {
      return res
        .status(400)
        .json({ ok: false, message: "Invalid pengajuanJudulId" });
    }

    const fileType = req.params.fileType;
    if (!VALID_FILE_TYPES.includes(fileType)) {
      return res.status(400).json({
        ok: false,
        message: `fileType tidak valid. Harus salah satu dari: ${VALID_FILE_TYPES.join(", ")}`,
      });
    }

    const [skRows] = await db.query(
      `SELECT id FROM pengajuan_sk_penelitian WHERE pengajuan_judul_id = ? LIMIT 1`,
      [pengajuanJudulId],
    );
    const sk = skRows[0] ?? null;
    if (!sk) {
      return res
        .status(404)
        .json({ ok: false, message: "SK Penelitian tidak ditemukan" });
    }

    const [fileRows] = await db.query(
      `SELECT id, file_type, file_name, mime_type, file_content, source, created_at
       FROM pengajuan_sk_penelitian_files
       WHERE pengajuan_sk_penelitian_id = ? AND file_type = ?
       ORDER BY created_at DESC
       LIMIT 1`,
      [sk.id, fileType],
    );
    const file = fileRows[0] ?? null;
    if (!file) {
      return res
        .status(404)
        .json({ ok: false, message: `File ${fileType} tidak ditemukan` });
    }

    return res.json({ ok: true, data: file });
  } catch (err) {
    next(err);
  }
};

exports.listSkForSekretariat = async (req, res, next) => {
  try {
    if (!req.user.hasRole("SEKRETARIAT")) {
      return res
        .status(403)
        .json({
          ok: false,
          message: "Only sekretariat can access this endpoint",
        });
    }

    const statusParam = req.query?.status;
    const filterByStatus = statusParam && VALID_SK_STATUSES.includes(statusParam);

    const [rows] = await db.query(
      `SELECT
         sk.id,
         sk.pengajuan_judul_id,
         sk.status,
         sk.catatan_sekretariat,
         sk.submitted_at,
         sk.verified_at,
         sk.completed_at,
         sk.created_at,
         k.nama_mahasiswa,
         k.judul_skripsi,
         k.program_studi_nama
       FROM pengajuan_sk_penelitian sk
       LEFT JOIN kartu_konsultasi_outline k ON k.pengajuan_judul_id = sk.pengajuan_judul_id
       ${filterByStatus ? "WHERE sk.status = ?" : ""}
       ORDER BY sk.submitted_at DESC`,
      filterByStatus ? [statusParam] : [],
    );

    return res.json({ ok: true, data: rows });
  } catch (err) {
    next(err);
  }
};

