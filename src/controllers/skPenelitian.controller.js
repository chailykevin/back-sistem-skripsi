const db = require("../db");
const { insertNotification } = require("../utils/notify");
const path = require("path");
const {
  generateHalamanPersetujuanJudulDesainSkripsiFTI,
} = require("../services/generateHalamanPersetujuanJudulDesainSkripsiFTI.js");
const {
  generateSuratKeputusanSkripsiFTI,
} = require("../services/generateSuratKeputusanSkripsiFTI.js");
const {
  generatePernyataanPenyelesaianSkripsiFTI,
} = require("../services/generatePernyataanPenyelesaianSkripsiFTI.js");
const {
  generateSuratKeteranganFTI,
} = require("../services/generateSuratKeteranganFTI.js");
const {
  getSuratPengantarPenelitianData,
  generateSuratPengantarPenelitianFTI,
} = require("../services/generateSuratPengantarPenelitianFTI.js");
const { getStudentNpm, getStaffUsrId, getKaprodiProgramStudiIds } = require("../utils/identity");
const { assertSignatures } = require("../utils/signature");
const { BULAN_ROMAWI, formatTanggal } = require("../utils/dates");

function buildKartuFileName(npm, namaMahasiswa, suffix) {
  const safeNpm = String(npm ?? "")
    .trim()
    .replace(/[/\\:*?"<>|]+/g, "_");
  const safeNama = String(namaMahasiswa ?? "")
    .trim()
    .replace(/[/\\:*?"<>|]+/g, "_");
  return `${safeNpm} - ${safeNama} - ${suffix}.pdf`;
}

async function generateSkDocuments(conn, sk, outlineId) {
  // Fetch kartu konsultasi outline (has mahasiswa info + dospem names + program studi)
  const [[kartu]] = await conn.query(
    `SELECT o.npm, o.judul AS judul_skripsi, o.program_studi_id,
            o.pembimbing1_nidn, o.pembimbing2_nidn,
            m.nama AS nama_mahasiswa,
            ps.nama AS program_studi_nama,
            d1.nama AS pembimbing1_nama,
            d2.nama AS pembimbing2_nama
     FROM kartu_konsultasi_outline k
     JOIN outline o ON o.id = k.outline_id
     JOIN mahasiswa m ON m.npm = o.npm
     JOIN program_studi ps ON ps.id = o.program_studi_id
     LEFT JOIN dosen d1 ON d1.nidn = o.pembimbing1_nidn
     LEFT JOIN dosen d2 ON d2.nidn = o.pembimbing2_nidn
     WHERE k.outline_id = ?
     LIMIT 1`,
    [outlineId],
  );
  if (!kartu)
    throw Object.assign(new Error("Kartu konsultasi outline tidak ditemukan"), {
      statusCode: 400,
    });

  // Fetch pengajuan disposisi pembimbing for perlu_surat_pengantar + nama_perusahaan
  const [[pj]] = await conn.query(
    `SELECT id, perlu_surat_pengantar, nama_perusahaan FROM pengajuan_disposisi_pembimbing WHERE outline_id = ? LIMIT 1`,
    [outlineId],
  );
  if (!pj)
    throw Object.assign(
      new Error("Pengajuan disposisi pembimbing tidak ditemukan"),
      {
        statusCode: 400,
      },
    );

  // Fetch program studi + fakultas
  const [[ps]] = await conn.query(
    `SELECT ps.kode AS ps_kode, ps.nama AS ps_nama, f.kode AS f_kode, f.dekan_staff_usr_id AS dekan_nidn
     FROM program_studi ps
     LEFT JOIN fakultas f ON f.id = ps.fakultas_id
     WHERE ps.id = ?
     LIMIT 1`,
    [kartu.program_studi_id],
  );
  if (!ps)
    throw Object.assign(new Error("Program studi tidak ditemukan"), {
      statusCode: 400,
    });
  if (!ps.f_kode || !ps.dekan_nidn) {
    throw Object.assign(
      new Error("Dekan belum dikonfigurasi untuk fakultas ini"),
      { statusCode: 400 },
    );
  }


  const [[dekan]] = await conn.query(
    `SELECT md.dsnTtd AS signature_image, s.nama AS nama_dekan 
     from staf s
     JOIN widya_miko.c_useradm cua ON cua.usrId = s.usr_id 
     JOIN widya_miko.m_dosen md ON md.dsnNama = cua.usrNama
     WHERE s.usr_id = ?
     LIMIT 1`,
    [ps.dekan_nidn],
  );

  if (!dekan)
    throw Object.assign(new Error("Dekan belum dikonfigurasi"), {
      statusCode: 400,
    });

  const [[kaprodi]] = await conn.query(
    `SELECT md.dsnTtd AS signature_image, staf.nama AS nama_kaprodi
     FROM program_studi ps
     LEFT JOIN staf ON staf.usr_id = ps.kaprodi_staff_usr_id
     JOIN widya_miko.c_useradm cua ON cua.usrId = ps.kaprodi_staff_usr_id
     JOIN widya_miko.m_dosen md ON md.dsnNama = cua.usrNama
     WHERE ps.id = ? LIMIT 1`,
    [kartu.program_studi_id],
  );

  const [[mahasiswaUser]] = await conn.query(
    `SELECT signature_image FROM users WHERE npm = ? AND is_active = 1 LIMIT 1`,
    [kartu.npm],
  );

  assertSignatures([
    {
      role: "Dekan",
      nama: dekan.nama_dekan,
      signatureImage: dekan.signature_image,
    },
    {
      role: "Kaprodi",
      nama: kaprodi?.nama_kaprodi,
      signatureImage: kaprodi?.signature_image,
    },
    {
      role: "Mahasiswa",
      nama: kartu.nama_mahasiswa,
      signatureImage: mahasiswaUser?.signature_image,
    },
  ]);

  // Generate nomor_surat sequence (count SKs completed this month for same prodi)
  const now = new Date();
  const year = now.getFullYear();
  const month = now.getMonth() + 1; // 1-based
  const [[{ seq }]] = await conn.query(
    `SELECT COUNT(*) AS seq
     FROM pengajuan_sk_penelitian psk
     JOIN outline o ON o.id = psk.outline_id
     WHERE o.program_studi_id = ?
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

  const tanggal = formatTanggal(now);

  const dataSuratKeputusanSkripsiFTI = {
    nomorSurat,
    programStudi: kartu.program_studi_nama,
    mahasiswa: {
      nama: kartu.nama_mahasiswa,
      npm: kartu.npm,
    },
    pembimbing: {
      pertama: kartu.pembimbing1_nama,
      kedua: kartu.pembimbing2_nama,
    },
    judulSkripsi: kartu.judul_skripsi,
    tanggal,
    dekan: {
      nama: dekan.nama_dekan,
      signatureBase64: dekan.signature_image,
    },
  };
  const skBuffer = await generateSuratKeputusanSkripsiFTI(
    dataSuratKeputusanSkripsiFTI,
  );
  const skBase64 = Buffer.from(skBuffer).toString("base64");
  const mimePdf = "application/pdf";
  const mimeDocx =
    "application/vnd.openxmlformats-officedocument.wordprocessingml.document";

  await conn.query(
    `DELETE FROM pengajuan_sk_penelitian_files WHERE pengajuan_sk_penelitian_id = ? AND file_type = 'SK_PENUNJUKAN_PEMBIMBING'`,
    [sk.id],
  );
  await conn.query(
    `INSERT INTO pengajuan_sk_penelitian_files
       (pengajuan_sk_penelitian_id, file_type, file_name, mime_type, file_content, source, status)
     VALUES (?, 'SK_PENUNJUKAN_PEMBIMBING', ?, ?, ?, 'GENERATED', 'VERIFIED')`,
    [
      sk.id,
      buildKartuFileName(
        kartu.npm,
        kartu.nama_mahasiswa,
        "SK Penunjukan Pembimbing",
      ),
      mimePdf,
      skBase64,
    ],
  );

  // Generate SURAT_PENYELESAIAN_SKRIPSI (always)

  const dataPernyataanPenyelesaianSkripsiFTI = {
    mahasiswa: {
      nama: kartu.nama_mahasiswa,
      npm: kartu.npm,
      alamat: "",
      noHp: "",
      judulSkripsi: kartu.judul_skripsi,
      signatureBase64: mahasiswaUser?.signature_image ?? null,
    },
    ketuaProgramStudi: {
      nama: kaprodi?.nama_kaprodi ?? "",
      programStudi: kartu.program_studi_nama,
      signatureBase64: kaprodi?.signature_image ?? null,
    },
  };
  const penyelesaianBuffer = await generatePernyataanPenyelesaianSkripsiFTI(
    dataPernyataanPenyelesaianSkripsiFTI,
  );
  const penyelesaianBase64 = Buffer.from(penyelesaianBuffer).toString("base64");
  const mimePenyelesaianPdf = "application/pdf";

  await conn.query(
    `DELETE FROM pengajuan_sk_penelitian_files WHERE pengajuan_sk_penelitian_id = ? AND file_type = 'SURAT_PENYELESAIAN_SKRIPSI'`,
    [sk.id],
  );
  await conn.query(
    `INSERT INTO pengajuan_sk_penelitian_files
       (pengajuan_sk_penelitian_id, file_type, file_name, mime_type, file_content, source, status)
     VALUES (?, 'SURAT_PENYELESAIAN_SKRIPSI', ?, ?, ?, 'GENERATED', 'VERIFIED')`,
    [
      sk.id,
      buildKartuFileName(
        kartu.npm,
        kartu.nama_mahasiswa,
        "Surat Penyelesaian Skripsi",
      ),
      mimePenyelesaianPdf,
      penyelesaianBase64,
    ],
  );

  // Generate SURAT_KETERANGAN if needed
  if (pj.perlu_surat_pengantar) {

    const dataSuratKeteranganFTI = {
      mahasiswa: {
        nama: kartu.nama_mahasiswa,
        npm: kartu.npm,
      },
      programStudi: kartu.program_studi_nama,
      lokasi: pj.nama_perusahaan ?? "",
      judulSkripsi: kartu.judul_skripsi,
    };
    const suratBuffer = await generateSuratKeteranganFTI(
      dataSuratKeteranganFTI,
    );
    const suratBase64 = Buffer.from(suratBuffer).toString("base64");
    const mimeSuratPdf = "application/pdf";

    await conn.query(
      `DELETE FROM pengajuan_sk_penelitian_files WHERE pengajuan_sk_penelitian_id = ? AND file_type = 'SURAT_KETERANGAN'`,
      [sk.id],
    );
    await conn.query(
      `INSERT INTO pengajuan_sk_penelitian_files
         (pengajuan_sk_penelitian_id, file_type, file_name, mime_type, file_content, source, status)
       VALUES (?, 'SURAT_KETERANGAN', ?, ?, ?, 'GENERATED', 'VERIFIED')`,
      [sk.id, `Surat_Keterangan_${kartu.npm}.pdf`, mimeSuratPdf, suratBase64],
    );

    const dataSuratPengantarPenelitianFTI =
      await getSuratPengantarPenelitianData(conn, pj.id);
    dataSuratPengantarPenelitianFTI.tanggalSurat = tanggal;
    const pengantarBuffer = await generateSuratPengantarPenelitianFTI(
      dataSuratPengantarPenelitianFTI,
    );
    const pengantarBase64 = Buffer.from(pengantarBuffer).toString("base64");

    await conn.query(
      `DELETE FROM pengajuan_sk_penelitian_files WHERE pengajuan_sk_penelitian_id = ? AND file_type = 'SURAT_PENGANTAR_PENELITIAN'`,
      [sk.id],
    );
    await conn.query(
      `INSERT INTO pengajuan_sk_penelitian_files
         (pengajuan_sk_penelitian_id, file_type, file_name, mime_type, file_content, source, status)
       VALUES (?, 'SURAT_PENGANTAR_PENELITIAN', ?, ?, ?, 'GENERATED', 'VERIFIED')`,
      [
        sk.id,
        `Surat_Pengantar_Penelitian_${kartu.npm}.pdf`,
        mimeSuratPdf,
        pengantarBase64,
      ],
    );
  }
}

const VALID_FILE_TYPES = [
  "PENGAJUAN_DISPOSISI_PEMBIMBING",
  "TRANSKRIP_NILAI",
  "KARTU_KONSULTASI_OUTLINE",
  "FILE_OUTLINE",
  "HALAMAN_PERSETUJUAN",
  "SK_PENUNJUKAN_PEMBIMBING",
  "SURAT_KETERANGAN",
  "SURAT_PENGANTAR_PENELITIAN",
  "SURAT_PENYELESAIAN_SKRIPSI",
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
  status = "SUBMITTED",
) {
  await conn.query(
    `DELETE FROM pengajuan_sk_penelitian_files WHERE pengajuan_sk_penelitian_id = ? AND file_type = ?`,
    [skPenelitianId, fileType],
  );
  await conn.query(
    `INSERT INTO pengajuan_sk_penelitian_files
       (pengajuan_sk_penelitian_id, file_type, file_name, mime_type, file_content, source, status)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
    [
      skPenelitianId,
      fileType,
      fileName,
      mimeType ?? null,
      fileContent,
      source,
      status,
    ],
  );
}

exports.initSkPenelitian = async (req, res, next) => {
  const conn = await db.getConnection();
  let txStarted = false;
  try {
    if (req.user.userType !== "STUDENT") {
      return res.status(403).json({
        ok: false,
        message: "Only students can initialize SK Penelitian",
      });
    }

    const outlineId = Number(req.params.outlineId);
    if (!Number.isFinite(outlineId) || outlineId <= 0) {
      return res.status(400).json({ ok: false, message: "Invalid outlineId" });
    }

    const npm = await getStudentNpm(req.user.id);
    if (!npm) {
      return res
        .status(400)
        .json({ ok: false, message: "Mahasiswa tidak valid" });
    }

    const [outlineRows] = await conn.query(
      `SELECT id FROM outline WHERE id = ? AND npm = ? AND status = 'ACCEPTED' LIMIT 1`,
      [outlineId, npm],
    );
    if (outlineRows.length === 0) {
      return res
        .status(404)
        .json({ ok: false, message: "Outline tidak ditemukan" });
    }

    const [kartuRows] = await conn.query(
      `SELECT k.id, o.npm, k.outline_id, o.program_studi_id, o.pembimbing1_nidn, o.pembimbing2_nidn,
              o.judul AS judul_skripsi, k.is_completed
       FROM kartu_konsultasi_outline k
       JOIN outline o ON o.id = k.outline_id
       WHERE k.outline_id = ? AND o.npm = ? AND k.is_completed = 1
       LIMIT 1`,
      [outlineId, npm],
    );
    if (kartuRows.length === 0) {
      return res.status(400).json({
        ok: false,
        message: "Kartu konsultasi outline belum selesai",
      });
    }
    const kartu = kartuRows[0];

    const [existingRows] = await conn.query(
      `SELECT id FROM pengajuan_sk_penelitian WHERE outline_id = ? LIMIT 1`,
      [outlineId],
    );
    if (existingRows.length > 0) {
      return res
        .status(409)
        .json({ ok: false, message: "SK Penelitian sudah dibuat" });
    }

    await conn.beginTransaction();
    txStarted = true;

    const [ins] = await conn.query(
      `INSERT INTO pengajuan_sk_penelitian (outline_id, status) VALUES (?, 'DRAFT')`,
      [outlineId],
    );
    const skId = ins.insertId;

    // Generate halaman persetujuan PDF and store directly into sk files
    const [[mahasiswaRow]] = await conn.query(
      `SELECT signature_image FROM users WHERE npm = ? LIMIT 1`,
      [kartu.npm],
    );
    const [[p2Row]] = await conn.query(
      `SELECT dsnTtd AS signature_image
       FROM widya_miko.m_dosen
       WHERE dsnId = ?
       LIMIT 1`,
      [kartu.pembimbing2_nidn],
    );
    const [[p1Row]] = await conn.query(
      `SELECT dsnTtd AS signature_image
       FROM widya_miko.m_dosen
       WHERE dsnId = ?
       LIMIT 1`,
      [kartu.pembimbing1_nidn],
    );
    const [[kaprodiRow]] = await conn.query(
      `SELECT md.dsnTtd AS signature_image FROM program_studi ps
       JOIN widya_miko.c_useradm cua ON cua.usrId = ps.kaprodi_staff_usr_id
       JOIN widya_miko.m_dosen md ON md.dsnNama = cua.usrNama
       WHERE ps.id = ? LIMIT 1`,
      [kartu.program_studi_id],
    );
    const [[psRow]] = await conn.query(
      `SELECT ps.nama AS program_studi_nama, COALESCE(staf.nama, d.nama) AS kaprodi_nama,
              m.nama AS nama_mahasiswa,
              d1.nama AS pembimbing1_nama, d2.nama AS pembimbing2_nama
       FROM program_studi ps
       LEFT JOIN staf ON staf.usr_id = ps.kaprodi_staff_usr_id
       LEFT JOIN dosen d ON d.nidn = ps.kaprodi_nidn
       JOIN mahasiswa m ON m.npm = ?
       LEFT JOIN dosen d1 ON d1.nidn = ?
       LEFT JOIN dosen d2 ON d2.nidn = ?
       WHERE ps.id = ? LIMIT 1`,
      [
        kartu.npm,
        kartu.pembimbing1_nidn,
        kartu.pembimbing2_nidn,
        kartu.program_studi_id,
      ],
    );
    const dataHalamanPersetujuanJudulDesainSkripsiFTI = {
      mahasiswa: {
        nama: psRow?.nama_mahasiswa ?? "",
        npm: kartu.npm,
        signatureBase64: mahasiswaRow?.signature_image ?? null,
      },
      pembimbing: {
        pertama: {
          nama: psRow?.pembimbing1_nama ?? "",
          signatureBase64: p1Row?.signature_image ?? null,
        },
        kedua: {
          nama: psRow?.pembimbing2_nama ?? "",
          signatureBase64: p2Row?.signature_image ?? null,
        },
      },
      ketuaProgramStudi: {
        nama: psRow?.kaprodi_nama ?? "",
        signatureBase64: kaprodiRow?.signature_image ?? null,
      },
      programStudi: psRow?.program_studi_nama ?? "",
      judulSkripsi: kartu.judul_skripsi ?? "",
      tahun: String(new Date().getFullYear()),
    };

    assertSignatures([
      {
        role: "Mahasiswa",
        nama: psRow?.nama_mahasiswa,
        signatureImage: mahasiswaRow?.signature_image,
      },
      {
        role: "Pembimbing 2",
        nama: psRow?.pembimbing2_nama,
        signatureImage: p2Row?.signature_image,
      },
      {
        role: "Pembimbing 1",
        nama: psRow?.pembimbing1_nama,
        signatureImage: p1Row?.signature_image,
      },
      {
        role: "Kaprodi",
        nama: psRow?.kaprodi_nama,
        signatureImage: kaprodiRow?.signature_image,
      },
    ]);

    const halamanBuffer =
      await generateHalamanPersetujuanJudulDesainSkripsiFTI(
        dataHalamanPersetujuanJudulDesainSkripsiFTI,
      );

    const mimePdf = "application/pdf";
    const halamanFileName = buildKartuFileName(
      kartu.npm,
      psRow?.nama_mahasiswa,
      "Halaman Persetujuan Judul",
    );

    await conn.query(
      `INSERT INTO pengajuan_sk_penelitian_files
         (pengajuan_sk_penelitian_id, file_type, file_name, mime_type, file_content, source, status)
       VALUES (?, 'HALAMAN_PERSETUJUAN', ?, ?, ?, 'SYSTEM', 'VERIFIED')`,
      [
        skId,
        halamanFileName,
        mimePdf,
        Buffer.from(halamanBuffer).toString("base64"),
      ],
    );

    await conn.commit();
    txStarted = false;

    return res.status(201).json({
      ok: true,
      message: "SK Penelitian dibuat",
      data: { id: skId },
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

exports.getSkPenelitian = async (req, res, next) => {
  try {
    const outlineId = Number(req.params.outlineId);
    if (!Number.isFinite(outlineId) || outlineId <= 0) {
      return res.status(400).json({ ok: false, message: "Invalid outlineId" });
    }

    const [skRows] = await db.query(
      `SELECT
         sk.*,
         o.npm,
         m.nama AS nama_mahasiswa,
         o.judul AS judul_skripsi,
         ps.nama AS program_studi_nama
       FROM pengajuan_sk_penelitian sk
       JOIN outline o ON o.id = sk.outline_id
       LEFT JOIN kartu_konsultasi_outline k ON k.outline_id = sk.outline_id
       LEFT JOIN mahasiswa m ON m.npm = o.npm
       LEFT JOIN program_studi ps ON ps.id = o.program_studi_id
       WHERE sk.outline_id = ?
       LIMIT 1`,
      [outlineId],
    );
    const sk = skRows[0] ?? null;
    if (!sk) {
      return res
        .status(404)
        .json({ ok: false, message: "SK Penelitian tidak ditemukan" });
    }

    const [files] = await db.query(
      `SELECT id, file_type, file_name, mime_type, source, status, catatan_sekretariat, created_at
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

    const outlineId = Number(req.params.outlineId);
    if (!Number.isFinite(outlineId) || outlineId <= 0) {
      return res.status(400).json({ ok: false, message: "Invalid outlineId" });
    }

    await conn.beginTransaction();
    txStarted = true;

    const [skRows] = await conn.query(
      `SELECT * FROM pengajuan_sk_penelitian WHERE outline_id = ? LIMIT 1 FOR UPDATE`,
      [outlineId],
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
      return res.status(409).json({
        ok: false,
        message:
          "SK Penelitian hanya bisa disubmit saat status DRAFT atau NEED_REVISION",
      });
    }

    // Resolve kartu_id
    const [kartuRows] = await conn.query(
      `SELECT id FROM kartu_konsultasi_outline WHERE outline_id = ? LIMIT 1`,
      [outlineId],
    );
    if (kartuRows.length === 0) {
      await conn.rollback();
      txStarted = false;
      return res.status(400).json({
        ok: false,
        message: "Kartu konsultasi outline tidak ditemukan",
      });
    }
    const kartuId = kartuRows[0].id;

    // System-pull Kartu Konsultasi Outline DOCX
    const [kartuFileRows] = await conn.query(
      `SELECT file_content, file_name, mime_type
       FROM kartu_konsultasi_outline
       WHERE id = ? AND file_content IS NOT NULL
       LIMIT 1`,
      [kartuId],
    );
    if (kartuFileRows.length === 0) {
      await conn.rollback();
      txStarted = false;
      return res.status(400).json({
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

    // System-pull Transkrip Nilai
    const [transkripRows] = await conn.query(
      `SELECT pf.file_content, pf.file_name
       FROM pengajuan_disposisi_pembimbing_file pf
       JOIN pengajuan_disposisi_pembimbing pj ON pj.id = pf.pengajuan_disposisi_pembimbing_id
       WHERE pj.outline_id = ? AND pf.file_type = 'TRANSKRIP' LIMIT 1`,
      [outlineId],
    );
    if (transkripRows.length === 0) {
      await conn.rollback();
      txStarted = false;
      return res.status(400).json({
        ok: false,
        message:
          "File transkrip nilai tidak ditemukan pada pengajuan disposisi pembimbing",
      });
    }
    const transkripRow = transkripRows[0];

    // System-pull Formulir Pengajuan Disposisi Pembimbing (generated at Kaprodi review)
    const [formulirRows] = await conn.query(
      `SELECT pf.file_content, pf.file_name
       FROM pengajuan_disposisi_pembimbing_file pf
       JOIN pengajuan_disposisi_pembimbing pj ON pj.id = pf.pengajuan_disposisi_pembimbing_id
       WHERE pj.outline_id = ? AND pf.file_type = 'PENGAJUAN_DISPOSISI_PEMBIMBING' LIMIT 1`,
      [outlineId],
    );
    if (formulirRows.length === 0) {
      await conn.rollback();
      txStarted = false;
      return res.status(400).json({
        ok: false,
        message: "File formulir pengajuan disposisi pembimbing tidak ditemukan",
      });
    }
    const formulirRow = formulirRows[0];

    await upsertSkFile(
      conn,
      sk.id,
      "PENGAJUAN_DISPOSISI_PEMBIMBING",
      formulirRow.file_name,
      "application/pdf",
      formulirRow.file_content,
      "SYSTEM",
      "VERIFIED",
    );
    await upsertSkFile(
      conn,
      sk.id,
      "TRANSKRIP_NILAI",
      transkripRow.file_name,
      "application/octet-stream",
      transkripRow.file_content,
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
      "VERIFIED",
    );
    await upsertSkFile(
      conn,
      sk.id,
      "FILE_OUTLINE",
      outlineRow.file_outline_name,
      "application/octet-stream",
      outlineRow.file_outline,
      "SYSTEM",
      "VERIFIED",
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
  "PENGAJUAN_DISPOSISI_PEMBIMBING",
  "TRANSKRIP_NILAI",
  "KARTU_KONSULTASI_OUTLINE",
  "FILE_OUTLINE",
  "HALAMAN_PERSETUJUAN",
];
// System-generated/approved files are inserted VERIFIED; only these are reviewable or re-uploadable
const REVIEWABLE_FILE_TYPES = ["TRANSKRIP_NILAI"];
const VALID_FILE_STATUSES = ["SUBMITTED", "NEED_REUPLOAD", "VERIFIED"];

exports.reviewSkFile = async (req, res, next) => {
  const conn = await db.getConnection();
  let txStarted = false;
  try {
    if (!req.user.hasRole("SEKRETARIAT")) {
      return res.status(403).json({
        ok: false,
        message: "Only sekretariat can review SK Penelitian files",
      });
    }

    const outlineId = Number(req.params.outlineId);
    if (!Number.isFinite(outlineId) || outlineId <= 0) {
      return res.status(400).json({ ok: false, message: "Invalid outlineId" });
    }

    const fileType = req.params.fileType;
    if (!REVIEWABLE_FILE_TYPES.includes(fileType)) {
      return res.status(400).json({
        ok: false,
        message: REQUIRED_FILE_TYPES.includes(fileType)
          ? `File ${fileType} diverifikasi otomatis oleh sistem dan tidak dapat direview`
          : `fileType tidak valid: ${fileType}. Harus salah satu dari: ${REVIEWABLE_FILE_TYPES.join(", ")}`,
      });
    }

    const { status, catatanSekretariat } = req.body ?? {};
    if (!VALID_FILE_STATUSES.includes(status)) {
      return res.status(400).json({
        ok: false,
        message: `status harus salah satu dari: ${VALID_FILE_STATUSES.join(", ")}`,
      });
    }

    await conn.beginTransaction();
    txStarted = true;

    const [[sk]] = await conn.query(
      `SELECT * FROM pengajuan_sk_penelitian
       WHERE outline_id = ? AND status NOT IN ('COMPLETED','REJECTED')
       LIMIT 1 FOR UPDATE`,
      [outlineId],
    );
    if (!sk) {
      await conn.rollback();
      txStarted = false;
      return res
        .status(404)
        .json({ ok: false, message: "SK Penelitian tidak ditemukan" });
    }
    if (sk.status !== "SUBMITTED" && sk.status !== "NEED_REVISION") {
      await conn.rollback();
      txStarted = false;
      return res.status(409).json({
        ok: false,
        message:
          "Review file hanya bisa dilakukan saat status SUBMITTED atau NEED_REVISION",
      });
    }

    const [[fileRow]] = await conn.query(
      `SELECT id FROM pengajuan_sk_penelitian_files
       WHERE pengajuan_sk_penelitian_id = ? AND file_type = ? LIMIT 1`,
      [sk.id, fileType],
    );
    if (!fileRow) {
      await conn.rollback();
      txStarted = false;
      return res
        .status(404)
        .json({ ok: false, message: `File ${fileType} tidak ditemukan` });
    }

    await conn.query(
      `UPDATE pengajuan_sk_penelitian_files SET status = ?, catatan_sekretariat = ? WHERE id = ?`,
      [
        status,
        catatanSekretariat ? String(catatanSekretariat).trim() : null,
        fileRow.id,
      ],
    );

    await conn.commit();
    txStarted = false;

    return res.json({
      ok: true,
      message: `Status file ${fileType} diperbarui`,
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

exports.reviewSkPenelitian = async (req, res, next) => {
  const conn = await db.getConnection();
  let txStarted = false;
  try {
    if (!req.user.hasRole("SEKRETARIAT")) {
      return res.status(403).json({
        ok: false,
        message: "Only sekretariat can review SK Penelitian",
      });
    }

    const outlineId = Number(req.params.outlineId);
    if (!Number.isFinite(outlineId) || outlineId <= 0) {
      return res.status(400).json({ ok: false, message: "Invalid outlineId" });
    }

    const { action, catatanSekretariat } = req.body ?? {};

    if (
      action !== "VERIFY" &&
      action !== "REJECT" &&
      action !== "NEED_REVISION"
    ) {
      return res.status(400).json({
        ok: false,
        message: "action harus 'VERIFY', 'REJECT', atau 'NEED_REVISION'",
      });
    }
    if (
      (action === "REJECT" || action === "NEED_REVISION") &&
      (!catatanSekretariat || !String(catatanSekretariat).trim())
    ) {
      return res
        .status(400)
        .json({ ok: false, message: "catatanSekretariat wajib diisi" });
    }

    await conn.beginTransaction();
    txStarted = true;

    const [skRows] = await conn.query(
      `SELECT * FROM pengajuan_sk_penelitian WHERE outline_id = ? LIMIT 1 FOR UPDATE`,
      [outlineId],
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
        message: "SK Penelitian harus berstatus SUBMITTED untuk difinalisasi",
      });
    }

    const [skStudentRows] = await conn.query(
      `SELECT u.id FROM users u
       JOIN mahasiswa m ON m.npm = u.npm
       JOIN outline o ON o.npm = m.npm AND o.id = ?
       LIMIT 1`,
      [outlineId],
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
        await insertNotification(
          conn,
          studentUserIdForSk,
          "SK_FILE_NEED_REUPLOAD",
          "Sekretariat meminta Anda mengunggah ulang dokumen SK Penelitian",
          "/student/sk-penelitian",
        );
      }
      await conn.commit();
      txStarted = false;
      return res.json({
        ok: true,
        message: "SK Penelitian dikembalikan untuk revisi",
      });
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
        await insertNotification(
          conn,
          studentUserIdForSk,
          "SK_REJECTED",
          "SK Penelitian Anda ditolak",
          "/student/sk-penelitian",
        );
      }
      await conn.commit();
      txStarted = false;
      return res.json({ ok: true, message: "SK Penelitian ditolak" });
    }

    // VERIFY — ensure all required files are verified before proceeding
    const [fileRows] = await conn.query(
      `SELECT file_type, status FROM pengajuan_sk_penelitian_files WHERE pengajuan_sk_penelitian_id = ?`,
      [sk.id],
    );
    const fileMap = Object.fromEntries(
      fileRows.map((f) => [f.file_type, f.status]),
    );
    const unverified = REQUIRED_FILE_TYPES.filter(
      (t) => fileMap[t] !== "VERIFIED",
    );
    if (unverified.length > 0) {
      await conn.rollback();
      txStarted = false;
      return res.status(400).json({
        ok: false,
        message: `File berikut belum diverifikasi: ${unverified.join(", ")}`,
      });
    }

    // set COMPLETED then generate documents
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

    await generateSkDocuments(conn, sk, outlineId);

    const [[skripsiSource]] = await conn.query(
      `SELECT o.npm, o.judul AS judul, o.program_studi_id,
              o.pembimbing1_nidn, o.pembimbing2_nidn, k.outline_id
       FROM kartu_konsultasi_outline k
       JOIN outline o ON o.id = k.outline_id
       WHERE k.outline_id = ?
       LIMIT 1`,
      [outlineId],
    );
    if (skripsiSource) {
      await conn.query(
        `INSERT INTO skripsi
           (npm, outline_id, judul, status, program_studi_id,
            pembimbing1_nidn, pembimbing2_nidn)
         VALUES (?, ?, ?, 'IN_PROGRESS', ?, ?, ?)`,
        [
          skripsiSource.npm,
          skripsiSource.outline_id,
          skripsiSource.judul,
          skripsiSource.program_studi_id ?? null,
          skripsiSource.pembimbing1_nidn ?? null,
          skripsiSource.pembimbing2_nidn ?? null,
        ],
      );
    }

    if (studentUserIdForSk) {
      await insertNotification(
        conn,
        studentUserIdForSk,
        "SK_COMPLETED",
        "SK Penelitian Anda telah diverifikasi",
        "/student/sk-penelitian",
      );
    }

    await conn.commit();
    txStarted = false;

    return res.json({
      ok: true,
      message: "SK Penelitian diverifikasi dan diselesaikan",
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

exports.resubmitSkPenelitian = async (req, res, next) => {
  const conn = await db.getConnection();
  let txStarted = false;
  try {
    if (req.user.userType !== "STUDENT") {
      return res.status(403).json({
        ok: false,
        message: "Only students can resubmit SK Penelitian",
      });
    }

    const outlineId = Number(req.params.outlineId);
    if (!Number.isFinite(outlineId) || outlineId <= 0) {
      return res.status(400).json({ ok: false, message: "Invalid outlineId" });
    }

    const { files } = req.body ?? {};
    if (!Array.isArray(files) || files.length === 0) {
      return res
        .status(400)
        .json({ ok: false, message: "files harus berisi minimal 1 entri" });
    }
    for (const f of files) {
      if (!f?.fileType || !String(f.fileType).trim()) {
        return res
          .status(400)
          .json({ ok: false, message: "Setiap file harus memiliki fileType" });
      }
      if (!REVIEWABLE_FILE_TYPES.includes(f.fileType)) {
        return res.status(400).json({
          ok: false,
          message: `fileType tidak valid: ${f.fileType}. Harus salah satu dari: ${REVIEWABLE_FILE_TYPES.join(", ")}`,
        });
      }
      if (!f?.content || !String(f.content).trim()) {
        return res.status(400).json({
          ok: false,
          message: `content wajib diisi untuk ${f.fileType}`,
        });
      }
      if (!f?.name || !String(f.name).trim()) {
        return res
          .status(400)
          .json({ ok: false, message: `name wajib diisi untuk ${f.fileType}` });
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
      `SELECT * FROM pengajuan_sk_penelitian WHERE outline_id = ? LIMIT 1 FOR UPDATE`,
      [outlineId],
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
      `SELECT o.npm FROM outline o
       JOIN pengajuan_sk_penelitian psk ON psk.outline_id = o.id
       WHERE psk.id = ? LIMIT 1`,
      [sk.id],
    );
    const resubNpm = resubNpmRows[0]?.npm ?? null;
    if (resubNpm) {
      const [mRows] = await conn.query(
        `SELECT nama FROM mahasiswa WHERE npm = ? LIMIT 1`,
        [resubNpm],
      );
      const namaMahasiswa = mRows[0]?.nama ?? resubNpm;
      const [sekRows] = await conn.query(
        `SELECT u.id FROM users u JOIN user_roles ur ON ur.user_id = u.id JOIN roles r ON r.id = ur.role_id WHERE r.code = 'SEKRETARIAT'`,
      );
      for (const sek of sekRows) {
        await insertNotification(
          conn,
          sek.id,
          "SK_RESUBMITTED",
          `Mahasiswa ${namaMahasiswa} mengajukan ulang SK Penelitian`,
          "/sekretariat/sk-penelitian",
        );
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
    const outlineId = Number(req.params.outlineId);
    if (!Number.isFinite(outlineId) || outlineId <= 0) {
      return res.status(400).json({ ok: false, message: "Invalid outlineId" });
    }

    const fileType = req.params.fileType;
    if (!VALID_FILE_TYPES.includes(fileType)) {
      return res.status(400).json({
        ok: false,
        message: `fileType tidak valid. Harus salah satu dari: ${VALID_FILE_TYPES.join(", ")}`,
      });
    }

    const [skRows] = await db.query(
      `SELECT id FROM pengajuan_sk_penelitian WHERE outline_id = ? LIMIT 1`,
      [outlineId],
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
      return res.status(403).json({
        ok: false,
        message: "Only sekretariat can access this endpoint",
      });
    }

    const statusParam = req.query?.status;
    const filterByStatus =
      statusParam && VALID_SK_STATUSES.includes(statusParam);

    const [rows] = await db.query(
      `SELECT
         sk.id,
         sk.outline_id,
         sk.status,
         sk.catatan_sekretariat,
         sk.submitted_at,
         sk.verified_at,
         sk.completed_at,
         sk.created_at,
         m.nama AS nama_mahasiswa,
         o.judul AS judul_skripsi,
         o.submission_period_id,
         o.program_studi_id,
         ps.nama AS program_studi_nama,
         EXISTS(
           SELECT 1 FROM pengajuan_sk_penelitian_files f
           WHERE f.pengajuan_sk_penelitian_id = sk.id AND f.file_type = 'SK_PENUNJUKAN_PEMBIMBING'
         ) AS has_sk_penunjukan_pembimbing,
         EXISTS(
           SELECT 1 FROM pengajuan_sk_penelitian_files f
           WHERE f.pengajuan_sk_penelitian_id = sk.id AND f.file_type = 'SURAT_KETERANGAN'
         ) AS has_surat_keterangan,
         EXISTS(
           SELECT 1 FROM pengajuan_sk_penelitian_files f
           WHERE f.pengajuan_sk_penelitian_id = sk.id AND f.file_type = 'SURAT_PENGANTAR_PENELITIAN'
         ) AS has_surat_pengantar_penelitian,
         EXISTS(
           SELECT 1 FROM pengajuan_sk_penelitian_files f
           WHERE f.pengajuan_sk_penelitian_id = sk.id AND f.file_type = 'SURAT_PENYELESAIAN_SKRIPSI'
         ) AS has_surat_penyelesaian_skripsi
       FROM pengajuan_sk_penelitian sk
       JOIN outline o ON o.id = sk.outline_id
       LEFT JOIN kartu_konsultasi_outline k ON k.outline_id = sk.outline_id
       LEFT JOIN mahasiswa m ON m.npm = o.npm
       LEFT JOIN program_studi ps ON ps.id = o.program_studi_id
       ${filterByStatus ? "WHERE sk.status = ?" : ""}
       ORDER BY sk.submitted_at DESC`,
      filterByStatus ? [statusParam] : [],
    );

    return res.json({ ok: true, data: rows });
  } catch (err) {
    next(err);
  }
};

exports.listSkForKaprodi = async (req, res, next) => {
  try {
    if (!req.user.hasRole("KAPRODI")) {
      return res.status(403).json({
        ok: false,
        message: "Only kaprodi can access this endpoint",
      });
    }

    const staffUsrId = await getStaffUsrId(req.user.id);
    if (!staffUsrId) {
      return res.status(400).json({ ok: false, message: "Dosen tidak valid" });
    }

    const programStudiIds = await getKaprodiProgramStudiIds(staffUsrId);
    if (programStudiIds.length === 0) {
      return res
        .status(403)
        .json({ ok: false, message: "You are not assigned as Kaprodi" });
    }

    const statusParam = req.query?.status;
    const filterByStatus =
      statusParam && VALID_SK_STATUSES.includes(statusParam);

    const [rows] = await db.query(
      `SELECT
         sk.id,
         sk.outline_id,
         sk.status,
         sk.catatan_sekretariat,
         sk.submitted_at,
         sk.verified_at,
         sk.completed_at,
         sk.created_at,
         m.nama AS nama_mahasiswa,
         o.judul AS judul_skripsi,
         o.submission_period_id,
         o.program_studi_id,
         ps.nama AS program_studi_nama,
         EXISTS(
           SELECT 1 FROM pengajuan_sk_penelitian_files f
           WHERE f.pengajuan_sk_penelitian_id = sk.id AND f.file_type = 'SK_PENUNJUKAN_PEMBIMBING'
         ) AS has_sk_penunjukan_pembimbing,
         EXISTS(
           SELECT 1 FROM pengajuan_sk_penelitian_files f
           WHERE f.pengajuan_sk_penelitian_id = sk.id AND f.file_type = 'SURAT_KETERANGAN'
         ) AS has_surat_keterangan,
         EXISTS(
           SELECT 1 FROM pengajuan_sk_penelitian_files f
           WHERE f.pengajuan_sk_penelitian_id = sk.id AND f.file_type = 'SURAT_PENGANTAR_PENELITIAN'
         ) AS has_surat_pengantar_penelitian,
         EXISTS(
           SELECT 1 FROM pengajuan_sk_penelitian_files f
           WHERE f.pengajuan_sk_penelitian_id = sk.id AND f.file_type = 'SURAT_PENYELESAIAN_SKRIPSI'
         ) AS has_surat_penyelesaian_skripsi
       FROM pengajuan_sk_penelitian sk
       JOIN outline o ON o.id = sk.outline_id
       LEFT JOIN kartu_konsultasi_outline k ON k.outline_id = sk.outline_id
       LEFT JOIN mahasiswa m ON m.npm = o.npm
       LEFT JOIN program_studi ps ON ps.id = o.program_studi_id
       WHERE o.program_studi_id IN (?)
       ${filterByStatus ? "AND sk.status = ?" : ""}
       ORDER BY sk.submitted_at DESC`,
      filterByStatus ? [programStudiIds, statusParam] : [programStudiIds],
    );

    return res.json({ ok: true, data: rows });
  } catch (err) {
    next(err);
  }
};

exports.listSkForDekan = async (req, res, next) => {
  try {
    if (!req.user.hasRole("DEKAN")) {
      return res
        .status(403)
        .json({ ok: false, message: "Only dekan can access this endpoint" });
    }

    const [[userRow]] = await db.query(
      `SELECT COALESCE(nidn, staff_usr_id) AS nidn FROM users WHERE id = ? LIMIT 1`,
      [req.user.id],
    );
    if (!userRow?.nidn) {
      return res
        .status(403)
        .json({ ok: false, message: "Dekan NIDN tidak ditemukan" });
    }

    const statusParam = req.query?.status;
    const filterByStatus =
      statusParam && VALID_SK_STATUSES.includes(statusParam);

    const [rows] = await db.query(
      `SELECT
         sk.id,
         sk.outline_id,
         sk.status,
         sk.submitted_at,
         sk.completed_at,
         sk.created_at,
         m.nama AS nama_mahasiswa,
         o.judul AS judul_skripsi,
         ps.nama AS program_studi_nama,
         o.program_studi_id,
         (SELECT id FROM skripsi WHERE npm = o.npm ORDER BY id DESC LIMIT 1) AS skripsi_id,
         EXISTS(
           SELECT 1 FROM pengajuan_sk_penelitian_files f
           WHERE f.pengajuan_sk_penelitian_id = sk.id AND f.file_type = 'SK_PENUNJUKAN_PEMBIMBING'
         ) AS has_sk_document,
         EXISTS(
           SELECT 1 FROM revisi_pasca_sidang rps
           JOIN sidang sd ON sd.id = rps.sidang_id
           JOIN revisi_pasca_sidang_files rf ON rf.revisi_id = rps.id AND rf.file_type = 'HALAMAN_PENGESAHAN_DEKAN'
           WHERE sd.skripsi_id = (SELECT id FROM skripsi WHERE npm = o.npm ORDER BY id DESC LIMIT 1)
         ) AS has_halaman_pengesahan
       FROM pengajuan_sk_penelitian sk
       JOIN outline o ON o.id = sk.outline_id
       LEFT JOIN kartu_konsultasi_outline k ON k.outline_id = sk.outline_id
       LEFT JOIN mahasiswa m ON m.npm = o.npm
       LEFT JOIN program_studi ps ON ps.id = o.program_studi_id
       WHERE o.program_studi_id IN (
         SELECT id FROM program_studi WHERE fakultas_id = (
           SELECT id FROM fakultas WHERE COALESCE(dekan_nidn, dekan_staff_usr_id) = ?
         )
       )
       ${filterByStatus ? "AND sk.status = ?" : ""}
       ORDER BY sk.submitted_at DESC`,
      filterByStatus ? [userRow.nidn, statusParam] : [userRow.nidn],
    );

    return res.json({ ok: true, data: rows });
  } catch (err) {
    next(err);
  }
};
