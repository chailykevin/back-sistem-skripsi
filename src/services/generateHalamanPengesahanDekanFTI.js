const path = require("node:path");
const { escapeHtml } = require("./shared/html.js");
const { renderSignature: signature } = require("./shared/images.js");
const { renderPdf } = require("./shared/pdf.js");
const templatePath = path.join(__dirname, "../templates/halaman-pengesahan-dekan-fti/template.html");
const cssPath = path.join(__dirname, "../templates/halaman-pengesahan-dekan-fti/template.css");
async function renderTemplate(template, data) {
  const [student, first, second, dean] = await Promise.all([
    signature(data.mahasiswa.signatureBase64, "Tanda tangan mahasiswa"),
    signature(
      data.pembimbing.pertama.signatureBase64,
      "Tanda tangan pembimbing pertama",
    ),
    signature(
      data.pembimbing.kedua.signatureBase64,
      "Tanda tangan pembimbing kedua",
    ),
    signature(data.dekan.signatureBase64, "Tanda tangan dekan"),
  ]);
  const values = {
    "{{judulSkripsi}}": data.mahasiswa.judulSkripsi,
    "{{namaMahasiswa}}": data.mahasiswa.nama,
    "{{npm}}": data.mahasiswa.npm,
    "{{namaPembimbingPertama}}": data.pembimbing.pertama.nama,
    "{{namaPembimbingKedua}}": data.pembimbing.kedua.nama,
    "{{namaDekan}}": data.dekan.nama,
    "{{programStudi}}": data.programStudi,
    "{{tahunPenulisan}}": data.tahunPenulisan,
  };
  return Object.entries(values)
    .reduce(
      (html, [token, value]) => html.replaceAll(token, escapeHtml(value)),
      template,
    )
    .replace("{{signatureMahasiswa}}", student)
    .replace("{{signaturePembimbingPertama}}", first)
    .replace("{{signaturePembimbingKedua}}", second)
    .replace("{{signatureDekan}}", dean);
}
async function generateHalamanPengesahanDekanFTI(data) {
  return renderPdf({
    templatePath,
    cssPath,
    renderHtml: (template) => renderTemplate(template, data),
  });
}

module.exports = {
  generateHalamanPengesahanDekanFTI,
};
