const path = require("node:path");
const { escapeHtml } = require("./shared/html.js");
const { renderNormalizedSignature: signature } = require("./shared/images.js");
const { renderPdf } = require("./shared/pdf.js");
const templatePath = path.join(__dirname, "../templates/halaman-pengesahan-seminar-proposal-fti/template.html");
const cssPath = path.join(__dirname, "../templates/halaman-pengesahan-seminar-proposal-fti/template.css");

async function renderTemplate(template, data) {
  const { mahasiswa, majelisPenguji } = data;
  const [utama, kedua, penguji] = await Promise.all([
    signature(
      majelisPenguji.pembimbingUtama.signatureBase64,
      "Tanda tangan dosen pembimbing utama",
    ),
    signature(
      majelisPenguji.pembimbingKedua.signatureBase64,
      "Tanda tangan dosen pembimbing kedua",
    ),
    signature(
      majelisPenguji.pengujiUtama.signatureBase64,
      "Tanda tangan penguji utama",
    ),
  ]);
  const values = {
    "{{judulSkripsi}}": mahasiswa.judulSkripsi,
    "{{namaMahasiswa}}": mahasiswa.nama,
    "{{npm}}": mahasiswa.npm,
    "{{hari}}": data.hari,
    "{{tanggal}}": data.tanggal,
    "{{namaPembimbingUtama}}": majelisPenguji.pembimbingUtama.nama,
    "{{namaPembimbingKedua}}": majelisPenguji.pembimbingKedua.nama,
    "{{namaPengujiUtama}}": majelisPenguji.pengujiUtama.nama,
    "{{programStudi}}": data.programStudi,
    "{{tahunPenulisan}}": data.tahunPenulisan,
  };
  return Object.entries(values)
    .reduce(
      (html, [token, value]) => html.replaceAll(token, escapeHtml(value)),
      template,
    )
    .replace("{{signaturePembimbingUtama}}", utama)
    .replace("{{signaturePembimbingKedua}}", kedua)
    .replace("{{signaturePengujiUtama}}", penguji);
}

async function generateHalamanPengesahanSeminarProposalFTI(data) {
  return renderPdf({
    templatePath,
    cssPath,
    renderHtml: (template) => renderTemplate(template, data),
  });
}

module.exports = {
  generateHalamanPengesahanSeminarProposalFTI,
};
