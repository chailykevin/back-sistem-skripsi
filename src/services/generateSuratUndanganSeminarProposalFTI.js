const path = require("node:path");
const { escapeHtml } = require("./shared/html.js");
const { imageToDataUrl, renderNormalizedSignature } = require("./shared/images.js");
const { renderPdf } = require("./shared/pdf.js");
const { formatWaktuSidang } = require("./generateSuratUndanganSidangFTI.js");
const templatePath = path.join(__dirname, "../templates/surat-undangan-seminar-proposal-fti/template.html");
const cssPath = path.join(__dirname, "../templates/surat-undangan-seminar-proposal-fti/template.css");

const SEMINAR_DURATION_MINUTES = 90;

async function renderTemplate(template, data) {
  const [logoUWDP, signature] = await Promise.all([
    imageToDataUrl("assets/logo-UWDP.png"),
    renderNormalizedSignature(
      data.ketuaProgramStudi.signatureBase64,
      "Tanda tangan ketua program studi",
    ),
  ]);
  const { mahasiswa, pengajar } = data;
  const values = {
    "{{logoUWDP}}": logoUWDP,
    "{{nomorSurat}}": data.nomorSurat,
    "{{tanggalSurat}}": data.tanggalSurat,
    "{{nomorSk}}": data.nomorSk,
    "{{tanggalSk}}": data.tanggalSk,
    "{{namaMahasiswa}}": mahasiswa.nama,
    "{{npm}}": mahasiswa.npm,
    "{{programStudi}}": mahasiswa.programStudi,
    "{{judulSkripsi}}": mahasiswa.judulSkripsi,
    "{{namaPembimbingPertama}}": pengajar.pembimbingPertama,
    "{{namaPembimbingKedua}}": pengajar.pembimbingKedua,
    "{{namaPenguji}}": pengajar.penguji,
    "{{tanggalSidang}}": data.tanggalSidang,
    "{{rentangWaktuSidang}}": formatWaktuSidang(
      data.waktuSidang,
      SEMINAR_DURATION_MINUTES,
    ),
    "{{tempatSidang}}": data.tempatSidang,
    "{{namaKetuaProgramStudi}}": data.ketuaProgramStudi.nama,
  };
  return Object.entries(values)
    .reduce(
      (result, [placeholder, value]) =>
        result.replaceAll(placeholder, escapeHtml(value)),
      template,
    )
    .replace("{{signatureKetuaProgramStudi}}", signature);
}

async function generateSuratUndanganSeminarProposalFTI(data) {
  return renderPdf({
    templatePath,
    cssPath,
    renderHtml: (template) => renderTemplate(template, data),
  });
}

module.exports = {
  generateSuratUndanganSeminarProposalFTI,
};
