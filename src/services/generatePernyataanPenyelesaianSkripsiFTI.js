const path = require("node:path");
const { escapeHtml } = require("./shared/html.js");
const { imageToDataUrl, renderSignature } = require("./shared/images.js");
const fs = require("node:fs/promises");
const puppeteer = require("puppeteer");
const templatePath = path.join(__dirname, "../templates/pernyataan-penyelesaian-skripsi-fti/template.html");
const cssPath = path.join(__dirname, "../templates/pernyataan-penyelesaian-skripsi-fti/template.css");
const projectRootUrl = path.join(__dirname, "../");
const mimeTypes = {
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".png": "image/png",
};

async function renderTemplate(template, data) {
  const [signatureKetuaProgramStudi, signatureMahasiswa] = await Promise.all([
    renderSignature(
      data.ketuaProgramStudi.signatureBase64,
      "Tanda tangan ketua program studi",
    ),
    renderSignature(data.mahasiswa.signatureBase64, "Tanda tangan mahasiswa"),
  ]);
  const values = {
    "{{namaMahasiswa}}": data.mahasiswa.nama,
    "{{npm}}": data.mahasiswa.npm,
    "{{alamat}}": data.mahasiswa.alamat,
    "{{noHp}}": data.mahasiswa.noHp,
    "{{judulSkripsi}}": data.mahasiswa.judulSkripsi,
    "{{namaKetuaProgramStudi}}": data.ketuaProgramStudi.nama,
    "{{programStudi}}": data.ketuaProgramStudi.programStudi,
  };
  return Object.entries(values)
    .reduce(
      (html, [placeholder, value]) =>
        html.replaceAll(placeholder, escapeHtml(value)),
      template,
    )
    .replace("{{signatureKetuaProgramStudi}}", signatureKetuaProgramStudi)
    .replace("{{signatureMahasiswa}}", signatureMahasiswa);
}

async function generatePernyataanPenyelesaianSkripsiFTI(data) {
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
  generatePernyataanPenyelesaianSkripsiFTI,
};
