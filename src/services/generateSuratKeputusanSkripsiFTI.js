const path = require("node:path");
const { escapeHtml } = require("./shared/html.js");
const { imageToDataUrl, renderSignature } = require("./shared/images.js");
const fs = require("node:fs/promises");
const puppeteer = require("puppeteer");
const templatePath = path.join(__dirname, "../templates/surat-keputusan-skripsi-fti/template.html");
const cssPath = path.join(__dirname, "../templates/surat-keputusan-skripsi-fti/template.css");
const projectRootUrl = path.join(__dirname, "../");
const mimeTypes = {
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".png": "image/png",
};

async function renderTemplate(template, data) {
  const [logoUWDP, signatureDekan] = await Promise.all([
    imageToDataUrl("assets/logo-UWDP.png"),
    renderSignature(data.dekan.signaturePath),
  ]);
  const values = {
    "{{nomorSurat}}": data.nomorSurat,
    "{{programStudi}}": data.programStudi,
    "{{namaMahasiswa}}": data.mahasiswa.nama,
    "{{npm}}": data.mahasiswa.npm,
    "{{namaPembimbingPertama}}": data.pembimbing.pertama,
    "{{namaPembimbingKedua}}": data.pembimbing.kedua,
    "{{judulSkripsi}}": data.judulSkripsi,
    "{{tanggal}}": data.tanggal,
    "{{namaDekan}}": data.dekan.nama,
  };
  const html = Object.entries(values).reduce(
    (result, [placeholder, value]) =>
      result.replaceAll(placeholder, escapeHtml(value)),
    template,
  );
  return html
    .replace("{{logoUWDP}}", escapeHtml(logoUWDP))
    .replace("{{signatureDekan}}", signatureDekan);
}

async function generateSuratKeputusanSkripsiFTI(data) {
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
  generateSuratKeputusanSkripsiFTI,
};
