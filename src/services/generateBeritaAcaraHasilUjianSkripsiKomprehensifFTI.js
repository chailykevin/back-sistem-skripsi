const path = require("node:path");
const { escapeHtml } = require("./shared/html.js");
const { imageToDataUrl, renderSignature } = require("./shared/images.js");
const fs = require("node:fs/promises");
const puppeteer = require("puppeteer");
const templatePath = path.join(__dirname, "../templates/berita-acara-hasil-ujian-skripsi-komprehensif-fti/template.html");
const cssPath = path.join(__dirname, "../templates/berita-acara-hasil-ujian-skripsi-komprehensif-fti/template.css");
const projectRootUrl = path.join(__dirname, "../");
const mimeTypes = {
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".png": "image/png",
};

function formatScore(value) {
  const score = Number(value);
  if (!Number.isFinite(score))
    throw new TypeError("nilaiUjian must be a finite number.");
  return score.toFixed(2);
}

function gradeFromScore(value) {
  if (value >= 80) return "A";
  if (value >= 70) return "B";
  if (value >= 60) return "C";
  return "D";
}

function renderResultOptions(result) {
  if (!["Lulus", "Tidak Lulus"].includes(result))
    throw new TypeError('hasilUjian must be "Lulus" or "Tidak Lulus".');
  return result.toUpperCase();
}

function renderNotes(notes) {
  return notes === null || notes === undefined || notes === ""
    ? ""
    : escapeHtml(notes).replaceAll("\n", "<br />");
}

async function renderTemplate(template, data) {
  const score = Number(data.nilaiUjian);
  const { ketua, sekretaris, pengujiUtama, anggotaPenguji } =
    data.majelisPenguji;
  const [
    logoUWDP,
    signatureKetua,
    signatureSekretaris,
    signaturePengujiUtama,
    signatureAnggotaPenguji,
  ] = await Promise.all([
    imageToDataUrl("assets/logo-UWDP.png"),
    renderSignature(ketua.signatureBase64, "Tanda tangan ketua majelis penguji"),
    renderSignature(
      sekretaris.signatureBase64,
      "Tanda tangan sekretaris majelis penguji",
    ),
    renderSignature(pengujiUtama.signatureBase64, "Tanda tangan penguji utama"),
    renderSignature(
      anggotaPenguji.signatureBase64,
      "Tanda tangan anggota penguji",
    ),
  ]);
  const values = {
    "{{logoUWDP}}": logoUWDP,
    "{{hari}}": data.hari,
    "{{tanggalUjian}}": data.tanggalUjian,
    "{{waktu}}": data.waktu,
    "{{namaMahasiswa}}": data.mahasiswa.nama,
    "{{npm}}": data.mahasiswa.npm,
    "{{programStudi}}": data.mahasiswa.programStudi,
    "{{judulSkripsi}}": data.mahasiswa.judulSkripsi,
    "{{ujianKe}}": data.ujianKe,
    "{{nilaiUjian}}": formatScore(score),
    "{{grade}}": gradeFromScore(score),
    "{{tanggalDokumen}}": data.tanggalDokumen,
    "{{namaKetua}}": ketua.nama,
    "{{namaSekretaris}}": sekretaris.nama,
    "{{namaPengujiUtama}}": pengujiUtama.nama,
    "{{namaAnggotaPenguji}}": anggotaPenguji.nama,
  };
  const html = Object.entries(values).reduce(
    (result, [placeholder, value]) =>
      result.replaceAll(placeholder, escapeHtml(value)),
    template,
  );
  return html
    .replace("{{hasilUjianOptions}}", renderResultOptions(data.hasilUjian))
    .replace(
      "{{catatanMajelisPenguji}}",
      renderNotes(data.catatanMajelisPenguji),
    )
    .replace("{{signatureKetua}}", signatureKetua)
    .replace("{{signatureSekretaris}}", signatureSekretaris)
    .replace("{{signaturePengujiUtama}}", signaturePengujiUtama)
    .replace("{{signatureAnggotaPenguji}}", signatureAnggotaPenguji);
}

async function generateBeritaAcaraHasilUjianSkripsiKomprehensifFTI(
  data,
) {
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
  generateBeritaAcaraHasilUjianSkripsiKomprehensifFTI,
};
