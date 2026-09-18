const path = require("node:path");
const { escapeHtml } = require("./shared/html.js");
const { imageToDataUrl, renderSignature } = require("./shared/images.js");
const fs = require("node:fs/promises");
const puppeteer = require("puppeteer");
const templatePath = path.join(
  __dirname,
  "../templates/kartu-konsultasi-outline-fti/template.html",
);
const cssPath = path.join(
  __dirname,
  "../templates/kartu-konsultasi-outline-fti/template.css",
);
const projectRootUrl = path.join(__dirname, "../");

const mimeTypes = {
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".png": "image/png",
};

async function renderConsultationRows(rows) {
  const rowsToRender =
    rows.length === 0 ? [{ tanggal: "", keterangan: "" }] : rows;
  const renderedRows = await Promise.all(
    rowsToRender.map(
      async ({ tanggal, keterangan, signatureBase64 }) => {
        const signature = await renderSignature(
          signatureBase64,
          "Paraf reviewer konsultasi",
          "consultation-signature",
        );
        return `
        <tr>
          <td>${escapeHtml(tanggal)}</td>
          <td>${escapeHtml(keterangan)}</td>
          <td>${signature}</td>
        </tr>`;
      },
    ),
  );

  return renderedRows.join("");
}

async function renderTemplate(template, data) {
  const { mahasiswa, pembimbing, catatanKonsultasi } = data;
  const [crestImage, firstSignature, secondSignature, consultationRows] =
    await Promise.all([
      imageToDataUrl("assets/logo-UWDP.png"),
      renderSignature(
        pembimbing.pertama.signatureBase64,
        "Tanda tangan pembimbing pertama",
      ),
      renderSignature(
        pembimbing.kedua.signatureBase64,
        "Tanda tangan pembimbing kedua",
      ),
      renderConsultationRows(catatanKonsultasi),
    ]);
  const replacements = {
    "{{crestImage}}": crestImage,
    "{{namaMahasiswa}}": mahasiswa.nama,
    "{{nomorPokokMahasiswa}}": mahasiswa.nomorPokok,
    "{{programStudi}}": mahasiswa.programStudi,
    "{{judulSkripsi}}": mahasiswa.judulSkripsi,
    "{{namaPembimbingPertama}}": pembimbing.pertama.nama,
    "{{namaPembimbingKedua}}": pembimbing.kedua.nama,
  };

  const html = Object.entries(replacements).reduce(
    (html, [placeholder, value]) =>
      html.replaceAll(placeholder, escapeHtml(value)),
    template,
  );

  return html
    .replace("{{signaturePembimbingPertama}}", firstSignature)
    .replace("{{signaturePembimbingKedua}}", secondSignature)
    .replace("{{catatanKonsultasiRows}}", consultationRows);
}

async function generateKartuKonsultasiOutlineFTI(data) {
  const [template, css] = await Promise.all([
    fs.readFile(templatePath, "utf8"),
    fs.readFile(cssPath, "utf8"),
  ]);
  const html = await renderTemplate(template, data);

  const browser = await puppeteer.launch();

  try {
    const page = await browser.newPage();

    await page.setContent(html, {
      waitUntil: "load",
    });

    await page.addStyleTag({ content: css });

    return await page.pdf({
      preferCSSPageSize: true,
      printBackground: true,
      margin: {
        top: "0",
        right: "0",
        bottom: "0",
        left: "0",
      },
    });
  } finally {
    await browser.close();
  }
}

module.exports = {
  generateKartuKonsultasiOutlineFTI,
};
