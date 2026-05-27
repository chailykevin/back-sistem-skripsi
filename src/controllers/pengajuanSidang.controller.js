const db = require("../db");
const { insertNotification } = require("../utils/notify");
const path = require("path");
const { readFile } = require("fs/promises");
const { patchDocument, PatchType, TextRun, ImageRun } = require("docx");
const AdmZip = require("adm-zip");

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

const MIME_DOCX = "application/vnd.openxmlformats-officedocument.wordprocessingml.document";

const ANGKA_TERBILANG = ["", "satu", "dua", "tiga", "empat", "lima", "enam", "tujuh", "delapan", "sembilan", "sepuluh"];

function terbilang(n) {
  const i = Number(n);
  return ANGKA_TERBILANG[i] ?? String(i);
}

const BULAN_ID = ["Januari", "Februari", "Maret", "April", "Mei", "Juni", "Juli", "Agustus", "September", "Oktober", "November", "Desember"];

function formatTanggalIndonesia(date) {
  return `${date.getDate()} ${BULAN_ID[date.getMonth()]} ${date.getFullYear()}`;
}

function textPatch(value) {
  return { type: PatchType.PARAGRAPH, children: [new TextRun(String(value ?? ""))] };
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
      children: [new ImageRun({ type: decoded.type, data: decoded.buffer, transformation: { width: 120, height: 50 } })],
    };
  } catch (_) { return textPatch(""); }
}

async function buildLembarPermohonanUjianBuffer({
  todayDate, fakultas, namaMahasiswa, npm, ttl,
  prodi, tahunMasuk, alamat, noHp, noWa,
  statusPernikahan, judulSkripsi,
  ujianCount, ujianCountString, ipk, sks,
  ttdKaprodi, namaKaprodi, ttdMahasiswa,
}) {
  const templatePath = path.join(__dirname, "../templates/template_permohonan_ujian_skripsi.docx");
  const templateBuffer = await readFile(templatePath);
  const patches = {
    today_date:         textPatch(todayDate),
    fakultas:           textPatch(fakultas),
    nama_mahasiswa:     textPatch(namaMahasiswa),
    npm:                textPatch(npm),
    ttl:                textPatch(ttl),
    prodi:              textPatch(prodi),
    tahun_masuk:        textPatch(tahunMasuk),
    alamat:             textPatch(alamat),
    no_hp:              textPatch(noHp),
    no_wa:              textPatch(noWa),
    status:             textPatch(statusPernikahan),
    judul_skripsi:      textPatch(judulSkripsi),
    ujian_count:        textPatch(String(ujianCount)),
    ujian_count_string: textPatch(ujianCountString),
    ipk:                textPatch(String(ipk ?? "")),
    sks:                textPatch(String(sks ?? "")),
    ttd_kaprodi:        signatureImagePatch(ttdKaprodi),
    nama_kaprodi:       textPatch(namaKaprodi),
    ttd_mahasiswa:      signatureImagePatch(ttdMahasiswa),
  };
  const outputBuffer = await patchDocument({ outputType: "nodebuffer", data: templateBuffer, patches });
  return outputBuffer;
}

async function buildSuratPernyataanPerbaikanBuffer({
  namaMahasiswa, npm, alamat, noHp, judulSkripsi,
  fakultas, ttdKaprodi, namaKaprodi, prodi, ttdMahasiswa,
}) {
  const templatePath = path.join(__dirname, "../templates/template_pernyataan_perbaikan.docx");
  const templateBuffer = await readFile(templatePath);
  const patches = {
    nama_mahasiswa: textPatch(namaMahasiswa),
    npm:            textPatch(npm),
    alamat:         textPatch(alamat),
    no_hp:          textPatch(noHp),
    judul_skripsi:  textPatch(judulSkripsi),
    fakultas:       textPatch(fakultas),
    ttd_kaprodi:    signatureImagePatch(ttdKaprodi),
    nama_kaprodi:   textPatch(namaKaprodi),
    prodi:          textPatch(prodi),
    ttd_mahasiswa:  signatureImagePatch(ttdMahasiswa),
  };
  const outputBuffer = await patchDocument({ outputType: "nodebuffer", data: templateBuffer, patches });
  return outputBuffer;
}

async function buildSuratPernyataanKelengkapanBuffer({
  prodi, fakultas, namaMahasiswa, npm, todayDate, ttdMahasiswa,
}) {
  const templatePath = path.join(__dirname, "../templates/template_pernyataan_kelengkapan_dan_nilai_matkul.docx");
  const templateBuffer = await readFile(templatePath);
  const patches = {
    prodi:          textPatch(prodi),
    fakultas:       textPatch(fakultas),
    nama_mahasiswa: textPatch(namaMahasiswa),
    npm:            textPatch(npm),
    today_date:     textPatch(todayDate),
    ttd_mahasiswa:  signatureImagePatch(ttdMahasiswa),
  };
  const outputBuffer = await patchDocument({ outputType: "nodebuffer", data: templateBuffer, patches });
  return outputBuffer;
}

function injectHighlight(xml, name, cellIndex) {
  if (!name) return xml;
  const normalize = (s) => s.trim().replace(/\s+/g, " ").toLowerCase();
  const targetNorm = normalize(name);

  function highlightInXml(fragment) {
    const runRe = /<w:r\b[^>]*>[\s\S]*?<\/w:r>/g;
    const segments = [];
    let lastIndex = 0;
    let m;
    while ((m = runRe.exec(fragment)) !== null) {
      segments.push({ type: "gap", text: fragment.slice(lastIndex, m.index) });
      segments.push({ type: "run", text: m[0] });
      lastIndex = m.index + m[0].length;
    }
    segments.push({ type: "gap", text: fragment.slice(lastIndex) });

    const runs = segments.reduce((acc, seg, i) => {
      if (seg.type === "run") acc.push(i);
      return acc;
    }, []);

    function runText(segIndex) {
      const tMatch = segments[segIndex].text.match(/<w:t(?:[^>]*)>([\s\S]*?)<\/w:t>/);
      return tMatch ? tMatch[1] : "";
    }

    function addHighlightToRun(run) {
      if (run.includes("<w:highlight")) return run;
      if (run.includes("<w:rPr>")) {
        return run.replace("</w:rPr>", '<w:highlight w:val="yellow"/></w:rPr>');
      }
      return run.replace(/(<w:t(?:[^>]*)>)/, '<w:rPr><w:highlight w:val="yellow"/></w:rPr>$1');
    }

    let i = 0;
    while (i < runs.length) {
      let acc = "";
      let j = i;
      while (j < runs.length) {
        acc += runText(runs[j]).replace(/\s+/g, " ");
        const accNorm = normalize(acc);
        if (accNorm === targetNorm) {
          for (let k = i; k <= j; k++) {
            segments[runs[k]].text = addHighlightToRun(segments[runs[k]].text);
          }
          i = j + 1;
          break;
        }
        if (accNorm.length >= targetNorm.length) {
          i++;
          break;
        }
        j++;
      }
      if (j >= runs.length) i++;
    }

    return segments.map((s) => s.text).join("");
  }

  if (cellIndex === undefined) return highlightInXml(xml);

  return xml.replace(/(<w:tr\b[^>]*>)([\s\S]*?)(<\/w:tr>)/g, (_, open, rowContent, close) => {
    const cells = [...rowContent.matchAll(/<w:tc\b[^>]*>/g)];
    const totalCells = cells.length;
    let targetIdx;
    if (cellIndex === "UTAMA") {
      targetIdx = totalCells === 5 ? 1 : -1;
    } else if (cellIndex === "KEDUA") {
      targetIdx = totalCells >= 4 ? totalCells - 1 : -1;
    } else {
      targetIdx = cellIndex;
    }
    if (targetIdx < 0) return open + rowContent + close;
    let colCount = 0;
    const processedRow = rowContent.replace(/(<w:tc\b[^>]*>)([\s\S]*?)(<\/w:tc>)/g, (__, tcOpen, cellContent, tcClose) => {
      const idx = colCount++;
      const content = idx === targetIdx ? highlightInXml(cellContent) : cellContent;
      return tcOpen + content + tcClose;
    });
    return open + processedRow + close;
  });
}

async function buildLembarUsulanPengujiBuffer({
  prodi, fakultas, namaMahasiswa, npm,
  namaDospem1, namaDospem2, judul, todayDate,
  penguji1Nama, penguji2Nama, ttdMahasiswa, namaKaprodi,
}) {
  const templatePath = path.join(__dirname, "../templates/template_usulan_penguji.docx");
  const templateBuffer = await readFile(templatePath);
  const patches = {
    prodi:          textPatch(prodi),
    fakultas:       textPatch(fakultas),
    nama_mahasiswa: textPatch(namaMahasiswa),
    npm:            textPatch(npm),
    nama_dospem1:   textPatch(namaDospem1),
    nama_dospem2:   textPatch(namaDospem2),
    judul:          textPatch(judul),
    today_date:     textPatch(todayDate),
    ttd_mahasiswa:  signatureImagePatch(ttdMahasiswa),
    sidang_date:    textPatch(""),
    sidang_time:    textPatch(""),
    nama_penguji1:  textPatch(""),
    nama_penguji2:  textPatch(""),
    disposisi_date: textPatch(""),
    nama_kaprodi:   textPatch(namaKaprodi),
    ttd_kaprodi:    textPatch(""),
  };
  const patchedBuffer = await patchDocument({ outputType: "nodebuffer", data: templateBuffer, patches });
  const zip = new AdmZip(patchedBuffer);
  const docEntry = zip.getEntry("word/document.xml");
  if (docEntry) {
    let xml = docEntry.getData().toString("utf8");
    if (penguji1Nama) xml = injectHighlight(xml, penguji1Nama, "UTAMA");
    if (penguji2Nama) xml = injectHighlight(xml, penguji2Nama, "KEDUA");
    zip.updateFile("word/document.xml", Buffer.from(xml, "utf8"));
  }
  return zip.toBuffer();
}

const VALID_KAPRODI_STATUSES = ["DRAFT", "SUBMITTED", "NEED_REVISION", "VALID", "REJECTED"];

const ALL_FILE_TYPES = [
  "JUDUL_LUAR",
  "JUDUL_DALAM",
  "PERSETUJUAN_UJIAN",
  "ABSTRAK",
  "KATA_PENGANTAR",
  "DAFTAR_ISI",
  "DAFTAR_TABEL",
  "DAFTAR_GAMBAR",
  "DAFTAR_LAMPIRAN",
  "BAB_1_5",
  "DAFTAR_PUSTAKA",
  "RIWAYAT_HIDUP",
  "TIDAK_PLAGIAT",
  "HALAMAN_LAMPIRAN",
  "INDEKS",
  "SURAT_KETERANGAN_PENELITIAN",
  "SURAT_PERNYATAAN_TIDAK_PLAGIAT",
  "LEMBAR_USULAN_PENGUJI",
  "LEMBAR_PERMOHONAN_UJIAN",
  "PAS_FOTO",
  "KTM",
  "BUKTI_PEMBAYARAN",
  "LEMBAR_KONSULTASI_JURNAL",
  "KARTU_KONSULTASI_SKRIPSI",
  "SK_PEMBIMBING",
  "REKAP_NILAI",
  "SURAT_KETERANGAN_PERUSAHAAN",
  "SURAT_PERNYATAAN_PENYELESAIAN",
  "SURAT_PERNYATAAN_PERBAIKAN",
  "SURAT_PERNYATAAN_KELENGKAPAN",
  "KHS_1",
  "KHS_2",
  "KHS_3",
  "KHS_4",
  "KHS_5",
  "KHS_6",
  "KHS_7",
  "KHS_8",
  "FOTOCOPY_KONVERSI",
  "BUKTI_HADIR_SIDANG",
  "KARTU_KONSULTASI_PA",
  "KARTU_PRAKTIKUM",
  "SERTIFIKAT_POINT",
];

// Auto-pulled by system; mahasiswa cannot manually upload these
const SYSTEM_FILE_TYPES = [
  "KARTU_KONSULTASI_SKRIPSI", "SK_PEMBIMBING",
  "LEMBAR_PERMOHONAN_UJIAN", "SURAT_PERNYATAAN_PERBAIKAN",
  "SURAT_PERNYATAAN_KELENGKAPAN", "LEMBAR_USULAN_PENGUJI",
];

const OPTIONAL_FILE_TYPES = [
  "DAFTAR_LAMPIRAN",
  "HALAMAN_LAMPIRAN",
  "INDEKS",
  "KHS_8",
  "SURAT_KETERANGAN_PERUSAHAAN",
  "FOTOCOPY_KONVERSI",
  "SERTIFIKAT_POINT",
];

const REQUIRED_FILE_TYPES = ALL_FILE_TYPES.filter((t) => !OPTIONAL_FILE_TYPES.includes(t));

const VALID_SIDANG_STATUSES = ["DRAFT", "SUBMITTED", "NEED_REVISION", "VERIFIED", "REJECTED"];
const VALID_FILE_STATUSES = ["SUBMITTED", "NEED_REUPLOAD", "VERIFIED"];

// Returns the active (non-terminal) sidang or the most recent one
async function getActiveSidang(conn, pengajuanJudulId) {
  const [rows] = await conn.query(
    `SELECT * FROM pengajuan_sidang
     WHERE pengajuan_judul_id = ?
     ORDER BY
       CASE WHEN status NOT IN ('VERIFIED','REJECTED') THEN 0 ELSE 1 END ASC,
       created_at DESC
     LIMIT 1`,
    [pengajuanJudulId],
  );
  return rows[0] ?? null;
}

exports.initPengajuanSidang = async (req, res, next) => {
  try {
    if (req.user.userType !== "STUDENT") {
      return res.status(403).json({ ok: false, message: "Only students can initialize Pengajuan Sidang" });
    }

    const pengajuanJudulId = Number(req.params.pengajuanJudulId);
    if (!Number.isFinite(pengajuanJudulId) || pengajuanJudulId <= 0) {
      return res.status(400).json({ ok: false, message: "Invalid pengajuanJudulId" });
    }

    const npm = await getStudentNpm(req.user.id);
    if (!npm) {
      return res.status(400).json({ ok: false, message: "Mahasiswa tidak valid" });
    }

    const [[pjRow]] = await db.query(
      `SELECT id FROM pengajuan_judul WHERE id = ? LIMIT 1`,
      [pengajuanJudulId],
    );
    if (!pjRow) {
      return res.status(404).json({ ok: false, message: "Pengajuan judul tidak ditemukan" });
    }

    // Prerequisite: skripsi must be COMPLETED
    const [[skripsiRow]] = await db.query(
      `SELECT id FROM skripsi WHERE pengajuan_judul_id = ? AND status = 'COMPLETED' LIMIT 1`,
      [pengajuanJudulId],
    );
    if (!skripsiRow) {
      return res.status(400).json({ ok: false, message: "Konsultasi skripsi belum selesai" });
    }

    // Prerequisite: Kaprodi form must be VALID
    const [[kaprodiRow]] = await db.query(
      `SELECT id, status FROM pengajuan_sidang_kaprodi WHERE pengajuan_judul_id = ? LIMIT 1`,
      [pengajuanJudulId],
    );
    if (!kaprodiRow || kaprodiRow.status !== "VALID") {
      return res.status(400).json({ ok: false, message: "Pengajuan ke Kaprodi belum disetujui" });
    }

    // Block if there is already an active (non-terminal) sidang
    const [[activeRow]] = await db.query(
      `SELECT id, status, submitted_at FROM pengajuan_sidang
       WHERE pengajuan_judul_id = ? AND status NOT IN ('VERIFIED','REJECTED')
       LIMIT 1`,
      [pengajuanJudulId],
    );
    if (activeRow) {
      // System auto-created a DRAFT when student submitted kaprodi form — reuse it
      if (activeRow.status === "DRAFT" && !activeRow.submitted_at) {
        return res.status(200).json({ ok: true, message: "Pengajuan Sidang sudah ada", data: { id: activeRow.id } });
      }
      return res.status(409).json({ ok: false, message: "Masih ada Pengajuan Sidang yang aktif" });
    }

    const [ins] = await db.query(
      `INSERT INTO pengajuan_sidang (pengajuan_judul_id, status) VALUES (?, 'DRAFT')`,
      [pengajuanJudulId],
    );

    return res.status(201).json({ ok: true, message: "Pengajuan Sidang dibuat", data: { id: ins.insertId } });
  } catch (err) {
    next(err);
  }
};

exports.getPengajuanSidang = async (req, res, next) => {
  try {
    const pengajuanJudulId = Number(req.params.pengajuanJudulId);
    if (!Number.isFinite(pengajuanJudulId) || pengajuanJudulId <= 0) {
      return res.status(400).json({ ok: false, message: "Invalid pengajuanJudulId" });
    }

    const sidang = await getActiveSidang(db, pengajuanJudulId);
    if (!sidang) {
      return res.status(404).json({ ok: false, message: "Pengajuan Sidang tidak ditemukan" });
    }

    const [[mahasiswaInfo]] = await db.query(
      `SELECT
         m.npm,
         m.nama AS nama_mahasiswa,
         m.sks,
         ps.nama AS program_studi_nama,
         ps.id AS program_studi_id
       FROM mahasiswa m
       INNER JOIN pengajuan_judul pj ON pj.npm = m.npm AND pj.id = ?
       INNER JOIN program_studi ps ON ps.id = m.program_studi_id
       LIMIT 1`,
      [pengajuanJudulId],
    );

    const [files] = await db.query(
      `SELECT id, file_type, file_name, mime_type, source, status, created_at
       FROM pengajuan_sidang_files
       WHERE pengajuan_sidang_id = ?
       ORDER BY file_type ASC`,
      [sidang.id],
    );

    return res.json({ ok: true, data: { sidang, mahasiswa: mahasiswaInfo ?? null, files } });
  } catch (err) {
    next(err);
  }
};

exports.uploadFiles = async (req, res, next) => {
  try {
    if (req.user.userType !== "STUDENT") {
      return res.status(403).json({ ok: false, message: "Only students can upload files" });
    }

    const pengajuanJudulId = Number(req.params.pengajuanJudulId);
    if (!Number.isFinite(pengajuanJudulId) || pengajuanJudulId <= 0) {
      return res.status(400).json({ ok: false, message: "Invalid pengajuanJudulId" });
    }

    const { files } = req.body ?? {};
    if (!Array.isArray(files) || files.length === 0) {
      return res.status(400).json({ ok: false, message: "files harus berisi minimal 1 entri" });
    }

    for (const f of files) {
      if (!f?.fileType || !ALL_FILE_TYPES.includes(f.fileType)) {
        return res.status(400).json({
          ok: false,
          message: `fileType tidak valid: ${f?.fileType}. Harus salah satu dari: ${ALL_FILE_TYPES.join(", ")}`,
        });
      }
      if (SYSTEM_FILE_TYPES.includes(f.fileType)) {
        return res.status(400).json({
          ok: false,
          message: `${f.fileType} adalah file sistem dan tidak dapat diunggah secara manual`,
        });
      }
      if (!f?.fileContent || !String(f.fileContent).trim()) {
        return res.status(400).json({ ok: false, message: `fileContent wajib diisi untuk ${f.fileType}` });
      }
      if (!f?.fileName || !String(f.fileName).trim()) {
        return res.status(400).json({ ok: false, message: `fileName wajib diisi untuk ${f.fileType}` });
      }
    }

    const fileTypes = files.map((f) => f.fileType);
    if (new Set(fileTypes).size !== fileTypes.length) {
      return res.status(400).json({ ok: false, message: "fileType tidak boleh duplikat" });
    }

    const sidang = await getActiveSidang(db, pengajuanJudulId);
    if (!sidang) {
      return res.status(404).json({ ok: false, message: "Pengajuan Sidang tidak ditemukan" });
    }
    if (sidang.status !== "DRAFT" && sidang.status !== "NEED_REVISION") {
      return res.status(409).json({
        ok: false,
        message: "File hanya bisa diunggah saat status DRAFT atau NEED_REVISION",
      });
    }

    const conn = await db.getConnection();
    let txStarted = false;
    try {
      await conn.beginTransaction();
      txStarted = true;

      for (const f of files) {
        await conn.query(
          `DELETE FROM pengajuan_sidang_files WHERE pengajuan_sidang_id = ? AND file_type = ?`,
          [sidang.id, f.fileType],
        );
        await conn.query(
          `INSERT INTO pengajuan_sidang_files
             (pengajuan_sidang_id, file_type, file_name, mime_type, file_content, source, status)
           VALUES (?, ?, ?, ?, ?, 'UPLOADED', 'SUBMITTED')`,
          [sidang.id, f.fileType, String(f.fileName).trim(), f.mimeType ?? null, String(f.fileContent)],
        );
      }

      await conn.commit();
      txStarted = false;
    } catch (err) {
      try { if (txStarted) await conn.rollback(); } catch (_) {}
      throw err;
    } finally {
      conn.release();
    }

    const [updatedFiles] = await db.query(
      `SELECT id, file_type, file_name, mime_type, source, status, created_at
       FROM pengajuan_sidang_files
       WHERE pengajuan_sidang_id = ?
       ORDER BY file_type ASC`,
      [sidang.id],
    );

    return res.json({ ok: true, message: "File berhasil diunggah", data: { files: updatedFiles } });
  } catch (err) {
    next(err);
  }
};

exports.submitPengajuanSidang = async (req, res, next) => {
  const conn = await db.getConnection();
  let txStarted = false;
  try {
    if (req.user.userType !== "STUDENT") {
      return res.status(403).json({ ok: false, message: "Only students can submit Pengajuan Sidang" });
    }

    const pengajuanJudulId = Number(req.params.pengajuanJudulId);
    if (!Number.isFinite(pengajuanJudulId) || pengajuanJudulId <= 0) {
      return res.status(400).json({ ok: false, message: "Invalid pengajuanJudulId" });
    }

    const npm = await getStudentNpm(req.user.id);
    if (!npm) {
      return res.status(400).json({ ok: false, message: "Mahasiswa tidak valid" });
    }

    await conn.beginTransaction();
    txStarted = true;

    const [[sidang]] = await conn.query(
      `SELECT * FROM pengajuan_sidang
       WHERE pengajuan_judul_id = ? AND status NOT IN ('VERIFIED','REJECTED')
       ORDER BY created_at DESC LIMIT 1 FOR UPDATE`,
      [pengajuanJudulId],
    );
    if (!sidang) {
      await conn.rollback(); txStarted = false;
      return res.status(404).json({ ok: false, message: "Pengajuan Sidang tidak ditemukan" });
    }
    if (sidang.status !== "DRAFT" && sidang.status !== "NEED_REVISION") {
      await conn.rollback(); txStarted = false;
      return res.status(409).json({
        ok: false,
        message: "Pengajuan Sidang hanya bisa disubmit saat status DRAFT atau NEED_REVISION",
      });
    }

    // Validate all required files are present (uploaded by student)
    const [existingFiles] = await conn.query(
      `SELECT file_type FROM pengajuan_sidang_files WHERE pengajuan_sidang_id = ?`,
      [sidang.id],
    );
    const existingTypes = new Set(existingFiles.map((f) => f.file_type));

    // Required files that must be uploaded by mahasiswa (excluding system-pulled ones)
    const requiredUploads = REQUIRED_FILE_TYPES.filter((t) => !SYSTEM_FILE_TYPES.includes(t));
    const missingUploads = requiredUploads.filter((t) => !existingTypes.has(t));
    if (missingUploads.length > 0) {
      await conn.rollback(); txStarted = false;
      return res.status(400).json({
        ok: false,
        message: `File berikut belum diunggah: ${missingUploads.join(", ")}`,
      });
    }

    // Auto-pull KARTU_KONSULTASI_SKRIPSI
    const [[kartuSkripsi]] = await conn.query(
      `SELECT k.id FROM kartu_konsultasi_skripsi k WHERE k.pengajuan_judul_id = ? LIMIT 1`,
      [pengajuanJudulId],
    );
    if (!kartuSkripsi) {
      await conn.rollback(); txStarted = false;
      return res.status(400).json({ ok: false, message: "Kartu konsultasi skripsi tidak ditemukan" });
    }

    const [[kartuSkripsiFile]] = await conn.query(
      `SELECT file_content, file_name
       FROM kartu_konsultasi_skripsi_file
       WHERE kartu_konsultasi_skripsi_id = ? AND is_active = 1 AND file_type = 'FINAL_DOCX'
       ORDER BY generated_at DESC LIMIT 1`,
      [kartuSkripsi.id],
    );
    if (!kartuSkripsiFile) {
      await conn.rollback(); txStarted = false;
      return res.status(400).json({ ok: false, message: "File kartu konsultasi skripsi belum digenerate" });
    }

    await conn.query(
      `DELETE FROM pengajuan_sidang_files WHERE pengajuan_sidang_id = ? AND file_type = 'KARTU_KONSULTASI_SKRIPSI'`,
      [sidang.id],
    );
    await conn.query(
      `INSERT INTO pengajuan_sidang_files
         (pengajuan_sidang_id, file_type, file_name, mime_type, file_content, source, status)
       VALUES (?, 'KARTU_KONSULTASI_SKRIPSI', ?, ?, ?, 'SYSTEM', 'SUBMITTED')`,
      [sidang.id, kartuSkripsiFile.file_name,
        "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
        kartuSkripsiFile.file_content],
    );

    // Auto-pull SK_PEMBIMBING from pengajuan_sk_penelitian_files
    const [[skPembimbingRow]] = await conn.query(
      `SELECT f.file_content, f.file_name, f.mime_type
       FROM pengajuan_sk_penelitian_files f
       INNER JOIN pengajuan_sk_penelitian psk ON psk.id = f.pengajuan_sk_penelitian_id
       WHERE psk.pengajuan_judul_id = ? AND f.file_type = 'SK_PENUNJUKAN_PEMBIMBING'
       ORDER BY f.created_at DESC LIMIT 1`,
      [pengajuanJudulId],
    );
    if (!skPembimbingRow) {
      await conn.rollback(); txStarted = false;
      return res.status(400).json({ ok: false, message: "File SK Pembimbing tidak ditemukan" });
    }

    await conn.query(
      `DELETE FROM pengajuan_sidang_files WHERE pengajuan_sidang_id = ? AND file_type = 'SK_PEMBIMBING'`,
      [sidang.id],
    );
    await conn.query(
      `INSERT INTO pengajuan_sidang_files
         (pengajuan_sidang_id, file_type, file_name, mime_type, file_content, source, status)
       VALUES (?, 'SK_PEMBIMBING', ?, ?, ?, 'SYSTEM', 'SUBMITTED')`,
      [sidang.id, skPembimbingRow.file_name, skPembimbingRow.mime_type ?? null, skPembimbingRow.file_content],
    );

    await conn.query(
      `UPDATE pengajuan_sidang
       SET status = 'SUBMITTED', submitted_at = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP
       WHERE id = ?`,
      [sidang.id],
    );

    const [[mahasiswaRow]] = await conn.query(
      `SELECT m.nama FROM mahasiswa m WHERE m.npm = ? LIMIT 1`,
      [npm],
    );
    const namaMahasiswa = mahasiswaRow?.nama ?? npm;
    const [sekRows] = await conn.query(
      `SELECT u.id FROM users u
       JOIN user_roles ur ON ur.user_id = u.id
       JOIN roles r ON r.id = ur.role_id
       WHERE r.code = 'SEKRETARIAT'`,
    );
    for (const sek of sekRows) {
      await insertNotification(
        conn, sek.id, "SIDANG_SUBMITTED",
        `Mahasiswa ${namaMahasiswa} mengajukan Sidang Skripsi`,
        "/sekretariat/pengajuan-sidang",
      );
    }

    await conn.commit();
    txStarted = false;

    return res.json({ ok: true, message: "Pengajuan Sidang berhasil disubmit" });
  } catch (err) {
    try { if (txStarted) await conn.rollback(); } catch (_) {}
    next(err);
  } finally {
    conn.release();
  }
};

exports.reviewFile = async (req, res, next) => {
  const conn = await db.getConnection();
  let txStarted = false;
  try {
    if (!req.user.hasRole("SEKRETARIAT")) {
      return res.status(403).json({ ok: false, message: "Only sekretariat can review files" });
    }

    const pengajuanJudulId = Number(req.params.pengajuanJudulId);
    if (!Number.isFinite(pengajuanJudulId) || pengajuanJudulId <= 0) {
      return res.status(400).json({ ok: false, message: "Invalid pengajuanJudulId" });
    }

    const fileType = req.params.fileType;
    if (!ALL_FILE_TYPES.includes(fileType)) {
      return res.status(400).json({
        ok: false,
        message: `fileType tidak valid: ${fileType}`,
      });
    }

    const { status } = req.body ?? {};
    if (!VALID_FILE_STATUSES.includes(status)) {
      return res.status(400).json({
        ok: false,
        message: `status harus salah satu dari: ${VALID_FILE_STATUSES.join(", ")}`,
      });
    }

    await conn.beginTransaction();
    txStarted = true;

    const [[sidang]] = await conn.query(
      `SELECT * FROM pengajuan_sidang
       WHERE pengajuan_judul_id = ? AND status NOT IN ('VERIFIED','REJECTED')
       ORDER BY created_at DESC LIMIT 1 FOR UPDATE`,
      [pengajuanJudulId],
    );
    if (!sidang) {
      await conn.rollback(); txStarted = false;
      return res.status(404).json({ ok: false, message: "Pengajuan Sidang tidak ditemukan" });
    }
    if (sidang.status !== "SUBMITTED" && sidang.status !== "NEED_REVISION") {
      await conn.rollback(); txStarted = false;
      return res.status(409).json({
        ok: false,
        message: "Review file hanya bisa dilakukan saat status SUBMITTED atau NEED_REVISION",
      });
    }

    const [[fileRow]] = await conn.query(
      `SELECT id FROM pengajuan_sidang_files WHERE pengajuan_sidang_id = ? AND file_type = ? LIMIT 1`,
      [sidang.id, fileType],
    );
    if (!fileRow) {
      await conn.rollback(); txStarted = false;
      return res.status(404).json({ ok: false, message: `File ${fileType} tidak ditemukan` });
    }

    await conn.query(
      `UPDATE pengajuan_sidang_files SET status = ? WHERE id = ?`,
      [status, fileRow.id],
    );

    await conn.commit();
    txStarted = false;

    return res.json({ ok: true, message: `Status file ${fileType} diperbarui` });
  } catch (err) {
    try { if (txStarted) await conn.rollback(); } catch (_) {}
    next(err);
  } finally {
    conn.release();
  }
};

exports.finalizePengajuanSidang = async (req, res, next) => {
  const conn = await db.getConnection();
  let txStarted = false;
  try {
    if (!req.user.hasRole("SEKRETARIAT")) {
      return res.status(403).json({ ok: false, message: "Only sekretariat can finalize Pengajuan Sidang" });
    }

    const pengajuanJudulId = Number(req.params.pengajuanJudulId);
    if (!Number.isFinite(pengajuanJudulId) || pengajuanJudulId <= 0) {
      return res.status(400).json({ ok: false, message: "Invalid pengajuanJudulId" });
    }

    const { action, catatanSekretariat } = req.body ?? {};
    if (action !== "VERIFY" && action !== "REJECT" && action !== "NEED_REVISION") {
      return res.status(400).json({ ok: false, message: "action harus 'VERIFY', 'REJECT', atau 'NEED_REVISION'" });
    }
    if ((action === "REJECT" || action === "NEED_REVISION") && (!catatanSekretariat || !String(catatanSekretariat).trim())) {
      return res.status(400).json({ ok: false, message: "catatanSekretariat wajib diisi" });
    }

    await conn.beginTransaction();
    txStarted = true;

    const [[sidang]] = await conn.query(
      `SELECT * FROM pengajuan_sidang
       WHERE pengajuan_judul_id = ? AND status NOT IN ('VERIFIED','REJECTED')
       ORDER BY created_at DESC LIMIT 1 FOR UPDATE`,
      [pengajuanJudulId],
    );
    if (!sidang) {
      await conn.rollback(); txStarted = false;
      return res.status(404).json({ ok: false, message: "Pengajuan Sidang tidak ditemukan" });
    }
    if (sidang.status !== "SUBMITTED") {
      await conn.rollback(); txStarted = false;
      return res.status(409).json({
        ok: false,
        message: "Pengajuan Sidang harus berstatus SUBMITTED untuk difinalisasi",
      });
    }

    if (action === "NEED_REVISION") {
      await conn.query(
        `UPDATE pengajuan_sidang
         SET status = 'NEED_REVISION',
             catatan_sekretariat = ?,
             updated_at = CURRENT_TIMESTAMP
         WHERE id = ?`,
        [String(catatanSekretariat).trim(), sidang.id],
      );
      const [[studentRow]] = await conn.query(
        `SELECT u.id FROM users u
         INNER JOIN mahasiswa m ON m.npm = u.npm
         INNER JOIN pengajuan_judul pj ON pj.npm = m.npm AND pj.id = ?
         WHERE u.is_active = 1
         LIMIT 1`,
        [pengajuanJudulId],
      );
      if (studentRow) {
        await insertNotification(conn, studentRow.id, "SIDANG_NEED_REVISION",
          "Sekretariat meminta Anda mengunggah ulang dokumen pengajuan sidang", "/student/pengajuan-sidang");
      }
      await conn.commit();
      txStarted = false;
      return res.json({ ok: true, message: "Pengajuan Sidang dikembalikan untuk revisi" });
    }

    if (action === "VERIFY") {
      // All required files must be VERIFIED
      const [fileRows] = await conn.query(
        `SELECT file_type, status FROM pengajuan_sidang_files WHERE pengajuan_sidang_id = ?`,
        [sidang.id],
      );
      const fileMap = Object.fromEntries(fileRows.map((f) => [f.file_type, f.status]));

      const unverified = REQUIRED_FILE_TYPES.filter(
        (t) => !SYSTEM_FILE_TYPES.includes(t) && fileMap[t] !== "VERIFIED",
      );

      if (unverified.length > 0) {
        await conn.rollback(); txStarted = false;
        return res.status(400).json({
          ok: false,
          message: `File berikut belum diverifikasi: ${unverified.join(", ")}`,
        });
      }

      await conn.query(
        `UPDATE pengajuan_sidang
         SET status = 'VERIFIED',
             catatan_sekretariat = ?,
             verified_by_user_id = ?,
             verified_at = CURRENT_TIMESTAMP,
             updated_at = CURRENT_TIMESTAMP
         WHERE id = ?`,
        [catatanSekretariat ? String(catatanSekretariat).trim() : null, req.user.id, sidang.id],
      );

      // Notify mahasiswa
      const [[studentRow]] = await conn.query(
        `SELECT u.id FROM users u
         INNER JOIN mahasiswa m ON m.npm = u.npm
         INNER JOIN pengajuan_judul pj ON pj.npm = m.npm AND pj.id = ?
         WHERE u.is_active = 1
         LIMIT 1`,
        [pengajuanJudulId],
      );
      if (studentRow) {
        await insertNotification(conn, studentRow.id, "SIDANG_VERIFIED",
          "Pengajuan Sidang Skripsi Anda telah diverifikasi", "/student/pengajuan-sidang");
      }

      await conn.commit();
      txStarted = false;
      return res.json({ ok: true, message: "Pengajuan Sidang berhasil diverifikasi" });
    }

    // REJECT
    await conn.query(
      `UPDATE pengajuan_sidang
       SET status = 'REJECTED',
           catatan_sekretariat = ?,
           verified_by_user_id = ?,
           verified_at = CURRENT_TIMESTAMP,
           updated_at = CURRENT_TIMESTAMP
       WHERE id = ?`,
      [String(catatanSekretariat).trim(), req.user.id, sidang.id],
    );

    const [[studentRow]] = await conn.query(
      `SELECT u.id FROM users u
       INNER JOIN mahasiswa m ON m.npm = u.npm
       INNER JOIN pengajuan_judul pj ON pj.npm = m.npm AND pj.id = ?
       WHERE u.is_active = 1
       LIMIT 1`,
      [pengajuanJudulId],
    );
    if (studentRow) {
      await insertNotification(conn, studentRow.id, "SIDANG_REJECTED",
        "Pengajuan Sidang Skripsi Anda ditolak", "/student/pengajuan-sidang");
    }

    await conn.commit();
    txStarted = false;
    return res.json({ ok: true, message: "Pengajuan Sidang ditolak" });
  } catch (err) {
    try { if (txStarted) await conn.rollback(); } catch (_) {}
    next(err);
  } finally {
    conn.release();
  }
};

exports.getFile = async (req, res, next) => {
  try {
    const pengajuanJudulId = Number(req.params.pengajuanJudulId);
    if (!Number.isFinite(pengajuanJudulId) || pengajuanJudulId <= 0) {
      return res.status(400).json({ ok: false, message: "Invalid pengajuanJudulId" });
    }

    const fileType = req.params.fileType;
    if (!ALL_FILE_TYPES.includes(fileType)) {
      return res.status(400).json({
        ok: false,
        message: `fileType tidak valid: ${fileType}`,
      });
    }

    const sidang = await getActiveSidang(db, pengajuanJudulId);
    if (!sidang) {
      return res.status(404).json({ ok: false, message: "Pengajuan Sidang tidak ditemukan" });
    }

    const [[file]] = await db.query(
      `SELECT id, file_type, file_name, mime_type, file_content, source, status, created_at
       FROM pengajuan_sidang_files
       WHERE pengajuan_sidang_id = ? AND file_type = ?
       ORDER BY created_at DESC LIMIT 1`,
      [sidang.id, fileType],
    );
    if (!file) {
      return res.status(404).json({ ok: false, message: `File ${fileType} tidak ditemukan` });
    }

    return res.json({ ok: true, data: file });
  } catch (err) {
    next(err);
  }
};

exports.listForSekretariat = async (req, res, next) => {
  try {
    if (!req.user.hasRole("SEKRETARIAT")) {
      return res.status(403).json({ ok: false, message: "Only sekretariat can access this endpoint" });
    }

    const statusParam = req.query?.status;
    const programStudiIdParam = Number(req.query?.programStudiId);
    const filterByStatus = statusParam && VALID_SIDANG_STATUSES.includes(statusParam);
    const filterByProdi = Number.isFinite(programStudiIdParam) && programStudiIdParam > 0;

    const conditions = [];
    const params = [];
    if (filterByStatus) {
      conditions.push("ps.status = ?");
      params.push(statusParam);
    }
    if (filterByProdi) {
      conditions.push("k.program_studi_id = ?");
      params.push(programStudiIdParam);
    }

    const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "";

    const [rows] = await db.query(
      `SELECT
         ps.id,
         ps.pengajuan_judul_id,
         ps.status,
         ps.catatan_sekretariat,
         ps.submitted_at,
         ps.verified_at,
         ps.created_at,
         k.nama_mahasiswa,
         k.npm,
         k.program_studi_id,
         k.program_studi_nama
       FROM pengajuan_sidang ps
       LEFT JOIN kartu_konsultasi_outline k ON k.pengajuan_judul_id = ps.pengajuan_judul_id
       ${whereClause}
       ORDER BY ps.submitted_at DESC`,
      params,
    );

    return res.json({ ok: true, data: rows });
  } catch (err) {
    next(err);
  }
};

// ─── Pengajuan Sidang Kaprodi ────────────────────────────────────────────────

exports.initKaprodi = async (req, res, next) => {
  try {
    if (req.user.userType !== "STUDENT") {
      return res.status(403).json({ ok: false, message: "Only students can initialize Pengajuan Sidang Kaprodi" });
    }

    const pengajuanJudulId = Number(req.params.pengajuanJudulId);
    if (!Number.isFinite(pengajuanJudulId) || pengajuanJudulId <= 0) {
      return res.status(400).json({ ok: false, message: "Invalid pengajuanJudulId" });
    }

    const npm = await getStudentNpm(req.user.id);
    if (!npm) {
      return res.status(400).json({ ok: false, message: "Mahasiswa tidak valid" });
    }

    const [[pjRow]] = await db.query(
      `SELECT id FROM pengajuan_judul WHERE id = ? LIMIT 1`,
      [pengajuanJudulId],
    );
    if (!pjRow) {
      return res.status(404).json({ ok: false, message: "Pengajuan judul tidak ditemukan" });
    }

    const [[skripsiRow]] = await db.query(
      `SELECT id FROM skripsi WHERE pengajuan_judul_id = ? AND status = 'COMPLETED' LIMIT 1`,
      [pengajuanJudulId],
    );
    if (!skripsiRow) {
      return res.status(400).json({ ok: false, message: "Konsultasi skripsi belum selesai" });
    }

    const [[existing]] = await db.query(
      `SELECT id FROM pengajuan_sidang_kaprodi WHERE pengajuan_judul_id = ? LIMIT 1`,
      [pengajuanJudulId],
    );
    if (existing) {
      return res.status(409).json({ ok: false, message: "Pengajuan Sidang Kaprodi sudah dibuat" });
    }

    const [ins] = await db.query(
      `INSERT INTO pengajuan_sidang_kaprodi (pengajuan_judul_id, status) VALUES (?, 'DRAFT')`,
      [pengajuanJudulId],
    );

    return res.status(201).json({ ok: true, message: "Pengajuan Sidang Kaprodi dibuat", data: { id: ins.insertId } });
  } catch (err) {
    next(err);
  }
};

exports.getKaprodi = async (req, res, next) => {
  try {
    const pengajuanJudulId = Number(req.params.pengajuanJudulId);
    if (!Number.isFinite(pengajuanJudulId) || pengajuanJudulId <= 0) {
      return res.status(400).json({ ok: false, message: "Invalid pengajuanJudulId" });
    }

    const [[kaprodi]] = await db.query(
      `SELECT * FROM pengajuan_sidang_kaprodi WHERE pengajuan_judul_id = ? LIMIT 1`,
      [pengajuanJudulId],
    );
    if (!kaprodi) {
      return res.status(404).json({ ok: false, message: "Pengajuan Sidang Kaprodi tidak ditemukan" });
    }

    const [[autoData]] = await db.query(
      `SELECT
         m.npm,
         m.nama AS nama_mahasiswa,
         m.sks,
         ps.nama AS program_studi_nama,
         ps.id AS program_studi_id,
         k.judul_skripsi,
         k.pembimbing1_nidn,
         k.pembimbing1_nama,
         k.pembimbing2_nidn,
         k.pembimbing2_nama
       FROM pengajuan_judul pj
       INNER JOIN mahasiswa m ON m.npm = pj.npm
       INNER JOIN program_studi ps ON ps.id = m.program_studi_id
       LEFT JOIN kartu_konsultasi_outline k ON k.pengajuan_judul_id = pj.id
       WHERE pj.id = ?
       LIMIT 1`,
      [pengajuanJudulId],
    );

    const tahunMasuk = autoData?.npm ? "20" + String(autoData.npm).substring(0, 2) : null;

    return res.json({
      ok: true,
      data: {
        kaprodi,
        auto: autoData
          ? {
              npm: autoData.npm,
              nama_mahasiswa: autoData.nama_mahasiswa,
              sks: autoData.sks,
              program_studi_id: autoData.program_studi_id,
              program_studi_nama: autoData.program_studi_nama,
              judul_skripsi: autoData.judul_skripsi,
              pembimbing1_nidn: autoData.pembimbing1_nidn,
              pembimbing1_nama: autoData.pembimbing1_nama,
              pembimbing2_nidn: autoData.pembimbing2_nidn,
              pembimbing2_nama: autoData.pembimbing2_nama,
              tahun_masuk: tahunMasuk,
            }
          : null,
      },
    });
  } catch (err) {
    next(err);
  }
};

exports.updateKaprodi = async (req, res, next) => {
  try {
    if (req.user.userType !== "STUDENT") {
      return res.status(403).json({ ok: false, message: "Only students can update Pengajuan Sidang Kaprodi" });
    }

    const pengajuanJudulId = Number(req.params.pengajuanJudulId);
    if (!Number.isFinite(pengajuanJudulId) || pengajuanJudulId <= 0) {
      return res.status(400).json({ ok: false, message: "Invalid pengajuanJudulId" });
    }

    const [[kaprodi]] = await db.query(
      `SELECT * FROM pengajuan_sidang_kaprodi WHERE pengajuan_judul_id = ? LIMIT 1`,
      [pengajuanJudulId],
    );
    if (!kaprodi) {
      return res.status(404).json({ ok: false, message: "Pengajuan Sidang Kaprodi tidak ditemukan" });
    }
    if (kaprodi.status !== "DRAFT" && kaprodi.status !== "NEED_REVISION") {
      return res.status(409).json({
        ok: false,
        message: "Data hanya bisa diubah saat status DRAFT atau NEED_REVISION",
      });
    }

    const {
      tempatLahir, tglLahir, alamat, noHp, noWa,
      statusPernikahan,
      ujianKe, ipk, semuaMkLulus,
      penguji1Nama, penguji1Nidn, penguji2Nama, penguji2Nidn,
    } = req.body ?? {};

    const setClauses = [];
    const params = [];

    if (tempatLahir !== undefined) { setClauses.push("tempat_lahir = ?"); params.push(String(tempatLahir).trim() || null); }
    if (tglLahir !== undefined) { setClauses.push("tgl_lahir = ?"); params.push(tglLahir || null); }
    if (alamat !== undefined) { setClauses.push("alamat = ?"); params.push(String(alamat).trim() || null); }
    if (noHp !== undefined) { setClauses.push("no_hp = ?"); params.push(String(noHp).trim() || null); }
    if (noWa !== undefined) { setClauses.push("no_wa = ?"); params.push(String(noWa).trim() || null); }
    if (statusPernikahan !== undefined) {
      setClauses.push("status_pernikahan = ?");
      params.push(statusPernikahan === "Belum Menikah" || statusPernikahan === "Sudah Menikah" ? statusPernikahan : null);
    }
    if (ujianKe !== undefined) { setClauses.push("ujian_ke = ?"); params.push(Number(ujianKe) || null); }
    if (ipk !== undefined) { setClauses.push("ipk = ?"); params.push(ipk !== null && ipk !== "" ? Number(ipk) : null); }
    if (semuaMkLulus !== undefined) { setClauses.push("semua_mk_lulus = ?"); params.push(semuaMkLulus ? 1 : 0); }
    if (penguji1Nama !== undefined) { setClauses.push("penguji1_nama = ?"); params.push(String(penguji1Nama).trim() || null); }
    if (penguji1Nidn !== undefined) { setClauses.push("penguji1_nidn = ?"); params.push(String(penguji1Nidn).trim() || null); }
    if (penguji2Nama !== undefined) { setClauses.push("penguji2_nama = ?"); params.push(String(penguji2Nama).trim() || null); }
    if (penguji2Nidn !== undefined) { setClauses.push("penguji2_nidn = ?"); params.push(String(penguji2Nidn).trim() || null); }

    if (setClauses.length === 0) {
      return res.status(400).json({ ok: false, message: "Tidak ada field yang diupdate" });
    }

    params.push(kaprodi.id);
    await db.query(
      `UPDATE pengajuan_sidang_kaprodi SET ${setClauses.join(", ")}, updated_at = CURRENT_TIMESTAMP WHERE id = ?`,
      params,
    );

    const [[updated]] = await db.query(
      `SELECT * FROM pengajuan_sidang_kaprodi WHERE id = ? LIMIT 1`,
      [kaprodi.id],
    );

    return res.json({ ok: true, message: "Data berhasil diperbarui", data: updated });
  } catch (err) {
    next(err);
  }
};

exports.submitKaprodi = async (req, res, next) => {
  const conn = await db.getConnection();
  let txStarted = false;
  try {
    if (req.user.userType !== "STUDENT") {
      return res.status(403).json({ ok: false, message: "Only students can submit Pengajuan Sidang Kaprodi" });
    }

    const pengajuanJudulId = Number(req.params.pengajuanJudulId);
    if (!Number.isFinite(pengajuanJudulId) || pengajuanJudulId <= 0) {
      return res.status(400).json({ ok: false, message: "Invalid pengajuanJudulId" });
    }

    const npm = await getStudentNpm(req.user.id);
    if (!npm) {
      return res.status(400).json({ ok: false, message: "Mahasiswa tidak valid" });
    }

    await conn.beginTransaction();
    txStarted = true;

    const [[kaprodi]] = await conn.query(
      `SELECT * FROM pengajuan_sidang_kaprodi WHERE pengajuan_judul_id = ? LIMIT 1 FOR UPDATE`,
      [pengajuanJudulId],
    );
    if (!kaprodi) {
      await conn.rollback(); txStarted = false;
      return res.status(404).json({ ok: false, message: "Pengajuan Sidang Kaprodi tidak ditemukan" });
    }
    if (kaprodi.status !== "DRAFT" && kaprodi.status !== "NEED_REVISION") {
      await conn.rollback(); txStarted = false;
      return res.status(409).json({
        ok: false,
        message: "Pengajuan Sidang Kaprodi hanya bisa disubmit saat status DRAFT atau NEED_REVISION",
      });
    }

    const missingFields = [];
    if (!kaprodi.tempat_lahir) missingFields.push("tempatLahir");
    if (!kaprodi.tgl_lahir) missingFields.push("tglLahir");
    if (!kaprodi.alamat) missingFields.push("alamat");
    if (!kaprodi.no_hp) missingFields.push("noHp");
    if (!kaprodi.no_wa) missingFields.push("noWa");
    if (kaprodi.ujian_ke == null) missingFields.push("ujianKe");
    if (kaprodi.ipk == null) missingFields.push("ipk");
    if (!kaprodi.penguji1_nama) missingFields.push("penguji1Nama");
    if (!kaprodi.penguji1_nidn) missingFields.push("penguji1Nidn");
    if (!kaprodi.penguji2_nama) missingFields.push("penguji2Nama");
    if (!kaprodi.penguji2_nidn) missingFields.push("penguji2Nidn");
    if (!kaprodi.status_pernikahan) missingFields.push("statusPernikahan");
    if (missingFields.length > 0) {
      await conn.rollback(); txStarted = false;
      return res.status(400).json({ ok: false, message: `Field berikut belum diisi: ${missingFields.join(", ")}` });
    }
    if (!kaprodi.semua_mk_lulus) {
      await conn.rollback(); txStarted = false;
      return res.status(400).json({ ok: false, message: "Konfirmasi seluruh mata kuliah sudah lulus harus dicentang" });
    }

    await conn.query(
      `UPDATE pengajuan_sidang_kaprodi
       SET status = 'SUBMITTED', submitted_at = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP
       WHERE id = ?`,
      [kaprodi.id],
    );

    // Generate LEMBAR_PERMOHONAN_UJIAN
    const [[docData]] = await conn.query(
      `SELECT
         m.npm, m.nama AS nama_mahasiswa, m.sks,
         ps.nama AS prodi_nama,
         f.nama AS fakultas_nama,
         k.judul_skripsi,
         k.pembimbing1_nama AS dospem1_nama,
         k.pembimbing2_nama AS dospem2_nama,
         u_kaprodi.signature_image AS kaprodi_sig,
         d_kaprodi.nama AS nama_kaprodi,
         u_mhs.signature_image AS mahasiswa_sig
       FROM pengajuan_judul pj
       INNER JOIN mahasiswa m ON m.npm = pj.npm
       INNER JOIN program_studi ps ON ps.id = m.program_studi_id
       LEFT JOIN fakultas f ON f.id = ps.fakultas_id
       LEFT JOIN kartu_konsultasi_outline k ON k.pengajuan_judul_id = pj.id
       LEFT JOIN users u_kaprodi ON u_kaprodi.nidn = ps.kaprodi_nidn
         AND u_kaprodi.is_active = 1
         AND EXISTS (
           SELECT 1 FROM user_roles ur2
           INNER JOIN roles r2 ON r2.id = ur2.role_id
           WHERE ur2.user_id = u_kaprodi.id AND r2.code = 'KAPRODI'
         )
       LEFT JOIN dosen d_kaprodi ON d_kaprodi.nidn = ps.kaprodi_nidn
       LEFT JOIN users u_mhs ON u_mhs.npm = m.npm AND u_mhs.is_active = 1
       WHERE pj.id = ? LIMIT 1`,
      [pengajuanJudulId],
    );

    const todayDate = formatTanggalIndonesia(new Date());
    const tahunMasuk = docData?.npm ? "20" + String(docData.npm).substring(0, 2) : "";
    const tglLahirFormatted = kaprodi.tgl_lahir ? formatTanggalIndonesia(new Date(kaprodi.tgl_lahir)) : "";
    const ttl = `${kaprodi.tempat_lahir ?? ""}, ${tglLahirFormatted}`;
    const ujianCount = kaprodi.ujian_ke ?? 1;
    const ujianCountString = terbilang(ujianCount);
    const namaKaprodi = docData?.nama_kaprodi ?? "";

    const lembarBuffer = await buildLembarPermohonanUjianBuffer({
      todayDate,
      fakultas: docData?.fakultas_nama ?? "",
      namaMahasiswa: docData?.nama_mahasiswa ?? npm,
      npm: docData?.npm ?? npm,
      ttl,
      prodi: docData?.prodi_nama ?? "",
      tahunMasuk,
      alamat: kaprodi.alamat ?? "",
      noHp: kaprodi.no_hp ?? "",
      noWa: kaprodi.no_wa ?? "",
      statusPernikahan: kaprodi.status_pernikahan ?? "",
      judulSkripsi: docData?.judul_skripsi ?? "",
      ujianCount,
      ujianCountString,
      ipk: kaprodi.ipk,
      sks: docData?.sks,
      ttdKaprodi: docData?.kaprodi_sig ?? null,
      namaKaprodi,
      ttdMahasiswa: docData?.mahasiswa_sig ?? null,
    });
    const lembarBase64 = lembarBuffer.toString("base64");

    // Auto-create pengajuan_sidang DRAFT if none exists, then upsert the file
    let [[existingSidang]] = await conn.query(
      `SELECT id FROM pengajuan_sidang
       WHERE pengajuan_judul_id = ? AND status NOT IN ('VERIFIED','REJECTED')
       ORDER BY created_at DESC LIMIT 1`,
      [pengajuanJudulId],
    );
    if (!existingSidang) {
      const [ins] = await conn.query(
        `INSERT INTO pengajuan_sidang (pengajuan_judul_id, status) VALUES (?, 'DRAFT')`,
        [pengajuanJudulId],
      );
      existingSidang = { id: ins.insertId };
    }

    await conn.query(
      `DELETE FROM pengajuan_sidang_files WHERE pengajuan_sidang_id = ? AND file_type = 'LEMBAR_PERMOHONAN_UJIAN'`,
      [existingSidang.id],
    );
    await conn.query(
      `INSERT INTO pengajuan_sidang_files
         (pengajuan_sidang_id, file_type, file_name, mime_type, file_content, source, status)
       VALUES (?, 'LEMBAR_PERMOHONAN_UJIAN', ?, ?, ?, 'SYSTEM', 'SUBMITTED')`,
      [existingSidang.id, `Lembar_Permohonan_Ujian_${npm}.docx`, MIME_DOCX, lembarBase64],
    );

    // Generate SURAT_PERNYATAAN_PERBAIKAN
    const perbaikanBuffer = await buildSuratPernyataanPerbaikanBuffer({
      namaMahasiswa: docData?.nama_mahasiswa ?? npm,
      npm: docData?.npm ?? npm,
      alamat: kaprodi.alamat ?? "",
      noHp: kaprodi.no_hp ?? "",
      judulSkripsi: docData?.judul_skripsi ?? "",
      fakultas: docData?.fakultas_nama ?? "",
      ttdKaprodi: docData?.kaprodi_sig ?? null,
      namaKaprodi,
      prodi: docData?.prodi_nama ?? "",
      ttdMahasiswa: docData?.mahasiswa_sig ?? null,
    });
    const perbaikanBase64 = perbaikanBuffer.toString("base64");

    await conn.query(
      `DELETE FROM pengajuan_sidang_files WHERE pengajuan_sidang_id = ? AND file_type = 'SURAT_PERNYATAAN_PERBAIKAN'`,
      [existingSidang.id],
    );
    await conn.query(
      `INSERT INTO pengajuan_sidang_files
         (pengajuan_sidang_id, file_type, file_name, mime_type, file_content, source, status)
       VALUES (?, 'SURAT_PERNYATAAN_PERBAIKAN', ?, ?, ?, 'SYSTEM', 'SUBMITTED')`,
      [existingSidang.id, `Surat_Pernyataan_Perbaikan_${npm}.docx`, MIME_DOCX, perbaikanBase64],
    );

    // Generate SURAT_PERNYATAAN_KELENGKAPAN
    const kelengkapanBuffer = await buildSuratPernyataanKelengkapanBuffer({
      prodi: docData?.prodi_nama ?? "",
      fakultas: docData?.fakultas_nama ?? "",
      namaMahasiswa: docData?.nama_mahasiswa ?? npm,
      npm: docData?.npm ?? npm,
      todayDate,
      ttdMahasiswa: docData?.mahasiswa_sig ?? null,
    });
    const kelengkapanBase64 = kelengkapanBuffer.toString("base64");

    await conn.query(
      `DELETE FROM pengajuan_sidang_files WHERE pengajuan_sidang_id = ? AND file_type = 'SURAT_PERNYATAAN_KELENGKAPAN'`,
      [existingSidang.id],
    );
    await conn.query(
      `INSERT INTO pengajuan_sidang_files
         (pengajuan_sidang_id, file_type, file_name, mime_type, file_content, source, status)
       VALUES (?, 'SURAT_PERNYATAAN_KELENGKAPAN', ?, ?, ?, 'SYSTEM', 'SUBMITTED')`,
      [existingSidang.id, `Surat_Pernyataan_Kelengkapan_${npm}.docx`, MIME_DOCX, kelengkapanBase64],
    );

    // Generate LEMBAR_USULAN_PENGUJI
    const usulanBuffer = await buildLembarUsulanPengujiBuffer({
      prodi: docData?.prodi_nama ?? "",
      fakultas: docData?.fakultas_nama ?? "",
      namaMahasiswa: docData?.nama_mahasiswa ?? npm,
      npm: docData?.npm ?? npm,
      namaDospem1: docData?.dospem1_nama ?? "",
      namaDospem2: docData?.dospem2_nama ?? "",
      judul: docData?.judul_skripsi ?? "",
      todayDate,
      penguji1Nama: kaprodi.penguji1_nama ?? null,
      penguji2Nama: kaprodi.penguji2_nama ?? null,
      ttdMahasiswa: docData?.mahasiswa_sig ?? null,
      namaKaprodi,
    });
    const usulanBase64 = usulanBuffer.toString("base64");

    await conn.query(
      `DELETE FROM pengajuan_sidang_files WHERE pengajuan_sidang_id = ? AND file_type = 'LEMBAR_USULAN_PENGUJI'`,
      [existingSidang.id],
    );
    await conn.query(
      `INSERT INTO pengajuan_sidang_files
         (pengajuan_sidang_id, file_type, file_name, mime_type, file_content, source, status)
       VALUES (?, 'LEMBAR_USULAN_PENGUJI', ?, ?, ?, 'SYSTEM', 'SUBMITTED')`,
      [existingSidang.id, `Lembar_Usulan_Penguji_${npm}.docx`, MIME_DOCX, usulanBase64],
    );

    const [[mahasiswaRow]] = await conn.query(
      `SELECT m.nama, m.program_studi_id FROM mahasiswa m WHERE m.npm = ? LIMIT 1`,
      [npm],
    );
    const namaMahasiswa = mahasiswaRow?.nama ?? npm;
    const programStudiId = mahasiswaRow?.program_studi_id;

    if (programStudiId) {
      const [kaprodiUsers] = await conn.query(
        `SELECT u.id FROM users u
         INNER JOIN user_roles ur ON ur.user_id = u.id
         INNER JOIN roles r ON r.id = ur.role_id
         INNER JOIN program_studi ps ON ps.kaprodi_nidn = u.nidn
         WHERE r.code = 'KAPRODI' AND ps.id = ? AND u.is_active = 1`,
        [programStudiId],
      );
      for (const ku of kaprodiUsers) {
        await insertNotification(
          conn, ku.id, "SIDANG_KAPRODI_SUBMITTED",
          `Mahasiswa ${namaMahasiswa} mengajukan permohonan sidang skripsi`,
          "/kaprodi/pengajuan-sidang-kaprodi",
        );
      }
    }

    await conn.commit();
    txStarted = false;

    return res.json({ ok: true, message: "Pengajuan Sidang Kaprodi berhasil disubmit" });
  } catch (err) {
    try { if (txStarted) await conn.rollback(); } catch (_) {}
    next(err);
  } finally {
    conn.release();
  }
};

exports.reviewKaprodi = async (req, res, next) => {
  const conn = await db.getConnection();
  let txStarted = false;
  try {
    if (!req.user.hasRole("KAPRODI")) {
      return res.status(403).json({ ok: false, message: "Only kaprodi can review Pengajuan Sidang Kaprodi" });
    }

    const pengajuanJudulId = Number(req.params.pengajuanJudulId);
    if (!Number.isFinite(pengajuanJudulId) || pengajuanJudulId <= 0) {
      return res.status(400).json({ ok: false, message: "Invalid pengajuanJudulId" });
    }

    const { action, catatanKaprodi } = req.body ?? {};
    if (action !== "VALID" && action !== "NEED_REVISION" && action !== "REJECTED") {
      return res.status(400).json({ ok: false, message: "action harus 'VALID', 'NEED_REVISION', atau 'REJECTED'" });
    }
    if ((action === "NEED_REVISION" || action === "REJECTED") && (!catatanKaprodi || !String(catatanKaprodi).trim())) {
      return res.status(400).json({ ok: false, message: "catatanKaprodi wajib diisi" });
    }

    const nidn = await getLecturerNidn(req.user.id);
    if (!nidn) {
      return res.status(400).json({ ok: false, message: "Data dosen tidak valid" });
    }
    const kaprodiProgramStudiIds = await getKaprodiProgramStudiIdsByNidn(nidn);

    await conn.beginTransaction();
    txStarted = true;

    const [[kaprodi]] = await conn.query(
      `SELECT psk.*, m.program_studi_id
       FROM pengajuan_sidang_kaprodi psk
       INNER JOIN pengajuan_judul pj ON pj.id = psk.pengajuan_judul_id
       INNER JOIN mahasiswa m ON m.npm = pj.npm
       WHERE psk.pengajuan_judul_id = ? LIMIT 1 FOR UPDATE`,
      [pengajuanJudulId],
    );
    if (!kaprodi) {
      await conn.rollback(); txStarted = false;
      return res.status(404).json({ ok: false, message: "Pengajuan Sidang Kaprodi tidak ditemukan" });
    }

    if (!kaprodiProgramStudiIds.includes(Number(kaprodi.program_studi_id))) {
      await conn.rollback(); txStarted = false;
      return res.status(403).json({ ok: false, message: "Anda tidak memiliki akses ke pengajuan ini" });
    }

    if (kaprodi.status !== "SUBMITTED") {
      await conn.rollback(); txStarted = false;
      return res.status(409).json({
        ok: false,
        message: "Pengajuan Sidang Kaprodi harus berstatus SUBMITTED untuk direview",
      });
    }

    const newStatus = action === "VALID" ? "VALID" : action;

    await conn.query(
      `UPDATE pengajuan_sidang_kaprodi
       SET status = ?,
           catatan_kaprodi = ?,
           reviewed_by_user_id = ?,
           reviewed_at = CURRENT_TIMESTAMP,
           updated_at = CURRENT_TIMESTAMP
       WHERE id = ?`,
      [newStatus, catatanKaprodi ? String(catatanKaprodi).trim() : null, req.user.id, kaprodi.id],
    );

    const [[studentRow]] = await conn.query(
      `SELECT u.id FROM users u
       INNER JOIN mahasiswa m ON m.npm = u.npm
       INNER JOIN pengajuan_judul pj ON pj.npm = m.npm AND pj.id = ?
       WHERE u.is_active = 1
       LIMIT 1`,
      [pengajuanJudulId],
    );

    if (studentRow) {
      const notifMap = {
        VALID: ["SIDANG_KAPRODI_VALID", "Pengajuan sidang Anda telah disetujui oleh Kaprodi"],
        NEED_REVISION: ["SIDANG_KAPRODI_NEED_REVISION", "Kaprodi meminta revisi pada pengajuan sidang Anda"],
        REJECTED: ["SIDANG_KAPRODI_REJECTED", "Pengajuan sidang Anda ditolak oleh Kaprodi"],
      };
      const [notifType, notifMsg] = notifMap[action];
      await insertNotification(conn, studentRow.id, notifType, notifMsg, "/student/pengajuan-sidang");
    }

    await conn.commit();
    txStarted = false;

    const msgMap = { VALID: "disetujui", NEED_REVISION: "dikembalikan untuk revisi", REJECTED: "ditolak" };
    return res.json({ ok: true, message: `Pengajuan Sidang Kaprodi ${msgMap[action]}` });
  } catch (err) {
    try { if (txStarted) await conn.rollback(); } catch (_) {}
    next(err);
  } finally {
    conn.release();
  }
};

exports.listKaprodiSubmissions = async (req, res, next) => {
  try {
    if (!req.user.hasRole("KAPRODI")) {
      return res.status(403).json({ ok: false, message: "Only kaprodi can access this endpoint" });
    }

    const nidn = await getLecturerNidn(req.user.id);
    if (!nidn) {
      return res.status(400).json({ ok: false, message: "Data dosen tidak valid" });
    }
    const kaprodiProgramStudiIds = await getKaprodiProgramStudiIdsByNidn(nidn);
    if (kaprodiProgramStudiIds.length === 0) {
      return res.json({ ok: true, data: [] });
    }

    const statusParam = req.query?.status;
    const filterByStatus = statusParam && VALID_KAPRODI_STATUSES.includes(statusParam);

    const conditions = [`m.program_studi_id IN (${kaprodiProgramStudiIds.map(() => "?").join(",")})`];
    const params = [...kaprodiProgramStudiIds];

    if (filterByStatus) {
      conditions.push("psk.status = ?");
      params.push(statusParam);
    }

    const [rows] = await db.query(
      `SELECT
         psk.id,
         psk.pengajuan_judul_id,
         psk.status,
         psk.catatan_kaprodi,
         psk.submitted_at,
         psk.reviewed_at,
         psk.created_at,
         m.npm,
         m.nama AS nama_mahasiswa,
         m.program_studi_id,
         ps.nama AS program_studi_nama,
         k.judul_skripsi
       FROM pengajuan_sidang_kaprodi psk
       INNER JOIN pengajuan_judul pj ON pj.id = psk.pengajuan_judul_id
       INNER JOIN mahasiswa m ON m.npm = pj.npm
       INNER JOIN program_studi ps ON ps.id = m.program_studi_id
       LEFT JOIN kartu_konsultasi_outline k ON k.pengajuan_judul_id = pj.id
       WHERE ${conditions.join(" AND ")}
       ORDER BY psk.submitted_at DESC`,
      params,
    );

    return res.json({ ok: true, data: rows });
  } catch (err) {
    next(err);
  }
};
