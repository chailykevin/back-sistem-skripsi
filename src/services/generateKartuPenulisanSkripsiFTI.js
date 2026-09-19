const path = require("node:path");
const { escapeHtml } = require("./shared/html.js");
const { imageToDataUrl, renderSignature } = require("./shared/images.js");
const fs = require("node:fs/promises");
const puppeteer = require("puppeteer");
const templatePath = path.join(__dirname, "../templates/kartu-penulisan-skripsi-fti/template.html");
const cssPath = path.join(__dirname, "../templates/kartu-penulisan-skripsi-fti/template.css");
const projectRootUrl = path.join(__dirname, "../");
const mimeTypes = {
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".png": "image/png",
};

async function renderConsultationRows(rows) {
  const rowsToRender =
    rows.length === 0
      ? [{ tanggal: "", keterangan: "", parafBase64: null }]
      : rows;
  return (
    await Promise.all(
      rowsToRender.map(
        async ({ tanggal, keterangan, parafBase64 }) => `
    <tr><td>${escapeHtml(tanggal)}</td><td>${escapeHtml(keterangan)}</td><td>${await renderSignature(parafBase64, "Paraf")}</td></tr>`,
      ),
    )
  ).join("");
}

async function renderTemplate(template, data) {
  const [
    logoUWDP,
    signaturePembimbingPertama,
    signaturePembimbingKedua,
    signatureKetuaProgramStudi,
    consultationRows,
  ] = await Promise.all([
    imageToDataUrl("assets/logo-UWDP.png"),
    renderSignature(
      data.pembimbing.pertama.signatureBase64,
      "Tanda tangan pembimbing pertama",
    ),
    renderSignature(
      data.pembimbing.kedua.signatureBase64,
      "Tanda tangan pembimbing kedua",
    ),
    renderSignature(
      data.ketuaProgramStudi.signatureBase64,
      "Tanda tangan ketua program studi",
    ),
    renderConsultationRows(data.catatanKonsultasi),
  ]);
  const values = {
    "{{logoUWDP}}": logoUWDP,
    "{{nomorSk}}": data.nomorSk,
    "{{namaMahasiswa}}": data.mahasiswa.nama,
    "{{npm}}": data.mahasiswa.npm,
    "{{programStudi}}": data.mahasiswa.programStudi,
    "{{judulSkripsi}}": data.mahasiswa.judulSkripsi,
    "{{namaPembimbingPertama}}": data.pembimbing.pertama.nama,
    "{{namaPembimbingKedua}}": data.pembimbing.kedua.nama,
    "{{tanggalMulaiMenulis}}": data.tanggalMulaiMenulis,
    "{{tanggalSelesaiMenulis}}": data.tanggalSelesaiMenulis,
    "{{namaKetuaProgramStudi}}": data.ketuaProgramStudi.nama,
  };
  const html = Object.entries(values).reduce(
    (result, [placeholder, value]) =>
      result.replaceAll(placeholder, escapeHtml(value)),
    template,
  );
  return html
    .replace("{{signaturePembimbingPertama}}", signaturePembimbingPertama)
    .replace("{{signaturePembimbingKedua}}", signaturePembimbingKedua)
    .replace("{{signatureKetuaProgramStudi}}", signatureKetuaProgramStudi)
    .replace("{{catatanKonsultasiRows}}", consultationRows);
}

async function generateKartuPenulisanSkripsiFTI(data) {
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
  generateKartuPenulisanSkripsiFTI,
};
