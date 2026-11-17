const path = require("node:path");
const { escapeHtml } = require("./shared/html.js");
const { renderNormalizedSignature } = require("./shared/images.js");
const { renderPdf } = require("./shared/pdf.js");
const templatePath = path.join(__dirname, "../templates/form-pengajuan-topik-seminar-fti/template.html");
const cssPath = path.join(__dirname, "../templates/form-pengajuan-topik-seminar-fti/template.css");

const SYARAT = [
  ["ktm", "Melampirkan fotocopy KTM."],
  ["dataPerkembanganAkademik", "Melampirkan Data Perkembangan Akademik."],
  ["sksMin", "Sudah menempuh minimal 119 SKS."],
  ["simulasiBisnis", "Lulus mata kuliah Simulasi Bisnis dengan nilai minimal C."],
  ["nilaiD", "Tidak memiliki lebih dari 1 mata kuliah yang bernilai D."],
];

function checkbox(checked) {
  return `<span class="checkbox">${checked ? "&#10003;" : ""}</span>`;
}

function renderSyarat(syarat) {
  return SYARAT.map(
    ([key, label]) => `<li class="requirement-item">${checkbox(syarat[key])}${escapeHtml(label)}</li>`,
  ).join("");
}

function renderPerluSuratPengantar(ya) {
  return `<span class="checkbox-group"><span class="checkbox-option">${checkbox(ya)}Ya</span><span class="checkbox-option">${checkbox(!ya)}Tidak</span></span>`;
}

async function renderTemplate(template, data) {
  const { mahasiswa, pengajuan, disposisi } = data;
  const [signaturePemohon, signatureKetuaProgramStudi] = await Promise.all([
    renderNormalizedSignature(pengajuan.signatureBase64, "Tanda tangan pemohon"),
    renderNormalizedSignature(disposisi.signatureBase64, "Tanda tangan ketua program studi"),
  ]);
  const text = {
    npm: mahasiswa.npm,
    nama: mahasiswa.nama,
    programStudi: mahasiswa.programStudi,
    programStudiUpper: String(mahasiswa.programStudi ?? "").toUpperCase(),
    nomorHp: mahasiswa.nomorHp,
    judulDiajukan: mahasiswa.judulDiajukan,
    namaPerusahaan: pengajuan.namaPerusahaan,
    alamatPerusahaan: pengajuan.alamatPerusahaan,
    tanggalPengajuan: pengajuan.tanggal,
    namaPemohon: mahasiswa.nama,
    tanggalDisposisi: disposisi.tanggal,
    keputusan: disposisi.keputusan,
    dosenPembimbingUtama: disposisi.dosenPembimbingUtama,
    dosenPembimbingKedua: disposisi.dosenPembimbingKedua,
    catatan: disposisi.catatan,
    namaKetuaProgramStudi: disposisi.namaKetuaProgramStudi,
  };
  const html = {
    perluSuratPengantar: renderPerluSuratPengantar(!!pengajuan.perluSuratPengantar),
    syaratAdministratif: renderSyarat(pengajuan.syarat),
    signaturePemohon,
    signatureKetuaProgramStudi,
  };
  // One pass, so a value containing "{{...}}" is never substituted again.
  return template.replace(/\{\{(\w+)\}\}/g, (token, key) => {
    if (key in html) return html[key];
    if (key in text) return escapeHtml(text[key]);
    throw new Error(`Unknown placeholder ${token} in form pengajuan topik seminar template`);
  });
}

// Same fitting as the Skripsi formulir: the largest signature height (5–12 mm) that keeps one page.
async function fitSignatureHeight(page) {
  await page.evaluate(() => {
    const form = document.querySelector(".page");
    const root = document.documentElement;
    const pageHeight = (296 / 25.4) * 96;
    const minimumHeight = (5 / 25.4) * 96;
    const maximumHeight = (12 / 25.4) * 96;
    const fits = (height) => {
      root.style.setProperty("--signature-height", `${height}px`);
      return form.getBoundingClientRect().height <= pageHeight + 1;
    };
    if (!fits(minimumHeight)) return;
    let low = minimumHeight;
    let high = maximumHeight;
    for (let iteration = 0; iteration < 16; iteration += 1) {
      const middle = (low + high) / 2;
      if (fits(middle)) low = middle;
      else high = middle;
    }
    root.style.setProperty("--signature-height", `${low}px`);
  });
}

async function generateFormPengajuanTopikSeminarFTI(data) {
  return renderPdf({
    templatePath,
    cssPath,
    renderHtml: (template) => renderTemplate(template, data),
    beforePdf: fitSignatureHeight,
  });
}

module.exports = { generateFormPengajuanTopikSeminarFTI };
