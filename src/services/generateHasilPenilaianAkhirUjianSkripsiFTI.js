const path = require("node:path");
const { escapeHtml } = require("./shared/html.js");
const { imageToDataUrl, renderSignature } = require("./shared/images.js");
const fs = require("node:fs/promises");
const puppeteer = require("puppeteer");
const templatePath = path.join(__dirname, "../templates/hasil-penilaian-akhir-ujian-skripsi-fti/template.html");
const cssPath = path.join(__dirname, "../templates/hasil-penilaian-akhir-ujian-skripsi-fti/template.css");
const projectRootUrl = path.join(__dirname, "../");
const mimeTypes = {
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".png": "image/png",
};

function formatNumber(value) {
  if (!Number.isFinite(value))
    throw new TypeError("Each assessor score must be a finite number.");
  return value.toFixed(2).replace(".", ",");
}

function gradeFromAverage(average) {
  if (average >= 80) return "A";
  if (average >= 70) return "B";
  if (average >= 60) return "C";
  return "D";
}

async function renderTemplate(template, data) {
  const { pembimbingPertama, pembimbingKedua, pengujiUtama, anggotaPenguji } =
    data.timPenguji;
  const assessors = [
    pembimbingPertama,
    pembimbingKedua,
    pengujiUtama,
    anggotaPenguji,
  ];
  const scores = assessors.map(({ nilai }) => Number(nilai));
  const grandTotal = scores.reduce((sum, score) => sum + score, 0);
  const average = grandTotal / scores.length;
  const [logoUWDP, signaturePimpinanSidang] = await Promise.all([
    imageToDataUrl("assets/logo-UWDP.png"),
    renderSignature(pembimbingPertama.signaturePath),
  ]);
  const values = {
    "{{logoUWDP}}": logoUWDP,
    "{{namaMahasiswa}}": data.mahasiswa.nama,
    "{{npm}}": data.mahasiswa.npm,
    "{{programStudi}}": data.mahasiswa.programStudi,
    "{{judulSkripsi}}": data.mahasiswa.judulSkripsi,
    "{{ujianKe}}": data.ujianKe,
    "{{tanggal}}": data.tanggal,
    "{{namaPembimbingPertama}}": pembimbingPertama.nama,
    "{{nilaiPembimbingPertama}}": formatNumber(scores[0]),
    "{{namaPembimbingKedua}}": pembimbingKedua.nama,
    "{{nilaiPembimbingKedua}}": formatNumber(scores[1]),
    "{{namaPengujiUtama}}": pengujiUtama.nama,
    "{{nilaiPengujiUtama}}": formatNumber(scores[2]),
    "{{namaAnggotaPenguji}}": anggotaPenguji.nama,
    "{{nilaiAnggotaPenguji}}": formatNumber(scores[3]),
    "{{grandTotalNilai}}": formatNumber(grandTotal),
    "{{rataRata}}": formatNumber(average),
    "{{grade}}": gradeFromAverage(average),
  };
  const html = Object.entries(values).reduce(
    (result, [placeholder, value]) =>
      result.replaceAll(placeholder, escapeHtml(value)),
    template,
  );
  return html.replace("{{signaturePimpinanSidang}}", signaturePimpinanSidang);
}

async function generateHasilPenilaianAkhirUjianSkripsiFTI(data) {
  const [template, css] = await Promise.all([
    fs.readFile(templatePath, "utf8"),
    fs.readFile(cssPath, "utf8"),
  ]);
  const browser = await puppeteer.launch();
  try {
    const page = await browser.newPage();
    await page.setContent(await renderTemplate(template, data), {
      waitUntil: "load",
    });
    await page.addStyleTag({ content: css });
    return await page.pdf({
      preferCSSPageSize: true,
      printBackground: true,
      margin: { top: "0", right: "0", bottom: "0", left: "0" },
    });
  } finally {
    await browser.close();
  }
}

module.exports = {
  generateHasilPenilaianAkhirUjianSkripsiFTI,
};
