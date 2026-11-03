const path = require("node:path");
const { escapeHtml } = require("./shared/html.js");
const { renderPdf } = require("./shared/pdf.js");
const { imageToDataUrl, renderNormalizedSignature } = require("./shared/images.js");
const templatePath = path.join(__dirname, "../templates/surat-keputusan-seminar-bisnis-digital-fti/template.html");
const cssPath = path.join(__dirname, "../templates/surat-keputusan-seminar-bisnis-digital-fti/template.css");

async function renderTemplate(template, data) {
  const [logoUWDP, signatureDekan] = await Promise.all([
    imageToDataUrl("assets/logo-UWDP.png"),
    renderNormalizedSignature(data.dekan.signatureBase64),
  ]);
  const values = {
    "{{nomorSurat}}": data.nomorSurat,
    "{{programStudi}}": data.programStudi,
    "{{namaMahasiswa}}": data.mahasiswa.nama,
    "{{npm}}": data.mahasiswa.npm,
    "{{namaPembimbingPertama}}": data.pembimbing.pertama,
    "{{namaPembimbingKedua}}": data.pembimbing.kedua,
    "{{judul}}": data.judul,
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

async function generateSuratKeputusanSeminarBisnisDigitalFTI(data) {
  return renderPdf({
    templatePath,
    cssPath,
    renderHtml: (template) => renderTemplate(template, data),
  });
}

module.exports = {
  generateSuratKeputusanSeminarBisnisDigitalFTI,
};
