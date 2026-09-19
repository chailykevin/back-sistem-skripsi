const path = require("node:path");
const { escapeHtml } = require("./shared/html.js");
const { renderPdf } = require("./shared/pdf.js");
const templatePath = path.join(__dirname, "../templates/surat-keterangan-fti/template.html");
const cssPath = path.join(__dirname, "../templates/surat-keterangan-fti/template.css");

function renderTemplate(template, data) {
  const values = {
    "{{namaMahasiswa}}": data.mahasiswa.nama,
    "{{npm}}": data.mahasiswa.npm,
    "{{programStudi}}": data.mahasiswa.programStudi,
    "{{lokasi}}": data.lokasi,
    "{{judul}}": data.judul,
    "{{tanggal}}": data.tanggal,
  };
  return Object.entries(values).reduce(
    (html, [placeholder, value]) =>
      html.replaceAll(placeholder, escapeHtml(value)),
    template,
  );
}

async function generateSuratKeteranganFTI(data) {
  return renderPdf({
    templatePath,
    cssPath,
    renderHtml: (template) => renderTemplate(template, data),
  });
}

module.exports = {
  generateSuratKeteranganFTI,
};
