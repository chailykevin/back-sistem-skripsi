const db = require("../db");
const { insertNotification } = require("../utils/notify");
const { sendSuratUndangan } = require("../utils/email");
const { getOpenPeriod: getSidangOpenPeriod } = require("../services/sidangSubmissionPeriod.service");
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

const MIME_DOCX =
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document";

const ANGKA_TERBILANG = [
  "",
  "satu",
  "dua",
  "tiga",
  "empat",
  "lima",
  "enam",
  "tujuh",
  "delapan",
  "sembilan",
  "sepuluh",
];

function terbilang(n) {
  const i = Number(n);
  return ANGKA_TERBILANG[i] ?? String(i);
}

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
const BULAN_ROMAWI = [
  "I",
  "II",
  "III",
  "IV",
  "V",
  "VI",
  "VII",
  "VIII",
  "IX",
  "X",
  "XI",
  "XII",
];

function formatTanggalIndonesia(date) {
  return `${date.getDate()} ${BULAN_ID[date.getMonth()]} ${date.getFullYear()}`;
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
  const dataUrlMatch = raw.match(
    /^data:image\/([a-zA-Z0-9.+-]+);base64,(.+)$/i,
  );
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

async function buildLembarPermohonanUjianBuffer({
  todayDate,
  fakultas,
  namaMahasiswa,
  npm,
  ttl,
  prodi,
  tahunMasuk,
  alamat,
  noHp,
  noWa,
  statusPernikahan,
  judulSkripsi,
  ujianCount,
  ujianCountString,
  ipk,
  sks,
  ttdKaprodi,
  namaKaprodi,
  ttdMahasiswa,
}) {
  const templatePath = path.join(
    __dirname,
    "../templates/template_permohonan_ujian_skripsi.docx",
  );
  const templateBuffer = await readFile(templatePath);
  const patches = {
    today_date: textPatch(todayDate),
    fakultas: textPatch(fakultas),
    nama_mahasiswa: textPatch(namaMahasiswa),
    npm: textPatch(npm),
    ttl: textPatch(ttl),
    prodi: textPatch(prodi),
    tahun_masuk: textPatch(tahunMasuk),
    alamat: textPatch(alamat),
    no_hp: textPatch(noHp),
    no_wa: textPatch(noWa),
    status: textPatch(statusPernikahan),
    judul_skripsi: textPatch(judulSkripsi),
    ujian_count: textPatch(String(ujianCount)),
    ujian_count_string: textPatch(ujianCountString),
    ipk: textPatch(String(ipk ?? "")),
    sks: textPatch(String(sks ?? "")),
    ttd_kaprodi: signatureImagePatch(ttdKaprodi),
    nama_kaprodi: textPatch(namaKaprodi),
    ttd_mahasiswa: signatureImagePatch(ttdMahasiswa),
  };
  const outputBuffer = await patchDocument({
    outputType: "nodebuffer",
    data: templateBuffer,
    patches,
  });
  return outputBuffer;
}

async function buildSuratPernyataanPerbaikanBuffer({
  namaMahasiswa,
  npm,
  alamat,
  noHp,
  judulSkripsi,
  fakultas,
  ttdKaprodi,
  namaKaprodi,
  prodi,
  ttdMahasiswa,
}) {
  const templatePath = path.join(
    __dirname,
    "../templates/template_pernyataan_perbaikan.docx",
  );
  const templateBuffer = await readFile(templatePath);
  const patches = {
    nama_mahasiswa: textPatch(namaMahasiswa),
    npm: textPatch(npm),
    alamat: textPatch(alamat),
    no_hp: textPatch(noHp),
    judul_skripsi: textPatch(judulSkripsi),
    fakultas: textPatch(fakultas),
    ttd_kaprodi: signatureImagePatch(ttdKaprodi),
    nama_kaprodi: textPatch(namaKaprodi),
    prodi: textPatch(prodi),
    ttd_mahasiswa: signatureImagePatch(ttdMahasiswa),
  };
  const outputBuffer = await patchDocument({
    outputType: "nodebuffer",
    data: templateBuffer,
    patches,
  });
  return outputBuffer;
}

async function buildSuratPernyataanKelengkapanBuffer({
  prodi,
  fakultas,
  namaMahasiswa,
  npm,
  todayDate,
  ttdMahasiswa,
}) {
  const templatePath = path.join(
    __dirname,
    "../templates/template_pernyataan_kelengkapan_dan_nilai_matkul.docx",
  );
  const templateBuffer = await readFile(templatePath);
  const patches = {
    prodi: textPatch(prodi),
    fakultas: textPatch(fakultas),
    nama_mahasiswa: textPatch(namaMahasiswa),
    npm: textPatch(npm),
    today_date: textPatch(todayDate),
    ttd_mahasiswa: signatureImagePatch(ttdMahasiswa),
  };
  const outputBuffer = await patchDocument({
    outputType: "nodebuffer",
    data: templateBuffer,
    patches,
  });
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
      const tMatch = segments[segIndex].text.match(
        /<w:t(?:[^>]*)>([\s\S]*?)<\/w:t>/,
      );
      return tMatch ? tMatch[1] : "";
    }

    function addHighlightToRun(run) {
      if (run.includes("<w:highlight")) return run;
      if (run.includes("<w:rPr>")) {
        return run.replace("</w:rPr>", '<w:highlight w:val="yellow"/></w:rPr>');
      }
      return run.replace(
        /(<w:t(?:[^>]*)>)/,
        '<w:rPr><w:highlight w:val="yellow"/></w:rPr>$1',
      );
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

  return xml.replace(
    /(<w:tr\b[^>]*>)([\s\S]*?)(<\/w:tr>)/g,
    (_, open, rowContent, close) => {
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
      const processedRow = rowContent.replace(
        /(<w:tc\b[^>]*>)([\s\S]*?)(<\/w:tc>)/g,
        (__, tcOpen, cellContent, tcClose) => {
          const idx = colCount++;
          const content =
            idx === targetIdx ? highlightInXml(cellContent) : cellContent;
          return tcOpen + content + tcClose;
        },
      );
      return open + processedRow + close;
    },
  );
}

async function buildLembarUsulanPengujiBuffer({
  prodi,
  fakultas,
  namaMahasiswa,
  npm,
  namaDospem1,
  namaDospem2,
  judul,
  todayDate,
  penguji1Nama,
  penguji2Nama,
  ttdMahasiswa,
  namaKaprodi,
}) {
  const templatePath = path.join(
    __dirname,
    "../templates/template_usulan_penguji.docx",
  );
  const templateBuffer = await readFile(templatePath);
  const patches = {
    prodi: textPatch(prodi),
    fakultas: textPatch(fakultas),
    nama_mahasiswa: textPatch(namaMahasiswa),
    npm: textPatch(npm),
    nama_dospem1: textPatch(namaDospem1),
    nama_dospem2: textPatch(namaDospem2),
    judul: textPatch(judul),
    today_date: textPatch(todayDate),
    ttd_mahasiswa: signatureImagePatch(ttdMahasiswa),
    sidang_date: textPatch(""),
    sidang_time: textPatch(""),
    nama_penguji1: textPatch(""),
    nama_penguji2: textPatch(""),
    disposisi_date: textPatch(""),
    nama_kaprodi: textPatch(namaKaprodi),
    ttd_kaprodi: textPatch(""),
  };
  const patchedBuffer = await patchDocument({
    outputType: "nodebuffer",
    data: templateBuffer,
    patches,
  });
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

async function buildLembarUsulanPengujiBufferFull({
  prodi,
  fakultas,
  namaMahasiswa,
  npm,
  namaDospem1,
  namaDospem2,
  judul,
  todayDate,
  penguji1Nama,
  penguji2Nama,
  ttdMahasiswa,
  namaKaprodi,
  sidangDate,
  sidangTime,
  disposisiDate,
  ttdKaprodi,
}) {
  const templatePath = path.join(
    __dirname,
    "../templates/template_usulan_penguji.docx",
  );
  const templateBuffer = await readFile(templatePath);
  const patches = {
    prodi: textPatch(prodi),
    fakultas: textPatch(fakultas),
    nama_mahasiswa: textPatch(namaMahasiswa),
    npm: textPatch(npm),
    nama_dospem1: textPatch(namaDospem1),
    nama_dospem2: textPatch(namaDospem2),
    judul: textPatch(judul),
    today_date: textPatch(todayDate),
    ttd_mahasiswa: signatureImagePatch(ttdMahasiswa),
    sidang_date: textPatch(sidangDate ?? ""),
    sidang_time: textPatch(sidangTime ?? ""),
    nama_penguji1: textPatch(penguji1Nama ?? ""),
    nama_penguji2: textPatch(penguji2Nama ?? ""),
    disposisi_date: textPatch(disposisiDate ?? ""),
    nama_kaprodi: textPatch(namaKaprodi),
    ttd_kaprodi: signatureImagePatch(ttdKaprodi),
  };
  const patchedBuffer = await patchDocument({
    outputType: "nodebuffer",
    data: templateBuffer,
    patches,
  });
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

async function buildSuratUndanganBuffer({
  nomorSurat,
  lampiran,
  namaPembimbing1,
  namaPembimbing2,
  namaPenguji1,
  namaPenguji2,
  tanggal,
  fakultas,
  nomorSk,
  tanggalSk,
  namaMahasiswa,
  npm,
  prodi,
  judulSkripsi,
  sidangDate,
  sidangTime,
  tempatSidang,
  ttdKaprodi,
  namaKaprodi,
}) {
  const templatePath = path.join(
    __dirname,
    "../templates/template_surat_undangan_sidang.docx",
  );
  const templateBuffer = await readFile(templatePath);
  const patches = {
    nomor_surat: textPatch(nomorSurat ?? ""),
    lampiran: textPatch(lampiran ?? "-"),
    nama_pembimbing1: textPatch(namaPembimbing1 ?? ""),
    nama_pembimbing2: textPatch(namaPembimbing2 ?? ""),
    nama_penguji1: textPatch(namaPenguji1 ?? ""),
    nama_penguji2: textPatch(namaPenguji2 ?? ""),
    tanggal: textPatch(tanggal ?? ""),
    fakultas: textPatch(fakultas ?? ""),
    nomor_sk: textPatch(nomorSk ?? ""),
    tanggal_sk: textPatch(tanggalSk ?? ""),
    nama_mahasiswa: textPatch(namaMahasiswa ?? ""),
    npm: textPatch(npm ?? ""),
    prodi: textPatch(prodi ?? ""),
    judul_skripsi: textPatch(judulSkripsi ?? ""),
    sidang_date: textPatch(sidangDate ?? ""),
    sidang_time: textPatch(sidangTime ?? ""),
    tempat_sidang: textPatch(tempatSidang ?? ""),
    ttd_kaprodi: signatureImagePatch(ttdKaprodi),
    nama_kaprodi: textPatch(namaKaprodi ?? ""),
  };
  const outputBuffer = await patchDocument({
    outputType: "nodebuffer",
    data: templateBuffer,
    patches,
  });
  return outputBuffer;
}

const VALID_KAPRODI_STATUSES = [
  "DRAFT",
  "SUBMITTED",
  "NEED_REVISION",
  "VALID",
  "REJECTED",
  "DISPOSISI_SENT",
  "COMPLETED",
];

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
  "HALAMAN_LAMPIRAN",
  "INDEKS",
  "SURAT_KETERANGAN",
  "SURAT_PERNYATAAN_TIDAK_PLAGIAT",
  "LEMBAR_USULAN_PENGUJI",
  "LEMBAR_PERMOHONAN_UJIAN",
  "PAS_FOTO",
  "KTM",
  "BUKTI_PEMBAYARAN",
  "LEMBAR_KONSULTASI_JURNAL",
  "KARTU_KONSULTASI_SKRIPSI",
  "SK_PENUNJUKAN_PEMBIMBING",
  "REKAP_NILAI",
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
  "SURAT_UNDANGAN_SIDANG",
];

// Auto-pulled by system; mahasiswa cannot manually upload these
const SYSTEM_FILE_TYPES = [
  "KARTU_KONSULTASI_SKRIPSI",
  "SK_PENUNJUKAN_PEMBIMBING",
  "LEMBAR_PERMOHONAN_UJIAN",
  "SURAT_PERNYATAAN_PERBAIKAN",
  "SURAT_PERNYATAAN_KELENGKAPAN",
  "LEMBAR_USULAN_PENGUJI",
  "SURAT_PERNYATAAN_PENYELESAIAN",
  "SURAT_UNDANGAN_SIDANG",
];

const OPTIONAL_FILE_TYPES = [
  "DAFTAR_LAMPIRAN",
  "HALAMAN_LAMPIRAN",
  "INDEKS",
  "KHS_8",
  "SURAT_KETERANGAN",
  "FOTOCOPY_KONVERSI",
  "SERTIFIKAT_POINT",
];

// Required only when pengajuan_disposisi_pembimbing.perlu_surat_pengantar = 1
const CONDITIONALLY_REQUIRED_FILE_TYPES = ["SURAT_KETERANGAN"];

const REQUIRED_FILE_TYPES = ALL_FILE_TYPES.filter(
  (t) => !OPTIONAL_FILE_TYPES.includes(t),
);

// File types that Kaprodi verifies (skripsi content + optional skripsi content + consultation docs)
const KAPRODI_FILE_TYPES = [
  "JUDUL_LUAR",
  "JUDUL_DALAM",
  "PERSETUJUAN_UJIAN",
  "ABSTRAK",
  "KATA_PENGANTAR",
  "DAFTAR_ISI",
  "DAFTAR_TABEL",
  "DAFTAR_GAMBAR",
  "BAB_1_5",
  "DAFTAR_PUSTAKA",
  "RIWAYAT_HIDUP",
  "SURAT_PERNYATAAN_TIDAK_PLAGIAT",
  "DAFTAR_LAMPIRAN",
  "HALAMAN_LAMPIRAN",
  "INDEKS",
  "KARTU_KONSULTASI_SKRIPSI",
  "SK_PENUNJUKAN_PEMBIMBING",
];

// Optional skripsi content — uploadable at Kaprodi step but do NOT block the VALID gate
const KAPRODI_OPTIONAL_FILE_TYPES = [
  "DAFTAR_LAMPIRAN",
  "HALAMAN_LAMPIRAN",
  "INDEKS",
];

// Must all be VERIFIED (kaprodi_status) before Kaprodi can mark VALID
const KAPRODI_REQUIRED_FILE_TYPES = KAPRODI_FILE_TYPES.filter(
  (t) =>
    !SYSTEM_FILE_TYPES.includes(t) && !KAPRODI_OPTIONAL_FILE_TYPES.includes(t),
);

const VALID_SIDANG_STATUSES = [
  "DRAFT",
  "SUBMITTED",
  "NEED_REVISION",
  "VERIFIED",
  "WAITING_FOR_DISPOSISI",
  "WAITING_FOR_SURAT",
  "COMPLETED",
  "REJECTED",
];
const VALID_FILE_STATUSES = ["SUBMITTED", "NEED_REUPLOAD", "VERIFIED"];

// Returns the active (non-terminal) sidang or the most recent one
async function getActiveSidang(conn, skripsiId) {
  const [rows] = await conn.query(
    `SELECT * FROM pengajuan_sidang
     WHERE skripsi_id = ?
     ORDER BY
       CASE WHEN status NOT IN ('VERIFIED','WAITING_FOR_DISPOSISI','WAITING_FOR_SURAT','COMPLETED','REJECTED') THEN 0 ELSE 1 END ASC,
       created_at DESC
     LIMIT 1`,
    [skripsiId],
  );
  return rows[0] ?? null;
}

exports.initPengajuanSidang = async (req, res, next) => {
  const conn = await db.getConnection();
  let txStarted = false;
  try {
    if (req.user.userType !== "STUDENT") {
      return res.status(403).json({
        ok: false,
        message: "Only students can initialize Pengajuan Sidang",
      });
    }

    const skripsiId = Number(req.params.skripsiId);
    if (!Number.isFinite(skripsiId) || skripsiId <= 0) {
      return res
        .status(400)
        .json({ ok: false, message: "Invalid skripsiId" });
    }

    const npm = await getStudentNpm(req.user.id);
    if (!npm) {
      return res
        .status(400)
        .json({ ok: false, message: "Mahasiswa tidak valid" });
    }

    // Prerequisite: skripsi must be COMPLETED
    const [[skripsiRow]] = await conn.query(
      `SELECT id, perlu_surat_pengantar FROM skripsi WHERE id = ? AND npm = ? AND status = 'COMPLETED' LIMIT 1`,
      [skripsiId, npm],
    );
    if (!skripsiRow) {
      return res
        .status(400)
        .json({ ok: false, message: "Konsultasi skripsi belum selesai" });
    }

    // Determine if this is an ujian ulang (re-exam) or original sidang
    const [[latestSidang]] = await conn.query(
      `SELECT id, hasil_sidang FROM sidang WHERE skripsi_id = ? ORDER BY id DESC LIMIT 1`,
      [skripsiId],
    );
    const isUjianUlang = !!(
      latestSidang && latestSidang.hasil_sidang === "TIDAK_LULUS"
    );

    if (isUjianUlang) {
      // Ujian ulang: prerequisite is revisi_pasca_sidang completed
      const [[revisiRow]] = await conn.query(
        `SELECT id, is_completed FROM revisi_pasca_sidang WHERE skripsi_id = ? LIMIT 1`,
        [skripsiId],
      );
      if (!revisiRow || !revisiRow.is_completed) {
        return res
          .status(400)
          .json({ ok: false, message: "Revisi pasca sidang belum selesai" });
      }
    } else {
      // Original flow: Kaprodi form must be VALID
      const [[latestSidangForKaprodi]] = await conn.query(
        `SELECT id FROM pengajuan_sidang WHERE skripsi_id = ? ORDER BY id DESC LIMIT 1`,
        [skripsiId],
      );
      const [[kaprodiRow]] = latestSidangForKaprodi
        ? await conn.query(
            `SELECT id, status FROM pengajuan_sidang_kaprodi WHERE pengajuan_sidang_id = ? LIMIT 1`,
            [latestSidangForKaprodi.id],
          )
        : [[null]];
      if (!kaprodiRow || kaprodiRow.status !== "VALID") {
        return res
          .status(400)
          .json({ ok: false, message: "Pengajuan ke Kaprodi belum disetujui" });
      }
    }

    // Block if there is already an active (non-terminal) pengajuan_sidang.
    // WAITING_FOR_DISPOSISI and WAITING_FOR_SURAT are in-progress, not terminal,
    // so they must also prevent creating a new row.
    const [[activeRow]] = await conn.query(
      `SELECT id, status, submitted_at FROM pengajuan_sidang
       WHERE skripsi_id = ? AND status NOT IN ('COMPLETED','REJECTED')
       ORDER BY
         CASE WHEN status = 'DRAFT' AND submitted_at IS NULL THEN 0 ELSE 1 END ASC,
         created_at DESC
       LIMIT 1`,
      [skripsiId],
    );

    await conn.beginTransaction();
    txStarted = true;

    let sidangId;
    let isNew = false;

    if (activeRow) {
      // System auto-created a DRAFT (original flow) — reuse it if not yet submitted
      if (
        activeRow.status === "DRAFT" &&
        !activeRow.submitted_at &&
        !isUjianUlang
      ) {
        sidangId = activeRow.id;
      } else {
        // Row exists and is in-progress (SUBMITTED, WAITING_FOR_DISPOSISI, etc.) — return idempotently
        await conn.rollback();
        txStarted = false;
        return res.status(200).json({
          ok: true,
          message: "Pengajuan Sidang sudah ada",
          data: { id: activeRow.id },
        });
      }
    } else {
      // Count existing sidang rows to determine ujian_ke
      const [[{ sidangCount }]] = await conn.query(
        `SELECT COUNT(*) AS sidangCount FROM sidang WHERE skripsi_id = ?`,
        [skripsiId],
      );
      const ujianKe = Number(sidangCount) + 1;

      // Gate by period for original flow only (ujian ulang is exempt)
      let sidangPeriodId = null;
      if (!isUjianUlang) {
        const openPeriod = await getSidangOpenPeriod();
        if (!openPeriod) {
          await conn.rollback();
          txStarted = false;
          return res.status(409).json({
            ok: false,
            message: "Tidak ada periode pengajuan sidang yang sedang dibuka.",
          });
        }
        sidangPeriodId = openPeriod.id;
      }

      const [ins] = await conn.query(
        `INSERT INTO pengajuan_sidang (skripsi_id, status, ujian_ke, sidang_submission_period_id) VALUES (?, 'DRAFT', ?, ?)`,
        [skripsiId, ujianKe, sidangPeriodId],
      );
      sidangId = ins.insertId;
      isNew = true;
    }

    if (!isUjianUlang) {
      // Original flow: auto-pull system files
      const [[kartuSkripsi]] = await conn.query(
        `SELECT k.id, k.file_content, k.file_name FROM kartu_konsultasi_skripsi k WHERE k.skripsi_id = ? LIMIT 1`,
        [skripsiId],
      );
      if (!kartuSkripsi) {
        await conn.rollback();
        txStarted = false;
        return res.status(400).json({
          ok: false,
          message: "Kartu konsultasi skripsi tidak ditemukan",
        });
      }
      if (!kartuSkripsi.file_content) {
        await conn.rollback();
        txStarted = false;
        return res.status(400).json({
          ok: false,
          message: "File kartu konsultasi skripsi belum digenerate",
        });
      }
      await conn.query(
        `DELETE FROM pengajuan_sidang_files WHERE pengajuan_sidang_id = ? AND file_type = 'KARTU_KONSULTASI_SKRIPSI'`,
        [sidangId],
      );
      await conn.query(
        `INSERT INTO pengajuan_sidang_files
           (pengajuan_sidang_id, file_type, file_name, mime_type, file_content, source, status)
         VALUES (?, 'KARTU_KONSULTASI_SKRIPSI', ?, ?, ?, 'SYSTEM', 'VERIFIED')`,
        [
          sidangId,
          kartuSkripsi.file_name,
          MIME_DOCX,
          kartuSkripsi.file_content,
        ],
      );

      const [[skPembimbingRow]] = await conn.query(
        `SELECT f.file_content, f.file_name, f.mime_type
         FROM pengajuan_sk_penelitian_files f
         INNER JOIN pengajuan_sk_penelitian psk ON psk.id = f.pengajuan_sk_penelitian_id
         WHERE psk.outline_id = (SELECT outline_id FROM skripsi WHERE id = ? LIMIT 1)
           AND f.file_type = 'SK_PENUNJUKAN_PEMBIMBING'
         ORDER BY f.created_at DESC LIMIT 1`,
        [skripsiId],
      );
      if (!skPembimbingRow) {
        await conn.rollback();
        txStarted = false;
        return res
          .status(400)
          .json({ ok: false, message: "File SK Pembimbing tidak ditemukan" });
      }
      await conn.query(
        `DELETE FROM pengajuan_sidang_files WHERE pengajuan_sidang_id = ? AND file_type = 'SK_PENUNJUKAN_PEMBIMBING'`,
        [sidangId],
      );
      await conn.query(
        `INSERT INTO pengajuan_sidang_files
           (pengajuan_sidang_id, file_type, file_name, mime_type, file_content, source, status)
         VALUES (?, 'SK_PENUNJUKAN_PEMBIMBING', ?, ?, ?, 'SYSTEM', 'VERIFIED')`,
        [
          sidangId,
          skPembimbingRow.file_name,
          skPembimbingRow.mime_type ?? null,
          skPembimbingRow.file_content,
        ],
      );

      const [[suratPenyelesaianRow]] = await conn.query(
        `SELECT f.file_content, f.file_name, f.mime_type
         FROM pengajuan_sk_penelitian_files f
         INNER JOIN pengajuan_sk_penelitian psk ON psk.id = f.pengajuan_sk_penelitian_id
         WHERE psk.outline_id = (SELECT outline_id FROM skripsi WHERE id = ? LIMIT 1)
           AND f.file_type = 'SURAT_PENYELESAIAN_SKRIPSI'
         ORDER BY f.created_at DESC LIMIT 1`,
        [skripsiId],
      );
      if (suratPenyelesaianRow) {
        await conn.query(
          `DELETE FROM pengajuan_sidang_files WHERE pengajuan_sidang_id = ? AND file_type = 'SURAT_PERNYATAAN_PENYELESAIAN'`,
          [sidangId],
        );
        await conn.query(
          `INSERT INTO pengajuan_sidang_files
             (pengajuan_sidang_id, file_type, file_name, mime_type, file_content, source, status)
           VALUES (?, 'SURAT_PERNYATAAN_PENYELESAIAN', ?, ?, ?, 'SYSTEM', 'VERIFIED')`,
          [
            sidangId,
            suratPenyelesaianRow.file_name,
            suratPenyelesaianRow.mime_type ?? null,
            suratPenyelesaianRow.file_content,
          ],
        );
      }
    }
    // Ujian ulang: no system files auto-pulled; student uploads only BUKTI_PEMBAYARAN + BAB_1_5

    await conn.commit();
    txStarted = false;

    if (!isNew) {
      return res.status(200).json({
        ok: true,
        message: "Pengajuan Sidang sudah ada",
        data: { id: sidangId },
      });
    }
    return res.status(201).json({
      ok: true,
      message: "Pengajuan Sidang dibuat",
      data: { id: sidangId },
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

exports.getPengajuanSidang = async (req, res, next) => {
  try {
    const skripsiId = Number(req.params.skripsiId);
    if (!Number.isFinite(skripsiId) || skripsiId <= 0) {
      return res
        .status(400)
        .json({ ok: false, message: "Invalid skripsiId" });
    }

    const sidang = await getActiveSidang(db, skripsiId);
    if (!sidang) {
      return res
        .status(404)
        .json({ ok: false, message: "Pengajuan Sidang tidak ditemukan" });
    }

    const [[mahasiswaInfo]] = await db.query(
      `SELECT s.npm, m.nama AS nama_mahasiswa, m.sks, s.program_studi_id,
              ps.nama AS program_studi_nama, s.perlu_surat_pengantar
       FROM skripsi s
       JOIN mahasiswa m ON m.npm = s.npm
       JOIN program_studi ps ON ps.id = s.program_studi_id
       WHERE s.id = ? LIMIT 1`,
      [skripsiId],
    );

    const [files] = await db.query(
      `SELECT id, file_type, file_name, mime_type, source, status, kaprodi_status, created_at
       FROM pengajuan_sidang_files
       WHERE pengajuan_sidang_id = ?
       ORDER BY file_type ASC`,
      [sidang.id],
    );

    return res.json({
      ok: true,
      data: { sidang, mahasiswa: mahasiswaInfo ?? null, files },
    });
  } catch (err) {
    next(err);
  }
};

exports.uploadFiles = async (req, res, next) => {
  try {
    if (req.user.userType !== "STUDENT") {
      return res
        .status(403)
        .json({ ok: false, message: "Only students can upload files" });
    }

    const skripsiId = Number(req.params.skripsiId);
    if (!Number.isFinite(skripsiId) || skripsiId <= 0) {
      return res
        .status(400)
        .json({ ok: false, message: "Invalid skripsiId" });
    }

    const { files } = req.body ?? {};
    if (!Array.isArray(files) || files.length === 0) {
      return res
        .status(400)
        .json({ ok: false, message: "files harus berisi minimal 1 entri" });
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
        return res.status(400).json({
          ok: false,
          message: `fileContent wajib diisi untuk ${f.fileType}`,
        });
      }
      if (!f?.fileName || !String(f.fileName).trim()) {
        return res.status(400).json({
          ok: false,
          message: `fileName wajib diisi untuk ${f.fileType}`,
        });
      }
    }

    const fileTypes = files.map((f) => f.fileType);
    if (new Set(fileTypes).size !== fileTypes.length) {
      return res
        .status(400)
        .json({ ok: false, message: "fileType tidak boleh duplikat" });
    }

    const sidang = await getActiveSidang(db, skripsiId);
    if (!sidang) {
      return res
        .status(404)
        .json({ ok: false, message: "Pengajuan Sidang tidak ditemukan" });
    }
    if (sidang.status !== "DRAFT" && sidang.status !== "NEED_REVISION") {
      return res.status(409).json({
        ok: false,
        message:
          "File hanya bisa diunggah saat status DRAFT atau NEED_REVISION",
      });
    }

    const [[kaprodiRow]] = sidang
      ? await db.query(
          `SELECT status FROM pengajuan_sidang_kaprodi WHERE pengajuan_sidang_id = ? LIMIT 1`,
          [sidang.id],
        )
      : [[null]];

    const kaprodiNotYetValid = kaprodiRow && kaprodiRow.status !== "VALID";
    if (kaprodiNotYetValid) {
      const forbidden = files.filter(
        (f) =>
          !KAPRODI_REQUIRED_FILE_TYPES.includes(f.fileType) &&
          !KAPRODI_OPTIONAL_FILE_TYPES.includes(f.fileType),
      );
      if (forbidden.length > 0) {
        return res.status(400).json({
          ok: false,
          message: `File berikut belum bisa diunggah sebelum Kaprodi menyetujui: ${forbidden.map((f) => f.fileType).join(", ")}`,
        });
      }
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
          [
            sidang.id,
            f.fileType,
            String(f.fileName).trim(),
            f.mimeType ?? null,
            String(f.fileContent),
          ],
        );
      }

      await conn.commit();
      txStarted = false;
    } catch (err) {
      try {
        if (txStarted) await conn.rollback();
      } catch (_) {}
      throw err;
    } finally {
      conn.release();
    }

    const [updatedFiles] = await db.query(
      `SELECT id, file_type, file_name, mime_type, source, status, kaprodi_status, created_at
       FROM pengajuan_sidang_files
       WHERE pengajuan_sidang_id = ?
       ORDER BY file_type ASC`,
      [sidang.id],
    );

    return res.json({
      ok: true,
      message: "File berhasil diunggah",
      data: { files: updatedFiles },
    });
  } catch (err) {
    next(err);
  }
};

exports.submitPengajuanSidang = async (req, res, next) => {
  const conn = await db.getConnection();
  let txStarted = false;
  try {
    if (req.user.userType !== "STUDENT") {
      return res.status(403).json({
        ok: false,
        message: "Only students can submit Pengajuan Sidang",
      });
    }

    const skripsiId = Number(req.params.skripsiId);
    if (!Number.isFinite(skripsiId) || skripsiId <= 0) {
      return res
        .status(400)
        .json({ ok: false, message: "Invalid skripsiId" });
    }

    const npm = await getStudentNpm(req.user.id);
    if (!npm) {
      return res
        .status(400)
        .json({ ok: false, message: "Mahasiswa tidak valid" });
    }

    await conn.beginTransaction();
    txStarted = true;

    const [[sidang]] = await conn.query(
      `SELECT * FROM pengajuan_sidang
       WHERE skripsi_id = ? AND status NOT IN ('VERIFIED','WAITING_FOR_DISPOSISI','WAITING_FOR_SURAT','COMPLETED','REJECTED')
       ORDER BY created_at DESC LIMIT 1 FOR UPDATE`,
      [skripsiId],
    );
    if (!sidang) {
      await conn.rollback();
      txStarted = false;
      return res
        .status(404)
        .json({ ok: false, message: "Pengajuan Sidang tidak ditemukan" });
    }
    if (sidang.status !== "DRAFT" && sidang.status !== "NEED_REVISION") {
      await conn.rollback();
      txStarted = false;
      return res.status(409).json({
        ok: false,
        message:
          "Pengajuan Sidang hanya bisa disubmit saat status DRAFT atau NEED_REVISION",
      });
    }

    // Gate by period: only on first-time submit (original flow, DRAFT status)
    if (sidang.ujian_ke === 1 && sidang.status === "DRAFT") {
      const openPeriod = await getSidangOpenPeriod();
      if (!openPeriod) {
        await conn.rollback();
        txStarted = false;
        return res.status(409).json({
          ok: false,
          message: "Tidak ada periode pengajuan sidang yang sedang dibuka.",
        });
      }
    }

    const [[skripsiForSubmit]] = await conn.query(
      `SELECT perlu_surat_pengantar FROM skripsi WHERE id = ? LIMIT 1`,
      [skripsiId],
    );
    const perluSuratKeterangan = skripsiForSubmit?.perlu_surat_pengantar === 1;

    // Validate required files are present
    const [existingFiles] = await conn.query(
      `SELECT file_type FROM pengajuan_sidang_files WHERE pengajuan_sidang_id = ?`,
      [sidang.id],
    );
    const existingTypes = new Set(existingFiles.map((f) => f.file_type));

    if (sidang.ujian_ke > 1) {
      // Ujian ulang: only BUKTI_PEMBAYARAN and BAB_1_5 required
      const ujianUlangRequired = ["BUKTI_PEMBAYARAN", "BAB_1_5"];
      const missing = ujianUlangRequired.filter((t) => !existingTypes.has(t));
      if (missing.length > 0) {
        await conn.rollback();
        txStarted = false;
        return res.status(400).json({
          ok: false,
          message: `File berikut belum diunggah: ${missing.join(", ")}`,
        });
      }
    } else {
      // Original flow: all required uploads must be present
      const requiredUploads = REQUIRED_FILE_TYPES.filter(
        (t) => !SYSTEM_FILE_TYPES.includes(t),
      );
      const missingUploads = requiredUploads.filter(
        (t) => !existingTypes.has(t),
      );
      if (missingUploads.length > 0) {
        await conn.rollback();
        txStarted = false;
        return res.status(400).json({
          ok: false,
          message: `File berikut belum diunggah: ${missingUploads.join(", ")}`,
        });
      }
      if (perluSuratKeterangan && !existingTypes.has("SURAT_KETERANGAN")) {
        await conn.rollback();
        txStarted = false;
        return res
          .status(400)
          .json({ ok: false, message: "File SURAT_KETERANGAN belum diunggah" });
      }
    }

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
        conn,
        sek.id,
        "SIDANG_SUBMITTED",
        `Mahasiswa ${namaMahasiswa} mengajukan Sidang Skripsi`,
        "/sekretariat/pengajuan-sidang",
      );
    }

    await conn.commit();
    txStarted = false;

    return res.json({
      ok: true,
      message: "Pengajuan Sidang berhasil disubmit",
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

exports.reviewFile = async (req, res, next) => {
  const conn = await db.getConnection();
  let txStarted = false;
  try {
    if (!req.user.hasRole("SEKRETARIAT")) {
      return res
        .status(403)
        .json({ ok: false, message: "Only sekretariat can review files" });
    }

    const skripsiId = Number(req.params.skripsiId);
    if (!Number.isFinite(skripsiId) || skripsiId <= 0) {
      return res
        .status(400)
        .json({ ok: false, message: "Invalid skripsiId" });
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
       WHERE skripsi_id = ? AND status NOT IN ('VERIFIED','WAITING_FOR_DISPOSISI','WAITING_FOR_SURAT','COMPLETED','REJECTED')
       ORDER BY created_at DESC LIMIT 1 FOR UPDATE`,
      [skripsiId],
    );
    if (!sidang) {
      await conn.rollback();
      txStarted = false;
      return res
        .status(404)
        .json({ ok: false, message: "Pengajuan Sidang tidak ditemukan" });
    }
    if (sidang.status !== "SUBMITTED" && sidang.status !== "NEED_REVISION") {
      await conn.rollback();
      txStarted = false;
      return res.status(409).json({
        ok: false,
        message:
          "Review file hanya bisa dilakukan saat status SUBMITTED atau NEED_REVISION",
      });
    }

    const [[fileRow]] = await conn.query(
      `SELECT id FROM pengajuan_sidang_files WHERE pengajuan_sidang_id = ? AND file_type = ? LIMIT 1`,
      [sidang.id, fileType],
    );
    if (!fileRow) {
      await conn.rollback();
      txStarted = false;
      return res
        .status(404)
        .json({ ok: false, message: `File ${fileType} tidak ditemukan` });
    }

    await conn.query(
      `UPDATE pengajuan_sidang_files SET status = ? WHERE id = ?`,
      [status, fileRow.id],
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

exports.finalizePengajuanSidang = async (req, res, next) => {
  const conn = await db.getConnection();
  let txStarted = false;
  try {
    if (!req.user.hasRole("SEKRETARIAT")) {
      return res.status(403).json({
        ok: false,
        message: "Only sekretariat can finalize Pengajuan Sidang",
      });
    }

    const skripsiId = Number(req.params.skripsiId);
    if (!Number.isFinite(skripsiId) || skripsiId <= 0) {
      return res
        .status(400)
        .json({ ok: false, message: "Invalid skripsiId" });
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

    const [[sidang]] = await conn.query(
      `SELECT * FROM pengajuan_sidang
       WHERE skripsi_id = ? AND status NOT IN ('VERIFIED','WAITING_FOR_DISPOSISI','WAITING_FOR_SURAT','COMPLETED','REJECTED')
       ORDER BY created_at DESC LIMIT 1 FOR UPDATE`,
      [skripsiId],
    );
    if (!sidang) {
      await conn.rollback();
      txStarted = false;
      return res
        .status(404)
        .json({ ok: false, message: "Pengajuan Sidang tidak ditemukan" });
    }
    if (sidang.status !== "SUBMITTED") {
      await conn.rollback();
      txStarted = false;
      return res.status(409).json({
        ok: false,
        message:
          "Pengajuan Sidang harus berstatus SUBMITTED untuk difinalisasi",
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
         JOIN skripsi s ON s.npm = u.npm
         WHERE s.id = ? AND u.is_active = 1 LIMIT 1`,
        [skripsiId],
      );
      if (studentRow) {
        await insertNotification(
          conn,
          studentRow.id,
          "SIDANG_NEED_REVISION",
          "Sekretariat meminta Anda mengunggah ulang dokumen pengajuan sidang",
          "/student/pengajuan-sidang",
        );
      }
      await conn.commit();
      txStarted = false;
      return res.json({
        ok: true,
        message: "Pengajuan Sidang dikembalikan untuk revisi",
      });
    }

    if (action === "VERIFY") {
      // All required files must be VERIFIED
      const [fileRows] = await conn.query(
        `SELECT file_type, status FROM pengajuan_sidang_files WHERE pengajuan_sidang_id = ?`,
        [sidang.id],
      );
      const fileMap = Object.fromEntries(
        fileRows.map((f) => [f.file_type, f.status]),
      );

      if (sidang.ujian_ke > 1) {
        // Ujian ulang: only check BUKTI_PEMBAYARAN and BAB_1_5
        const ujianUlangRequired = ["BUKTI_PEMBAYARAN", "BAB_1_5"];
        const unverified = ujianUlangRequired.filter(
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
      } else {
        const [[skripsiForVerify]] = await conn.query(
          `SELECT perlu_surat_pengantar FROM skripsi WHERE id = ? LIMIT 1`,
          [skripsiId],
        );
        const perluSuratKeterangan = skripsiForVerify?.perlu_surat_pengantar === 1;

        const unverified = REQUIRED_FILE_TYPES.filter(
          (t) => !SYSTEM_FILE_TYPES.includes(t) && fileMap[t] !== "VERIFIED",
        );
        if (unverified.length > 0) {
          await conn.rollback();
          txStarted = false;
          return res.status(400).json({
            ok: false,
            message: `File berikut belum diverifikasi: ${unverified.join(", ")}`,
          });
        }
        if (
          perluSuratKeterangan &&
          fileMap["SURAT_KETERANGAN"] !== "VERIFIED"
        ) {
          await conn.rollback();
          txStarted = false;
          return res.status(400).json({
            ok: false,
            message: "File SURAT_KETERANGAN belum diverifikasi",
          });
        }
      }

      await conn.query(
        `UPDATE pengajuan_sidang
         SET status = 'WAITING_FOR_DISPOSISI',
             catatan_sekretariat = ?,
             verified_by_user_id = ?,
             verified_at = CURRENT_TIMESTAMP,
             updated_at = CURRENT_TIMESTAMP
         WHERE id = ?`,
        [
          catatanSekretariat ? String(catatanSekretariat).trim() : null,
          req.user.id,
          sidang.id,
        ],
      );

      // Notify mahasiswa
      const [[studentRow]] = await conn.query(
        `SELECT u.id FROM users u JOIN skripsi s ON s.npm = u.npm
         WHERE s.id = ? AND u.is_active = 1 LIMIT 1`,
        [skripsiId],
      );
      if (studentRow) {
        await insertNotification(
          conn,
          studentRow.id,
          "SIDANG_WAITING_FOR_DISPOSISI",
          "Dokumen pengajuan sidang telah diverifikasi. Menunggu disposisi dari Kaprodi.",
          "/student/pengajuan-sidang",
        );
      }

      await conn.commit();
      txStarted = false;
      return res.json({
        ok: true,
        message: "Pengajuan Sidang berhasil diverifikasi",
      });
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
      `SELECT u.id FROM users u JOIN skripsi s ON s.npm = u.npm
       WHERE s.id = ? AND u.is_active = 1 LIMIT 1`,
      [skripsiId],
    );
    if (studentRow) {
      await insertNotification(
        conn,
        studentRow.id,
        "SIDANG_REJECTED",
        "Pengajuan Sidang Skripsi Anda ditolak",
        "/student/pengajuan-sidang",
      );
    }

    await conn.commit();
    txStarted = false;
    return res.json({ ok: true, message: "Pengajuan Sidang ditolak" });
  } catch (err) {
    try {
      if (txStarted) await conn.rollback();
    } catch (_) {}
    next(err);
  } finally {
    conn.release();
  }
};

exports.getFile = async (req, res, next) => {
  try {
    const skripsiId = Number(req.params.skripsiId);
    if (!Number.isFinite(skripsiId) || skripsiId <= 0) {
      return res
        .status(400)
        .json({ ok: false, message: "Invalid skripsiId" });
    }

    const fileType = req.params.fileType;
    if (!ALL_FILE_TYPES.includes(fileType)) {
      return res.status(400).json({
        ok: false,
        message: `fileType tidak valid: ${fileType}`,
      });
    }

    const sidang = await getActiveSidang(db, skripsiId);
    if (!sidang) {
      return res
        .status(404)
        .json({ ok: false, message: "Pengajuan Sidang tidak ditemukan" });
    }

    const [[file]] = await db.query(
      `SELECT id, file_type, file_name, mime_type, file_content, source, status, kaprodi_status, created_at
       FROM pengajuan_sidang_files
       WHERE pengajuan_sidang_id = ? AND file_type = ?
       ORDER BY created_at DESC LIMIT 1`,
      [sidang.id, fileType],
    );
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

exports.listForSekretariat = async (req, res, next) => {
  try {
    if (!req.user.hasRole("SEKRETARIAT")) {
      return res.status(403).json({
        ok: false,
        message: "Only sekretariat can access this endpoint",
      });
    }

    const statusParam = req.query?.status;
    const programStudiIdParam = Number(req.query?.programStudiId);
    const filterByStatus =
      statusParam && VALID_SIDANG_STATUSES.includes(statusParam);
    const filterByProdi =
      Number.isFinite(programStudiIdParam) && programStudiIdParam > 0;

    const conditions = ["ps.status != 'DRAFT'"];
    const params = [];
    if (filterByStatus) {
      conditions.push("ps.status = ?");
      params.push(statusParam);
    }
    if (filterByProdi) {
      conditions.push("sk.program_studi_id = ?");
      params.push(programStudiIdParam);
    }

    const whereClause = `WHERE ${conditions.join(" AND ")}`;

    const [rows] = await db.query(
      `SELECT
         ps.id,
         ps.skripsi_id,
         ps.status,
         ps.catatan_sekretariat,
         ps.submitted_at,
         ps.verified_at,
         ps.created_at,
         m.nama AS nama_mahasiswa,
         sk.npm,
         sk.program_studi_id,
         prog.nama AS program_studi_nama
       FROM pengajuan_sidang ps
       LEFT JOIN skripsi sk ON sk.id = ps.skripsi_id
       LEFT JOIN mahasiswa m ON m.npm = sk.npm
       LEFT JOIN program_studi prog ON prog.id = sk.program_studi_id
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
  const conn = await db.getConnection();
  let txStarted = false;
  try {
    if (req.user.userType !== "STUDENT") {
      return res.status(403).json({
        ok: false,
        message: "Only students can initialize Pengajuan Sidang Kaprodi",
      });
    }

    const skripsiId = Number(req.params.skripsiId);
    if (!Number.isFinite(skripsiId) || skripsiId <= 0) {
      return res
        .status(400)
        .json({ ok: false, message: "Invalid skripsiId" });
    }

    const npm = await getStudentNpm(req.user.id);
    if (!npm) {
      return res
        .status(400)
        .json({ ok: false, message: "Mahasiswa tidak valid" });
    }

    const [[skripsiRow]] = await conn.query(
      `SELECT id FROM skripsi WHERE id = ? AND npm = ? AND status = 'COMPLETED' LIMIT 1`,
      [skripsiId, npm],
    );
    if (!skripsiRow) {
      return res
        .status(400)
        .json({ ok: false, message: "Konsultasi skripsi belum selesai" });
    }

    // Find the current active pengajuan_sidang for this student
    const [[activeSidang]] = await conn.query(
      `SELECT id, ujian_ke FROM pengajuan_sidang
       WHERE skripsi_id = ? AND status NOT IN ('COMPLETED','REJECTED')
       ORDER BY id DESC LIMIT 1`,
      [skripsiId],
    );

    // Check if a kaprodi row already exists for this specific pengajuan_sidang
    if (activeSidang) {
      const [[existingForSidang]] = await conn.query(
        `SELECT id FROM pengajuan_sidang_kaprodi WHERE pengajuan_sidang_id = ? LIMIT 1`,
        [activeSidang.id],
      );
      if (existingForSidang) {
        return res.status(200).json({
          ok: true,
          message: "Pengajuan Sidang Kaprodi sudah ada",
          data: { id: existingForSidang.id },
        });
      }
    }

    const isUjianUlang = activeSidang && activeSidang.ujian_ke > 1;

    // Gate by period for original flow only (ujian ulang is exempt)
    if (!isUjianUlang) {
      const openPeriod = await getSidangOpenPeriod();
      if (!openPeriod) {
        return res.status(409).json({
          ok: false,
          message: "Tidak ada periode pengajuan sidang yang sedang dibuka.",
        });
      }
    }

    if (!activeSidang) {
      return res.status(500).json({
        ok: false,
        message: "Pengajuan Sidang belum dibuat",
      });
    }

    await conn.beginTransaction();
    txStarted = true;

    const [ins] = await conn.query(
      `INSERT INTO pengajuan_sidang_kaprodi (pengajuan_sidang_id, status) VALUES (?, 'DRAFT')`,
      [activeSidang.id],
    );

    if (!isUjianUlang) {
      // Original flow: auto-create DRAFT pengajuan_sidang if needed and attach system files
      let targetSidangId = activeSidang?.id;
      if (!targetSidangId) {
        const [sidangIns] = await conn.query(
          `INSERT INTO pengajuan_sidang (skripsi_id, status, ujian_ke) VALUES (?, 'DRAFT', 1)`,
          [skripsiId],
        );
        targetSidangId = sidangIns.insertId;
      }

      // Auto-pull KARTU_KONSULTASI_SKRIPSI
      const [[kartuSkripsi]] = await conn.query(
        `SELECT k.file_content, k.file_name FROM kartu_konsultasi_skripsi k WHERE k.skripsi_id = ? LIMIT 1`,
        [skripsiId],
      );
      if (kartuSkripsi?.file_content) {
        await conn.query(
          `DELETE FROM pengajuan_sidang_files WHERE pengajuan_sidang_id = ? AND file_type = 'KARTU_KONSULTASI_SKRIPSI'`,
          [targetSidangId],
        );
        await conn.query(
          `INSERT INTO pengajuan_sidang_files
             (pengajuan_sidang_id, file_type, file_name, mime_type, file_content, source, status)
           VALUES (?, 'KARTU_KONSULTASI_SKRIPSI', ?, ?, ?, 'SYSTEM', 'VERIFIED')`,
          [
            targetSidangId,
            kartuSkripsi.file_name,
            MIME_DOCX,
            kartuSkripsi.file_content,
          ],
        );
      }

      const [[skPembimbingRow]] = await conn.query(
        `SELECT f.file_content, f.file_name, f.mime_type
         FROM pengajuan_sk_penelitian_files f
         INNER JOIN pengajuan_sk_penelitian psk ON psk.id = f.pengajuan_sk_penelitian_id
         WHERE psk.outline_id = (SELECT outline_id FROM skripsi WHERE id = ? LIMIT 1)
           AND f.file_type = 'SK_PENUNJUKAN_PEMBIMBING'
         ORDER BY f.created_at DESC LIMIT 1`,
        [skripsiId],
      );
      if (skPembimbingRow) {
        await conn.query(
          `DELETE FROM pengajuan_sidang_files WHERE pengajuan_sidang_id = ? AND file_type = 'SK_PENUNJUKAN_PEMBIMBING'`,
          [targetSidangId],
        );
        await conn.query(
          `INSERT INTO pengajuan_sidang_files
             (pengajuan_sidang_id, file_type, file_name, mime_type, file_content, source, status)
           VALUES (?, 'SK_PENUNJUKAN_PEMBIMBING', ?, ?, ?, 'SYSTEM', 'VERIFIED')`,
          [
            targetSidangId,
            skPembimbingRow.file_name,
            skPembimbingRow.mime_type ?? null,
            skPembimbingRow.file_content,
          ],
        );
      }

      const [[suratPenyelesaianRow]] = await conn.query(
        `SELECT f.file_content, f.file_name, f.mime_type
         FROM pengajuan_sk_penelitian_files f
         INNER JOIN pengajuan_sk_penelitian psk ON psk.id = f.pengajuan_sk_penelitian_id
         WHERE psk.outline_id = (SELECT outline_id FROM skripsi WHERE id = ? LIMIT 1)
           AND f.file_type = 'SURAT_PENYELESAIAN_SKRIPSI'
         ORDER BY f.created_at DESC LIMIT 1`,
        [skripsiId],
      );
      if (suratPenyelesaianRow) {
        await conn.query(
          `DELETE FROM pengajuan_sidang_files WHERE pengajuan_sidang_id = ? AND file_type = 'SURAT_PERNYATAAN_PENYELESAIAN'`,
          [targetSidangId],
        );
        await conn.query(
          `INSERT INTO pengajuan_sidang_files
             (pengajuan_sidang_id, file_type, file_name, mime_type, file_content, source, status)
           VALUES (?, 'SURAT_PERNYATAAN_PENYELESAIAN', ?, ?, ?, 'SYSTEM', 'VERIFIED')`,
          [
            targetSidangId,
            suratPenyelesaianRow.file_name,
            suratPenyelesaianRow.mime_type ?? null,
            suratPenyelesaianRow.file_content,
          ],
        );
      }
    }
    // Ujian ulang: no system files; student has already uploaded BUKTI_PEMBAYARAN + BAB_1_5

    await conn.commit();
    txStarted = false;

    return res.status(201).json({
      ok: true,
      message: "Pengajuan Sidang Kaprodi dibuat",
      data: { id: ins.insertId },
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

exports.getKaprodi = async (req, res, next) => {
  try {
    const skripsiId = Number(req.params.skripsiId);
    if (!Number.isFinite(skripsiId) || skripsiId <= 0) {
      return res
        .status(400)
        .json({ ok: false, message: "Invalid skripsiId" });
    }

    const activeSidangForGet = await getActiveSidang(db, skripsiId);
    if (!activeSidangForGet) {
      return res.status(404).json({
        ok: false,
        message: "Pengajuan Sidang tidak ditemukan",
      });
    }
    const [[kaprodi]] = await db.query(
      `SELECT * FROM pengajuan_sidang_kaprodi WHERE pengajuan_sidang_id = ? LIMIT 1`,
      [activeSidangForGet.id],
    );
    if (!kaprodi) {
      return res.status(404).json({
        ok: false,
        message: "Pengajuan Sidang Kaprodi tidak ditemukan",
      });
    }

    const [[autoData]] = await db.query(
      `SELECT s.npm, m.nama AS nama_mahasiswa, m.sks, s.program_studi_id,
              ps.nama AS program_studi_nama, s.judul AS judul_skripsi,
              s.pembimbing1_nidn, d1.nama AS pembimbing1_nama,
              s.pembimbing2_nidn, d2.nama AS pembimbing2_nama,
              COALESCE(psd.ujian_ke, 0) AS ujian_ke
       FROM skripsi s
       JOIN mahasiswa m ON m.npm = s.npm
       JOIN program_studi ps ON ps.id = s.program_studi_id
       LEFT JOIN dosen d1 ON d1.nidn = s.pembimbing1_nidn
       LEFT JOIN dosen d2 ON d2.nidn = s.pembimbing2_nidn
       LEFT JOIN pengajuan_sidang psd ON psd.skripsi_id = s.id
         AND psd.status NOT IN ('REJECTED')
       WHERE s.id = ?
       ORDER BY psd.id DESC LIMIT 1`,
      [skripsiId],
    );

    const tahunMasuk = autoData?.npm
      ? "20" + String(autoData.npm).substring(0, 2)
      : null;

    const sidang = await getActiveSidang(db, skripsiId);
    let files = [];
    if (sidang) {
      const [fileRows] = await db.query(
        `SELECT id, file_type, file_name, mime_type, source, status, kaprodi_status, created_at
         FROM pengajuan_sidang_files
         WHERE pengajuan_sidang_id = ? AND file_type IN (?)
         ORDER BY file_type ASC`,
        [sidang.id, KAPRODI_FILE_TYPES],
      );
      files = fileRows;
    }

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
              ujian_ke: autoData.ujian_ke,
            }
          : null,
        files,
      },
    });
  } catch (err) {
    next(err);
  }
};

exports.updateKaprodi = async (req, res, next) => {
  try {
    if (req.user.userType !== "STUDENT") {
      return res.status(403).json({
        ok: false,
        message: "Only students can update Pengajuan Sidang Kaprodi",
      });
    }

    const skripsiId = Number(req.params.skripsiId);
    if (!Number.isFinite(skripsiId) || skripsiId <= 0) {
      return res
        .status(400)
        .json({ ok: false, message: "Invalid skripsiId" });
    }

    const activeSidangForUpdate = await getActiveSidang(db, skripsiId);
    if (!activeSidangForUpdate) {
      return res.status(404).json({
        ok: false,
        message: "Pengajuan Sidang tidak ditemukan",
      });
    }
    const [[kaprodi]] = await db.query(
      `SELECT * FROM pengajuan_sidang_kaprodi WHERE pengajuan_sidang_id = ? LIMIT 1`,
      [activeSidangForUpdate.id],
    );
    if (!kaprodi) {
      return res.status(404).json({
        ok: false,
        message: "Pengajuan Sidang Kaprodi tidak ditemukan",
      });
    }
    if (kaprodi.status !== "DRAFT" && kaprodi.status !== "NEED_REVISION") {
      return res.status(409).json({
        ok: false,
        message: "Data hanya bisa diubah saat status DRAFT atau NEED_REVISION",
      });
    }

    const {
      tempatLahir,
      tglLahir,
      alamat,
      noHp,
      noWa,
      statusPernikahan,
      ipk,
      semuaMkLulus,
      penguji1Nidn,
      penguji2Nidn,
    } = req.body ?? {};

    const setClauses = [];
    const params = [];

    if (tempatLahir !== undefined) {
      setClauses.push("tempat_lahir = ?");
      params.push(String(tempatLahir).trim() || null);
    }
    if (tglLahir !== undefined) {
      setClauses.push("tgl_lahir = ?");
      params.push(tglLahir || null);
    }
    if (alamat !== undefined) {
      setClauses.push("alamat = ?");
      params.push(String(alamat).trim() || null);
    }
    if (noHp !== undefined) {
      setClauses.push("no_hp = ?");
      params.push(String(noHp).trim() || null);
    }
    if (noWa !== undefined) {
      setClauses.push("no_wa = ?");
      params.push(String(noWa).trim() || null);
    }
    if (statusPernikahan !== undefined) {
      setClauses.push("status_pernikahan = ?");
      params.push(
        statusPernikahan === "Belum Menikah" ||
          statusPernikahan === "Sudah Menikah"
          ? statusPernikahan
          : null,
      );
    }
    if (ipk !== undefined) {
      setClauses.push("ipk = ?");
      params.push(ipk !== null && ipk !== "" ? Number(ipk) : null);
    }
    if (semuaMkLulus !== undefined) {
      setClauses.push("semua_mk_lulus = ?");
      params.push(semuaMkLulus ? 1 : 0);
    }
    if (penguji1Nidn !== undefined) {
      setClauses.push("penguji1_nidn = ?");
      params.push(String(penguji1Nidn).trim() || null);
    }
    if (penguji2Nidn !== undefined) {
      setClauses.push("penguji2_nidn = ?");
      params.push(String(penguji2Nidn).trim() || null);
    }

    if (setClauses.length === 0) {
      return res
        .status(400)
        .json({ ok: false, message: "Tidak ada field yang diupdate" });
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

    return res.json({
      ok: true,
      message: "Data berhasil diperbarui",
      data: updated,
    });
  } catch (err) {
    next(err);
  }
};

exports.submitKaprodi = async (req, res, next) => {
  const conn = await db.getConnection();
  let txStarted = false;
  try {
    if (req.user.userType !== "STUDENT") {
      return res.status(403).json({
        ok: false,
        message: "Only students can submit Pengajuan Sidang Kaprodi",
      });
    }

    const skripsiId = Number(req.params.skripsiId);
    if (!Number.isFinite(skripsiId) || skripsiId <= 0) {
      return res
        .status(400)
        .json({ ok: false, message: "Invalid skripsiId" });
    }

    const npm = await getStudentNpm(req.user.id);
    if (!npm) {
      return res
        .status(400)
        .json({ ok: false, message: "Mahasiswa tidak valid" });
    }

    await conn.beginTransaction();
    txStarted = true;

    const activeSidangForSubmit = await getActiveSidang(conn, skripsiId);
    const [[kaprodi]] = activeSidangForSubmit
      ? await conn.query(
          `SELECT * FROM pengajuan_sidang_kaprodi WHERE pengajuan_sidang_id = ? LIMIT 1 FOR UPDATE`,
          [activeSidangForSubmit.id],
        )
      : [[null]];
    if (!kaprodi) {
      await conn.rollback();
      txStarted = false;
      return res.status(404).json({
        ok: false,
        message: "Pengajuan Sidang Kaprodi tidak ditemukan",
      });
    }
    if (kaprodi.status !== "DRAFT" && kaprodi.status !== "NEED_REVISION") {
      await conn.rollback();
      txStarted = false;
      return res.status(409).json({
        ok: false,
        message:
          "Pengajuan Sidang Kaprodi hanya bisa disubmit saat status DRAFT atau NEED_REVISION",
      });
    }

    const missingFields = [];
    if (!kaprodi.tempat_lahir) missingFields.push("tempatLahir");
    if (!kaprodi.tgl_lahir) missingFields.push("tglLahir");
    if (!kaprodi.alamat) missingFields.push("alamat");
    if (!kaprodi.no_hp) missingFields.push("noHp");
    if (!kaprodi.no_wa) missingFields.push("noWa");
    if (kaprodi.ipk == null) missingFields.push("ipk");
    if (!kaprodi.penguji1_nidn) missingFields.push("penguji1Nidn");
    if (!kaprodi.penguji2_nidn) missingFields.push("penguji2Nidn");
    if (!kaprodi.status_pernikahan) missingFields.push("statusPernikahan");
    if (missingFields.length > 0) {
      await conn.rollback();
      txStarted = false;
      return res.status(400).json({
        ok: false,
        message: `Field berikut belum diisi: ${missingFields.join(", ")}`,
      });
    }
    if (!kaprodi.semua_mk_lulus) {
      await conn.rollback();
      txStarted = false;
      return res.status(400).json({
        ok: false,
        message: "Konfirmasi seluruh mata kuliah sudah lulus harus dicentang",
      });
    }

    await conn.query(
      `UPDATE pengajuan_sidang_kaprodi
       SET status = 'SUBMITTED', submitted_at = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP
       WHERE id = ?`,
      [kaprodi.id],
    );

    // Generate LEMBAR_PERMOHONAN_UJIAN
    const [[docData]] = await conn.query(
      `SELECT s.npm, m.nama AS nama_mahasiswa, m.sks,
              ps.nama AS prodi_nama, f.nama AS fakultas_nama,
              s.judul AS judul_skripsi,
              d1.nama AS dospem1_nama,
              d2.nama AS dospem2_nama,
              u_kaprodi.signature_image AS kaprodi_sig,
              d_kaprodi.nama AS nama_kaprodi,
              u_mhs.signature_image AS mahasiswa_sig
       FROM skripsi s
       JOIN mahasiswa m ON m.npm = s.npm
       JOIN program_studi ps ON ps.id = s.program_studi_id
       LEFT JOIN dosen d1 ON d1.nidn = s.pembimbing1_nidn
       LEFT JOIN dosen d2 ON d2.nidn = s.pembimbing2_nidn
       LEFT JOIN fakultas f ON f.id = ps.fakultas_id
       LEFT JOIN users u_kaprodi ON u_kaprodi.nidn = ps.kaprodi_nidn
         AND u_kaprodi.is_active = 1
         AND EXISTS (
           SELECT 1 FROM user_roles ur2
           INNER JOIN roles r2 ON r2.id = ur2.role_id
           WHERE ur2.user_id = u_kaprodi.id AND r2.code = 'KAPRODI'
         )
       LEFT JOIN dosen d_kaprodi ON d_kaprodi.nidn = ps.kaprodi_nidn
       LEFT JOIN users u_mhs ON u_mhs.npm = s.npm AND u_mhs.is_active = 1
       WHERE s.id = ? LIMIT 1`,
      [skripsiId],
    );

    const todayDate = formatTanggalIndonesia(new Date());
    const tahunMasuk = docData?.npm
      ? "20" + String(docData.npm).substring(0, 2)
      : "";
    const tglLahirFormatted = kaprodi.tgl_lahir
      ? formatTanggalIndonesia(new Date(kaprodi.tgl_lahir))
      : "";
    const ttl = `${kaprodi.tempat_lahir ?? ""}, ${tglLahirFormatted}`;
    const ujianCount = activeSidangForSubmit?.ujian_ke ?? 1;
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
       WHERE skripsi_id = ? AND status NOT IN ('VERIFIED','WAITING_FOR_DISPOSISI','WAITING_FOR_SURAT','COMPLETED','REJECTED')
       ORDER BY created_at DESC LIMIT 1`,
      [skripsiId],
    );
    if (!existingSidang) {
      const [ins] = await conn.query(
        `INSERT INTO pengajuan_sidang (skripsi_id, status) VALUES (?, 'DRAFT')`,
        [skripsiId],
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
       VALUES (?, 'LEMBAR_PERMOHONAN_UJIAN', ?, ?, ?, 'SYSTEM', 'VERIFIED')`,
      [
        existingSidang.id,
        `Lembar_Permohonan_Ujian_${npm}.docx`,
        MIME_DOCX,
        lembarBase64,
      ],
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
       VALUES (?, 'SURAT_PERNYATAAN_PERBAIKAN', ?, ?, ?, 'SYSTEM', 'VERIFIED')`,
      [
        existingSidang.id,
        `Surat_Pernyataan_Perbaikan_${npm}.docx`,
        MIME_DOCX,
        perbaikanBase64,
      ],
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
       VALUES (?, 'SURAT_PERNYATAAN_KELENGKAPAN', ?, ?, ?, 'SYSTEM', 'VERIFIED')`,
      [
        existingSidang.id,
        `Surat_Pernyataan_Kelengkapan_${npm}.docx`,
        MIME_DOCX,
        kelengkapanBase64,
      ],
    );

    // Generate LEMBAR_USULAN_PENGUJI
    const [[pg1RowUsulan]] = await conn.query(
      `SELECT nama FROM dosen WHERE nidn = ? LIMIT 1`,
      [kaprodi.penguji1_nidn],
    );
    const [[pg2RowUsulan]] = await conn.query(
      `SELECT nama FROM dosen WHERE nidn = ? LIMIT 1`,
      [kaprodi.penguji2_nidn],
    );
    const usulanBuffer = await buildLembarUsulanPengujiBuffer({
      prodi: docData?.prodi_nama ?? "",
      fakultas: docData?.fakultas_nama ?? "",
      namaMahasiswa: docData?.nama_mahasiswa ?? npm,
      npm: docData?.npm ?? npm,
      namaDospem1: docData?.dospem1_nama ?? "",
      namaDospem2: docData?.dospem2_nama ?? "",
      judul: docData?.judul_skripsi ?? "",
      todayDate,
      penguji1Nama: pg1RowUsulan?.nama ?? null,
      penguji2Nama: pg2RowUsulan?.nama ?? null,
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
       VALUES (?, 'LEMBAR_USULAN_PENGUJI', ?, ?, ?, 'SYSTEM', 'VERIFIED')`,
      [
        existingSidang.id,
        `Lembar_Usulan_Penguji_${npm}.docx`,
        MIME_DOCX,
        usulanBase64,
      ],
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
          conn,
          ku.id,
          "SIDANG_KAPRODI_SUBMITTED",
          `Mahasiswa ${namaMahasiswa} mengajukan permohonan sidang skripsi`,
          "/kaprodi/pengajuan-sidang-kaprodi",
        );
      }
    }

    await conn.commit();
    txStarted = false;

    return res.json({
      ok: true,
      message: "Pengajuan Sidang Kaprodi berhasil disubmit",
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

exports.reviewFileKaprodi = async (req, res, next) => {
  const conn = await db.getConnection();
  let txStarted = false;
  try {
    if (!req.user.hasRole("KAPRODI")) {
      return res
        .status(403)
        .json({ ok: false, message: "Only kaprodi can review files" });
    }

    const skripsiId = Number(req.params.skripsiId);
    if (!Number.isFinite(skripsiId) || skripsiId <= 0) {
      return res
        .status(400)
        .json({ ok: false, message: "Invalid skripsiId" });
    }

    const fileType = req.params.fileType;
    if (!KAPRODI_FILE_TYPES.includes(fileType)) {
      return res.status(400).json({
        ok: false,
        message: `fileType tidak valid untuk verifikasi Kaprodi: ${fileType}`,
      });
    }

    const { status } = req.body ?? {};
    if (!VALID_FILE_STATUSES.includes(status)) {
      return res.status(400).json({
        ok: false,
        message: `status harus salah satu dari: ${VALID_FILE_STATUSES.join(", ")}`,
      });
    }

    const nidn = await getLecturerNidn(req.user.id);
    if (!nidn) {
      return res
        .status(400)
        .json({ ok: false, message: "Data dosen tidak valid" });
    }
    const kaprodiProgramStudiIds = await getKaprodiProgramStudiIdsByNidn(nidn);

    await conn.beginTransaction();
    txStarted = true;

    const sidang = await getActiveSidang(conn, skripsiId);
    if (!sidang) {
      await conn.rollback();
      txStarted = false;
      return res
        .status(404)
        .json({ ok: false, message: "Pengajuan Sidang tidak ditemukan" });
    }
    const [[kaprodi]] = await conn.query(
      `SELECT psk.*, s.program_studi_id
       FROM pengajuan_sidang_kaprodi psk
       JOIN pengajuan_sidang ps ON ps.id = psk.pengajuan_sidang_id
       JOIN skripsi s ON s.id = ps.skripsi_id
       WHERE psk.pengajuan_sidang_id = ? LIMIT 1 FOR UPDATE`,
      [sidang.id],
    );
    if (!kaprodi) {
      await conn.rollback();
      txStarted = false;
      return res.status(404).json({
        ok: false,
        message: "Pengajuan Sidang Kaprodi tidak ditemukan",
      });
    }

    if (!kaprodiProgramStudiIds.includes(Number(kaprodi.program_studi_id))) {
      await conn.rollback();
      txStarted = false;
      return res.status(403).json({
        ok: false,
        message: "Anda tidak memiliki akses ke pengajuan ini",
      });
    }

    if (kaprodi.status !== "SUBMITTED") {
      await conn.rollback();
      txStarted = false;
      return res.status(409).json({
        ok: false,
        message:
          "Review file hanya bisa dilakukan saat Pengajuan Sidang Kaprodi berstatus SUBMITTED",
      });
    }

    const [[fileRow]] = await conn.query(
      `SELECT id FROM pengajuan_sidang_files WHERE pengajuan_sidang_id = ? AND file_type = ? LIMIT 1`,
      [sidang.id, fileType],
    );
    if (!fileRow) {
      await conn.rollback();
      txStarted = false;
      return res
        .status(404)
        .json({ ok: false, message: `File ${fileType} tidak ditemukan` });
    }

    await conn.query(
      `UPDATE pengajuan_sidang_files SET kaprodi_status = ? WHERE id = ?`,
      [status, fileRow.id],
    );

    await conn.commit();
    txStarted = false;

    return res.json({
      ok: true,
      message: `Status file ${fileType} diperbarui oleh Kaprodi`,
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

exports.reviewKaprodi = async (req, res, next) => {
  const conn = await db.getConnection();
  let txStarted = false;
  try {
    if (!req.user.hasRole("KAPRODI")) {
      return res.status(403).json({
        ok: false,
        message: "Only kaprodi can review Pengajuan Sidang Kaprodi",
      });
    }

    const skripsiId = Number(req.params.skripsiId);
    if (!Number.isFinite(skripsiId) || skripsiId <= 0) {
      return res
        .status(400)
        .json({ ok: false, message: "Invalid skripsiId" });
    }

    const { action, catatanKaprodi } = req.body ?? {};
    if (
      action !== "VALID" &&
      action !== "NEED_REVISION" &&
      action !== "REJECTED"
    ) {
      return res.status(400).json({
        ok: false,
        message: "action harus 'VALID', 'NEED_REVISION', atau 'REJECTED'",
      });
    }
    if (
      (action === "NEED_REVISION" || action === "REJECTED") &&
      (!catatanKaprodi || !String(catatanKaprodi).trim())
    ) {
      return res
        .status(400)
        .json({ ok: false, message: "catatanKaprodi wajib diisi" });
    }

    const nidn = await getLecturerNidn(req.user.id);
    if (!nidn) {
      return res
        .status(400)
        .json({ ok: false, message: "Data dosen tidak valid" });
    }
    const kaprodiProgramStudiIds = await getKaprodiProgramStudiIdsByNidn(nidn);

    await conn.beginTransaction();
    txStarted = true;

    const activeSidangForReview = await getActiveSidang(conn, skripsiId);
    const [[kaprodi]] = activeSidangForReview
      ? await conn.query(
          `SELECT psk.*, s.program_studi_id
           FROM pengajuan_sidang_kaprodi psk
           JOIN pengajuan_sidang ps ON ps.id = psk.pengajuan_sidang_id
           JOIN skripsi s ON s.id = ps.skripsi_id
           WHERE psk.pengajuan_sidang_id = ? LIMIT 1 FOR UPDATE`,
          [activeSidangForReview.id],
        )
      : [[null]];
    if (!kaprodi) {
      await conn.rollback();
      txStarted = false;
      return res.status(404).json({
        ok: false,
        message: "Pengajuan Sidang Kaprodi tidak ditemukan",
      });
    }

    if (!kaprodiProgramStudiIds.includes(Number(kaprodi.program_studi_id))) {
      await conn.rollback();
      txStarted = false;
      return res.status(403).json({
        ok: false,
        message: "Anda tidak memiliki akses ke pengajuan ini",
      });
    }

    if (kaprodi.status !== "SUBMITTED") {
      await conn.rollback();
      txStarted = false;
      return res.status(409).json({
        ok: false,
        message:
          "Pengajuan Sidang Kaprodi harus berstatus SUBMITTED untuk direview",
      });
    }

    if (action === "VALID") {
      const sidang = activeSidangForReview;
      if (!sidang) {
        await conn.rollback();
        txStarted = false;
        return res
          .status(409)
          .json({ ok: false, message: "Belum ada Pengajuan Sidang terkait" });
      }
      const [fileRows] = await conn.query(
        `SELECT file_type, kaprodi_status FROM pengajuan_sidang_files
         WHERE pengajuan_sidang_id = ? AND file_type IN (?)`,
        [sidang.id, KAPRODI_REQUIRED_FILE_TYPES],
      );
      const verifiedSet = new Set(
        fileRows
          .filter((r) => r.kaprodi_status === "VERIFIED")
          .map((r) => r.file_type),
      );
      const unverifiedFiles = KAPRODI_REQUIRED_FILE_TYPES.filter(
        (t) => !verifiedSet.has(t),
      );
      if (unverifiedFiles.length > 0) {
        await conn.rollback();
        txStarted = false;
        return res.status(409).json({
          ok: false,
          message: "Semua file skripsi harus diverifikasi sebelum menyetujui",
          unverifiedFiles,
        });
      }
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
      [
        newStatus,
        catatanKaprodi ? String(catatanKaprodi).trim() : null,
        req.user.id,
        kaprodi.id,
      ],
    );

    const [[studentRow]] = await conn.query(
      `SELECT u.id FROM users u JOIN skripsi s ON s.npm = u.npm
       WHERE s.id = ? AND u.is_active = 1 LIMIT 1`,
      [skripsiId],
    );

    if (studentRow) {
      const notifMap = {
        VALID: [
          "SIDANG_KAPRODI_VALID",
          "Pengajuan sidang Anda telah disetujui oleh Kaprodi",
        ],
        NEED_REVISION: [
          "SIDANG_KAPRODI_NEED_REVISION",
          "Kaprodi meminta revisi pada pengajuan sidang Anda",
        ],
        REJECTED: [
          "SIDANG_KAPRODI_REJECTED",
          "Pengajuan sidang Anda ditolak oleh Kaprodi",
        ],
      };
      const [notifType, notifMsg] = notifMap[action];
      await insertNotification(
        conn,
        studentRow.id,
        notifType,
        notifMsg,
        "/student/pengajuan-sidang",
      );
    }

    await conn.commit();
    txStarted = false;

    const msgMap = {
      VALID: "disetujui",
      NEED_REVISION: "dikembalikan untuk revisi",
      REJECTED: "ditolak",
    };
    return res.json({
      ok: true,
      message: `Pengajuan Sidang Kaprodi ${msgMap[action]}`,
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

exports.listKaprodiSubmissions = async (req, res, next) => {
  try {
    if (!req.user.hasRole("KAPRODI")) {
      return res
        .status(403)
        .json({ ok: false, message: "Only kaprodi can access this endpoint" });
    }

    const nidn = await getLecturerNidn(req.user.id);
    if (!nidn) {
      return res
        .status(400)
        .json({ ok: false, message: "Data dosen tidak valid" });
    }
    const kaprodiProgramStudiIds = await getKaprodiProgramStudiIdsByNidn(nidn);
    if (kaprodiProgramStudiIds.length === 0) {
      return res.json({ ok: true, data: [] });
    }

    const statusParam = req.query?.status;
    const filterByStatus =
      statusParam && VALID_KAPRODI_STATUSES.includes(statusParam);

    const conditions = [
      `ps.id IN (${kaprodiProgramStudiIds.map(() => "?").join(",")})`,
      `psk.status != 'DRAFT'`,
    ];
    const params = [...kaprodiProgramStudiIds];

    if (filterByStatus) {
      conditions.push("psk.status = ?");
      params.push(statusParam);
    }

    const [rows] = await db.query(
      `SELECT
         psk.id,
         pengajuan_sidang.skripsi_id,
         psk.status,
         psk.catatan_kaprodi,
         psk.submitted_at,
         psk.reviewed_at,
         psk.created_at,
         s.npm,
         m.nama AS nama_mahasiswa,
         s.program_studi_id,
         ps.nama AS program_studi_nama,
         s.judul AS judul_skripsi
       FROM pengajuan_sidang_kaprodi psk
       JOIN pengajuan_sidang ON pengajuan_sidang.id = psk.pengajuan_sidang_id
       JOIN skripsi s ON s.id = pengajuan_sidang.skripsi_id
       JOIN mahasiswa m ON m.npm = s.npm
       JOIN program_studi ps ON ps.id = s.program_studi_id
       WHERE ${conditions.join(" AND ")}
       ORDER BY psk.submitted_at DESC`,
      params,
    );

    return res.json({ ok: true, data: rows });
  } catch (err) {
    next(err);
  }
};

exports.updateDisposisi = async (req, res, next) => {
  try {
    if (!req.user.hasRole("KAPRODI")) {
      return res
        .status(403)
        .json({ ok: false, message: "Only kaprodi can update disposisi" });
    }

    const skripsiId = Number(req.params.skripsiId);
    if (!Number.isFinite(skripsiId) || skripsiId <= 0) {
      return res
        .status(400)
        .json({ ok: false, message: "Invalid skripsiId" });
    }

    const nidn = await getLecturerNidn(req.user.id);
    if (!nidn) {
      return res
        .status(400)
        .json({ ok: false, message: "Data dosen tidak valid" });
    }
    const kaprodiProgramStudiIds = await getKaprodiProgramStudiIdsByNidn(nidn);

    const activeSidangForUpdate = await getActiveSidang(db, skripsiId);
    const [[kaprodi]] = activeSidangForUpdate
      ? await db.query(
          `SELECT psk.*, s.program_studi_id
           FROM pengajuan_sidang_kaprodi psk
           JOIN pengajuan_sidang ps ON ps.id = psk.pengajuan_sidang_id
           JOIN skripsi s ON s.id = ps.skripsi_id
           WHERE psk.pengajuan_sidang_id = ? LIMIT 1`,
          [activeSidangForUpdate.id],
        )
      : [[null]];
    if (!kaprodi) {
      return res.status(404).json({
        ok: false,
        message: "Pengajuan Sidang Kaprodi tidak ditemukan",
      });
    }
    if (!kaprodiProgramStudiIds.includes(Number(kaprodi.program_studi_id))) {
      return res.status(403).json({
        ok: false,
        message: "Anda tidak memiliki akses ke pengajuan ini",
      });
    }
    if (kaprodi.status !== "VALID" && kaprodi.status !== "DISPOSISI_SENT") {
      return res.status(409).json({
        ok: false,
        message:
          "Disposisi hanya bisa diubah saat status VALID atau DISPOSISI_SENT",
      });
    }

    const {
      tanggalSidang,
      waktuSidang,
      tempatSidang,
      tanggalDisposisi,
      penguji1Nidn,
      penguji2Nidn,
    } = req.body ?? {};

    const updates = {};
    if (tanggalSidang !== undefined)
      updates.tanggal_sidang = tanggalSidang || null;
    if (waktuSidang !== undefined) updates.waktu_sidang = waktuSidang || null;
    if (tempatSidang !== undefined)
      updates.tempat_sidang = tempatSidang ? String(tempatSidang).trim() : null;
    if (tanggalDisposisi !== undefined)
      updates.tanggal_disposisi = tanggalDisposisi || null;
    if (penguji1Nidn !== undefined)
      updates.penguji1_nidn = penguji1Nidn ? String(penguji1Nidn).trim() : null;
    if (penguji2Nidn !== undefined)
      updates.penguji2_nidn = penguji2Nidn ? String(penguji2Nidn).trim() : null;

    if (Object.keys(updates).length === 0) {
      return res
        .status(400)
        .json({ ok: false, message: "Tidak ada field yang diubah" });
    }

    const setClauses = Object.keys(updates)
      .map((k) => `${k} = ?`)
      .join(", ");
    const setValues = Object.values(updates);

    await db.query(
      `UPDATE pengajuan_sidang_kaprodi SET ${setClauses}, updated_at = CURRENT_TIMESTAMP WHERE id = ?`,
      [...setValues, kaprodi.id],
    );

    return res.json({ ok: true, message: "Data disposisi disimpan" });
  } catch (err) {
    next(err);
  }
};

exports.submitDisposisi = async (req, res, next) => {
  const conn = await db.getConnection();
  let txStarted = false;
  try {
    if (!req.user.hasRole("KAPRODI")) {
      return res
        .status(403)
        .json({ ok: false, message: "Only kaprodi can submit disposisi" });
    }

    const skripsiId = Number(req.params.skripsiId);
    if (!Number.isFinite(skripsiId) || skripsiId <= 0) {
      return res
        .status(400)
        .json({ ok: false, message: "Invalid skripsiId" });
    }

    const nidn = await getLecturerNidn(req.user.id);
    if (!nidn) {
      return res
        .status(400)
        .json({ ok: false, message: "Data dosen tidak valid" });
    }
    const kaprodiProgramStudiIds = await getKaprodiProgramStudiIdsByNidn(nidn);

    await conn.beginTransaction();
    txStarted = true;

    const activeSidangForDisposisi = await getActiveSidang(conn, skripsiId);
    const [[kaprodi]] = activeSidangForDisposisi
      ? await conn.query(
          `SELECT psk.*, s.program_studi_id
           FROM pengajuan_sidang_kaprodi psk
           JOIN pengajuan_sidang ps ON ps.id = psk.pengajuan_sidang_id
           JOIN skripsi s ON s.id = ps.skripsi_id
           WHERE psk.pengajuan_sidang_id = ? LIMIT 1 FOR UPDATE`,
          [activeSidangForDisposisi.id],
        )
      : [[null]];
    if (!kaprodi) {
      await conn.rollback();
      txStarted = false;
      return res.status(404).json({
        ok: false,
        message: "Pengajuan Sidang Kaprodi tidak ditemukan",
      });
    }
    if (!kaprodiProgramStudiIds.includes(Number(kaprodi.program_studi_id))) {
      await conn.rollback();
      txStarted = false;
      return res.status(403).json({
        ok: false,
        message: "Anda tidak memiliki akses ke pengajuan ini",
      });
    }
    if (kaprodi.status !== "VALID" && kaprodi.status !== "DISPOSISI_SENT") {
      await conn.rollback();
      txStarted = false;
      return res.status(409).json({
        ok: false,
        message:
          "Disposisi hanya bisa disubmit saat status VALID atau DISPOSISI_SENT",
      });
    }

    const missingDisposisi = [];
    if (!kaprodi.tanggal_sidang) missingDisposisi.push("tanggalSidang");
    if (!kaprodi.waktu_sidang) missingDisposisi.push("waktuSidang");
    if (!kaprodi.tempat_sidang) missingDisposisi.push("tempatSidang");
    if (!kaprodi.tanggal_disposisi) missingDisposisi.push("tanggalDisposisi");
    if (!kaprodi.penguji1_nidn) missingDisposisi.push("penguji1Nidn");
    if (!kaprodi.penguji2_nidn) missingDisposisi.push("penguji2Nidn");
    if (missingDisposisi.length > 0) {
      await conn.rollback();
      txStarted = false;
      return res.status(400).json({
        ok: false,
        message: `Field disposisi berikut belum diisi: ${missingDisposisi.join(", ")}`,
      });
    }

    const sidang = await getActiveSidang(conn, skripsiId);
    if (
      !sidang ||
      !["VERIFIED", "WAITING_FOR_DISPOSISI"].includes(sidang.status)
    ) {
      await conn.rollback();
      txStarted = false;
      return res.status(409).json({
        ok: false,
        message:
          "Pengajuan Sidang harus berstatus WAITING_FOR_DISPOSISI sebelum mengirim disposisi",
      });
    }

    const [[docData]] = await conn.query(
      `SELECT
         s.npm, m.nama AS nama_mahasiswa,
         ps.nama AS prodi_nama,
         f.nama AS fakultas_nama,
         s.judul AS judul_skripsi,
         d1.nama AS dospem1_nama,
         d2.nama AS dospem2_nama,
         u_kaprodi.signature_image AS kaprodi_sig,
         d_kaprodi.nama AS nama_kaprodi,
         u_mhs.signature_image AS mahasiswa_sig
       FROM skripsi s
       JOIN mahasiswa m ON m.npm = s.npm
       JOIN program_studi ps ON ps.id = s.program_studi_id
       LEFT JOIN dosen d1 ON d1.nidn = s.pembimbing1_nidn
       LEFT JOIN dosen d2 ON d2.nidn = s.pembimbing2_nidn
       LEFT JOIN fakultas f ON f.id = ps.fakultas_id
       LEFT JOIN users u_kaprodi ON u_kaprodi.nidn = ps.kaprodi_nidn
         AND u_kaprodi.is_active = 1
         AND EXISTS (
           SELECT 1 FROM user_roles ur2
           INNER JOIN roles r2 ON r2.id = ur2.role_id
           WHERE ur2.user_id = u_kaprodi.id AND r2.code = 'KAPRODI'
         )
       LEFT JOIN dosen d_kaprodi ON d_kaprodi.nidn = ps.kaprodi_nidn
       LEFT JOIN users u_mhs ON u_mhs.npm = s.npm AND u_mhs.is_active = 1
       WHERE s.id = ? LIMIT 1`,
      [skripsiId],
    );

    const npm = docData?.npm ?? "";
    const sidangDateFormatted = kaprodi.tanggal_sidang
      ? formatTanggalIndonesia(new Date(kaprodi.tanggal_sidang))
      : "";
    const disposisiDateFormatted = kaprodi.tanggal_disposisi
      ? formatTanggalIndonesia(new Date(kaprodi.tanggal_disposisi))
      : "";
    const waktuSidangFormatted = kaprodi.waktu_sidang
      ? String(kaprodi.waktu_sidang).substring(0, 5)
      : "";

    const [[pg1RowDisposisi]] = await conn.query(
      `SELECT nama FROM dosen WHERE nidn = ? LIMIT 1`,
      [kaprodi.penguji1_nidn],
    );
    const [[pg2RowDisposisi]] = await conn.query(
      `SELECT nama FROM dosen WHERE nidn = ? LIMIT 1`,
      [kaprodi.penguji2_nidn],
    );
    const usulanBuffer = await buildLembarUsulanPengujiBufferFull({
      prodi: docData?.prodi_nama ?? "",
      fakultas: docData?.fakultas_nama ?? "",
      namaMahasiswa: docData?.nama_mahasiswa ?? npm,
      npm,
      namaDospem1: docData?.dospem1_nama ?? "",
      namaDospem2: docData?.dospem2_nama ?? "",
      judul: docData?.judul_skripsi ?? "",
      todayDate: formatTanggalIndonesia(new Date()),
      penguji1Nama: pg1RowDisposisi?.nama ?? null,
      penguji2Nama: pg2RowDisposisi?.nama ?? null,
      ttdMahasiswa: docData?.mahasiswa_sig ?? null,
      namaKaprodi: docData?.nama_kaprodi ?? "",
      sidangDate: sidangDateFormatted,
      sidangTime: waktuSidangFormatted,
      disposisiDate: disposisiDateFormatted,
      ttdKaprodi: docData?.kaprodi_sig ?? null,
    });
    const usulanBase64 = usulanBuffer.toString("base64");

    await conn.query(
      `DELETE FROM pengajuan_sidang_files WHERE pengajuan_sidang_id = ? AND file_type = 'LEMBAR_USULAN_PENGUJI'`,
      [sidang.id],
    );
    await conn.query(
      `INSERT INTO pengajuan_sidang_files
         (pengajuan_sidang_id, file_type, file_name, mime_type, file_content, source, status)
       VALUES (?, 'LEMBAR_USULAN_PENGUJI', ?, ?, ?, 'SYSTEM', 'VERIFIED')`,
      [sidang.id, `Lembar_Usulan_Penguji_${npm}.docx`, MIME_DOCX, usulanBase64],
    );

    await conn.query(
      `UPDATE pengajuan_sidang_kaprodi
       SET status = 'DISPOSISI_SENT', disposisi_submitted_at = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP
       WHERE id = ?`,
      [kaprodi.id],
    );

    await conn.query(
      `UPDATE pengajuan_sidang
       SET status = 'WAITING_FOR_SURAT', updated_at = CURRENT_TIMESTAMP
       WHERE id = ?`,
      [sidang.id],
    );

    const namaMahasiswa = docData?.nama_mahasiswa ?? npm;

    // Notify mahasiswa that schedule has been set and surat is pending
    const [[studentRow]] = await conn.query(
      `SELECT u.id FROM users u
       JOIN skripsi s ON s.npm = u.npm
       WHERE s.id = ? AND u.is_active = 1 LIMIT 1`,
      [skripsiId],
    );
    if (studentRow) {
      await insertNotification(
        conn,
        studentRow.id,
        "SIDANG_DISPOSISI_SUBMITTED",
        "Kaprodi telah mengisi jadwal sidang. Menunggu surat undangan dari Sekretariat.",
        "/student/pengajuan-sidang",
      );
    }

    const [sekRows] = await conn.query(
      `SELECT u.id FROM users u
       JOIN user_roles ur ON ur.user_id = u.id
       JOIN roles r ON r.id = ur.role_id
       WHERE r.code = 'SEKRETARIAT'`,
    );
    for (const sek of sekRows) {
      await insertNotification(
        conn,
        sek.id,
        "DISPOSISI_SIDANG_SENT",
        `Kaprodi telah mengirim disposisi penguji dan jadwal sidang untuk mahasiswa ${namaMahasiswa}`,
        "/sekretariat/disposisi-sidang",
      );
    }

    await conn.commit();
    txStarted = false;

    return res.json({
      ok: true,
      message: "Disposisi berhasil dikirim ke Sekretariat",
      data: {
        id: kaprodi.id,
        status: "DISPOSISI_SENT",
        disposisiSubmittedAt: new Date(),
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

exports.listDisposisiForSekretariat = async (req, res, next) => {
  try {
    if (!req.user.hasRole("SEKRETARIAT")) {
      return res.status(403).json({
        ok: false,
        message: "Only sekretariat can access this endpoint",
      });
    }

    const statusParam = req.query?.status;
    const validDisposisiStatuses = ["VALID", "DISPOSISI_SENT", "COMPLETED"];
    const filterByStatus =
      statusParam && validDisposisiStatuses.includes(statusParam);

    const programStudiIdParam = Number(req.query?.programStudiId);
    const filterByProdi =
      Number.isFinite(programStudiIdParam) && programStudiIdParam > 0;

    const conditions = [
      `psk.status IN ('VALID','DISPOSISI_SENT','COMPLETED')`,
    ];
    const params = [];

    if (filterByStatus) {
      conditions[0] = `psk.status = ?`;
      params.push(statusParam);
    }
    if (filterByProdi) {
      conditions.push("s.program_studi_id = ?");
      params.push(programStudiIdParam);
    }

    const [rows] = await db.query(
      `SELECT
         ps2.id AS pengajuan_sidang_id,
         ps2.skripsi_id,
         m.nama AS nama_mahasiswa,
         s.npm,
         prog.nama AS program_studi_nama,
         s.judul AS judul_skripsi,
         psk.status AS kaprodi_status,
         psk.tanggal_sidang,
         psk.waktu_sidang,
         psk.tempat_sidang,
         psk.tanggal_disposisi,
         psk.penguji1_nidn,
         d_pg1.nama AS penguji1_nama,
         psk.penguji2_nidn,
         d_pg2.nama AS penguji2_nama,
         psk.disposisi_submitted_at
       FROM pengajuan_sidang_kaprodi psk
       JOIN pengajuan_sidang ps2 ON ps2.id = psk.pengajuan_sidang_id
       JOIN skripsi s ON s.id = ps2.skripsi_id
       JOIN mahasiswa m ON m.npm = s.npm
       JOIN program_studi prog ON prog.id = s.program_studi_id
       LEFT JOIN dosen d_pg1 ON d_pg1.nidn = psk.penguji1_nidn
       LEFT JOIN dosen d_pg2 ON d_pg2.nidn = psk.penguji2_nidn
       WHERE ${conditions.join(" AND ")}
         AND ps2.status IN ('VERIFIED','WAITING_FOR_DISPOSISI','WAITING_FOR_SURAT','COMPLETED','REJECTED')
       ORDER BY psk.disposisi_submitted_at DESC, psk.reviewed_at DESC`,
      params,
    );

    return res.json({ ok: true, data: rows });
  } catch (err) {
    next(err);
  }
};

exports.generateSuratUndangan = async (req, res, next) => {
  const conn = await db.getConnection();
  let txStarted = false;
  try {
    if (!req.user.hasRole("SEKRETARIAT")) {
      return res.status(403).json({
        ok: false,
        message: "Only sekretariat can generate surat undangan",
      });
    }

    const skripsiId = Number(req.params.skripsiId);
    if (!Number.isFinite(skripsiId) || skripsiId <= 0) {
      return res
        .status(400)
        .json({ ok: false, message: "Invalid skripsiId" });
    }

    await conn.beginTransaction();
    txStarted = true;

    const [[sidang]] = await conn.query(
      `SELECT * FROM pengajuan_sidang
       WHERE skripsi_id = ?
       ORDER BY
         CASE WHEN status = 'WAITING_FOR_SURAT' THEN 0 ELSE 1 END ASC,
         created_at DESC
       LIMIT 1 FOR UPDATE`,
      [skripsiId],
    );
    if (!sidang) {
      await conn.rollback();
      txStarted = false;
      return res
        .status(404)
        .json({ ok: false, message: "Pengajuan Sidang tidak ditemukan" });
    }
    if (sidang.status !== "WAITING_FOR_SURAT") {
      await conn.rollback();
      txStarted = false;
      return res.status(409).json({
        ok: false,
        message:
          "Pengajuan Sidang harus berstatus WAITING_FOR_SURAT untuk menghasilkan surat undangan",
      });
    }

    // Gather all data needed for the surat undangan template
    // Join pengajuan_sidang_kaprodi via pengajuan_sidang_id to handle ujian ulang (multiple rows per student)
    const [[dataRow]] = await conn.query(
      `SELECT
         s.npm,
         m.nama AS nama_mahasiswa,
         m.email AS mahasiswa_email,
         ps.id AS program_studi_id,
         ps.nama AS prodi_nama,
         ps.kode AS ps_kode,
         ps.kaprodi_nidn,
         f.nama AS fakultas_nama,
         f.kode AS f_kode,
         s.judul AS judul_skripsi,
         d1.nama AS pembimbing1_nama, s.pembimbing1_nidn,
         d2.nama AS pembimbing2_nama, s.pembimbing2_nidn,
         psk.nomor_surat, psk.verified_at AS sk_verified_at,
         psk_k.penguji1_nidn, d_pg1.nama AS penguji1_nama,
         psk_k.penguji2_nidn, d_pg2.nama AS penguji2_nama,
         psk_k.tanggal_sidang, psk_k.waktu_sidang, psk_k.tempat_sidang,
         psk_k.tanggal_disposisi
       FROM skripsi s
       JOIN mahasiswa m ON m.npm = s.npm
       JOIN program_studi ps ON ps.id = s.program_studi_id
       JOIN fakultas f ON f.id = ps.fakultas_id
       LEFT JOIN dosen d1 ON d1.nidn = s.pembimbing1_nidn
       LEFT JOIN dosen d2 ON d2.nidn = s.pembimbing2_nidn
       LEFT JOIN pengajuan_sk_penelitian psk ON psk.outline_id = s.outline_id
       LEFT JOIN pengajuan_sidang_kaprodi psk_k ON psk_k.pengajuan_sidang_id = ?
       LEFT JOIN dosen d_pg1 ON d_pg1.nidn = psk_k.penguji1_nidn
       LEFT JOIN dosen d_pg2 ON d_pg2.nidn = psk_k.penguji2_nidn
       WHERE s.id = ?
       LIMIT 1`,
      [sidang.id, skripsiId],
    );
    // ujian_ke lives on pengajuan_sidang (already fetched as `sidang`)
    if (dataRow) dataRow.ujian_ke = sidang.ujian_ke ?? 1;

    const npm = dataRow?.npm ?? "";

    // Kaprodi signature + name
    const kaprodiNidn = dataRow?.kaprodi_nidn ?? null;
    const [[kaprodiUserRow]] = kaprodiNidn
      ? await conn.query(
          `SELECT u.signature_image FROM users u WHERE u.nidn = ? AND u.is_active = 1 ORDER BY u.id DESC LIMIT 1`,
          [kaprodiNidn],
        )
      : [[null]];
    const [[kaprodiDosenRow]] = kaprodiNidn
      ? await conn.query(`SELECT nama FROM dosen WHERE nidn = ? LIMIT 1`, [
          kaprodiNidn,
        ])
      : [[null]];

    // Dosen emails for pembimbing and penguji
    async function getDosenEmail(nidn) {
      if (!nidn) return null;
      const [[row]] = await conn.query(
        `SELECT email FROM dosen WHERE nidn = ? LIMIT 1`,
        [nidn],
      );
      return row?.email ?? null;
    }

    const [pembimbing1Email, pembimbing2Email, penguji1Email, penguji2Email] =
      await Promise.all([
        getDosenEmail(dataRow?.pembimbing1_nidn),
        getDosenEmail(dataRow?.pembimbing2_nidn),
        getDosenEmail(dataRow?.penguji1_nidn),
        getDosenEmail(dataRow?.penguji2_nidn),
      ]);

    // Generate nomor_surat for surat undangan (monthly sequence per prodi, resets each month)
    const now = new Date();
    const year = now.getFullYear();
    const month = now.getMonth() + 1;
    const [[{ seq }]] = await conn.query(
      `SELECT COUNT(*) AS seq
       FROM sidang sd
       JOIN skripsi sk ON sk.id = sd.skripsi_id
       WHERE sk.program_studi_id = ?
         AND sd.nomor_surat IS NOT NULL
         AND YEAR(sd.created_at) = ?
         AND MONTH(sd.created_at) = ?`,
      [dataRow?.program_studi_id, year, month],
    );
    const nomorSuratSidang = `${String(Number(seq) + 1).padStart(3, "0")}/${dataRow?.f_kode ?? ""}/${dataRow?.ps_kode ?? ""}/Sidang-Skripsi/${BULAN_ROMAWI[month - 1]}/${year}`;

    // Format dates
    const today = formatTanggalIndonesia(new Date());
    const tanggalSk = dataRow?.sk_verified_at
      ? formatTanggalIndonesia(new Date(dataRow.sk_verified_at))
      : "";
    const sidangDate = dataRow?.tanggal_sidang
      ? formatTanggalIndonesia(new Date(dataRow.tanggal_sidang))
      : "";
    const sidangTime = dataRow?.waktu_sidang
      ? String(dataRow.waktu_sidang).substring(0, 5)
      : "";

    const suratBuffer = await buildSuratUndanganBuffer({
      nomorSurat: nomorSuratSidang,
      lampiran: "-",
      namaPembimbing1: dataRow?.pembimbing1_nama ?? "",
      namaPembimbing2: dataRow?.pembimbing2_nama ?? "",
      namaPenguji1: dataRow?.penguji1_nama ?? "",
      namaPenguji2: dataRow?.penguji2_nama ?? "",
      tanggal: today,
      fakultas: dataRow?.fakultas_nama ?? "",
      nomorSk: dataRow?.nomor_surat ?? "",
      tanggalSk,
      namaMahasiswa: dataRow?.nama_mahasiswa ?? "",
      npm,
      prodi: dataRow?.prodi_nama ?? "",
      judulSkripsi: dataRow?.judul_skripsi ?? "",
      sidangDate,
      sidangTime,
      tempatSidang: dataRow?.tempat_sidang ?? "",
      ttdKaprodi: kaprodiUserRow?.signature_image ?? null,
      namaKaprodi: kaprodiDosenRow?.nama ?? "",
    });

    const fileBase64 = suratBuffer.toString("base64");

    await conn.query(
      `DELETE FROM pengajuan_sidang_files WHERE pengajuan_sidang_id = ? AND file_type = 'SURAT_UNDANGAN_SIDANG'`,
      [sidang.id],
    );
    await conn.query(
      `INSERT INTO pengajuan_sidang_files
         (pengajuan_sidang_id, file_type, file_name, mime_type, file_content, source, status)
       VALUES (?, 'SURAT_UNDANGAN_SIDANG', ?, ?, ?, 'SYSTEM', 'VERIFIED')`,
      [sidang.id, `Surat_Undangan_Sidang_${npm}.docx`, MIME_DOCX, fileBase64],
    );

    await conn.query(
      `UPDATE pengajuan_sidang
       SET status = 'COMPLETED', verified_at = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP
       WHERE id = ?`,
      [sidang.id],
    );

    await conn.query(
      `UPDATE pengajuan_sidang_kaprodi
       SET status = 'COMPLETED', updated_at = CURRENT_TIMESTAMP
       WHERE pengajuan_sidang_id = ?`,
      [sidang.id],
    );

    // Auto-create sidang record for this specific pengajuan_sidang (existence guard per pengajuan_sidang_id)
    const [[existingSidang]] = await conn.query(
      `SELECT id FROM sidang WHERE pengajuan_sidang_id = ? LIMIT 1`,
      [sidang.id],
    );
    if (!existingSidang) {
      const [sidangIns] = await conn.query(
        `INSERT INTO sidang
           (skripsi_id, nomor_surat, pengajuan_sidang_id)
         VALUES (?, ?, ?)`,
        [skripsiId, nomorSuratSidang, sidang.id],
      );
      const newSidangId = sidangIns.insertId;

      // Resolve user_id for each participant (nullable — no account → NULL)
      const resolveUserId = async (nidn) => {
        if (!nidn) return null;
        const [[u]] = await conn.query(
          `SELECT id FROM users WHERE nidn = ? AND is_active = 1 LIMIT 1`,
          [nidn],
        );
        return u?.id ?? null;
      };
      const [p1UserId, p2UserId, pg1UserId, pg2UserId] = await Promise.all([
        resolveUserId(dataRow?.pembimbing1_nidn),
        resolveUserId(dataRow?.pembimbing2_nidn),
        resolveUserId(dataRow?.penguji1_nidn),
        resolveUserId(dataRow?.penguji2_nidn),
      ]);

      await conn.query(
        `INSERT INTO sidang_penilaian (sidang_id, role, user_id) VALUES
           (?, 'PEMBIMBING_1', ?),
           (?, 'PEMBIMBING_2', ?),
           (?, 'PENGUJI_1', ?),
           (?, 'PENGUJI_2', ?)`,
        [
          newSidangId, p1UserId,
          newSidangId, p2UserId,
          newSidangId, pg1UserId,
          newSidangId, pg2UserId,
        ],
      );

      await conn.query(
        `INSERT INTO sidang_notulen (sidang_id, role, user_id) VALUES
           (?, 'PENGUJI_1', ?),
           (?, 'PENGUJI_2', ?)`,
        [
          newSidangId, pg1UserId,
          newSidangId, pg2UserId,
        ],
      );

      await conn.query(
        `INSERT INTO sidang_hasil_penilaian (sidang_id) VALUES (?)`,
        [newSidangId],
      );
    }

    const [[studentRow]] = await conn.query(
      `SELECT u.id FROM users u
       JOIN skripsi s ON s.npm = u.npm
       WHERE s.id = ? AND u.is_active = 1 LIMIT 1`,
      [skripsiId],
    );
    if (studentRow) {
      await insertNotification(
        conn,
        studentRow.id,
        "SIDANG_COMPLETED",
        "Surat undangan sidang telah dikirim. Pengajuan sidang selesai.",
        "/student/pengajuan-sidang",
      );
    }

    await conn.commit();
    txStarted = false;

    // Best-effort email dispatch after commit — errors are logged but do not fail the response
    const recipients = [
      pembimbing1Email,
      pembimbing2Email,
      penguji1Email,
      penguji2Email,
      dataRow?.mahasiswa_email ?? null,
    ].filter(Boolean);

    if (recipients.length > 0) {
      sendSuratUndangan({
        recipients,
        suratBuffer,
        npm,
        namaMahasiswa: dataRow?.nama_mahasiswa ?? "",
        sidangDate,
        sidangTime,
        tempat: dataRow?.tempat_sidang ?? "",
        judulSkripsi: dataRow?.judul_skripsi ?? "",
      }).catch((err) => {
        console.error(
          "[generateSuratUndangan] email dispatch failed:",
          err?.message ?? err,
        );
      });
    }

    return res.json({ ok: true, data: { status: "COMPLETED" } });
  } catch (err) {
    try {
      if (txStarted) await conn.rollback();
    } catch (_) {}
    next(err);
  } finally {
    conn.release();
  }
};
