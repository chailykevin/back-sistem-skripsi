const path = require("node:path");
const { escapeHtml } = require("./shared/html.js");
const { imageToDataUrl, renderSignature } = require("./shared/images.js");
const { renderPdf } = require("./shared/pdf.js");
const templatePath = path.join(__dirname, "../templates/surat-undangan-sidang-fti/template.html");
const cssPath = path.join(__dirname, "../templates/surat-undangan-sidang-fti/template.css");
async function renderTemplate(template, data) {
  const [logoUWDP, signature] = await Promise.all([
    imageToDataUrl("assets/logo-UWDP.png"),
    renderSignature(
      data.ketuaProgramStudi.signaturePath,
      "Tanda tangan ketua program studi",
    ),
  ]);
  const { mahasiswa, pengajar } = data;
  const values = {
    "{{logoUWDP}}": logoUWDP,
    "{{nomorSurat}}": data.nomorSurat,
    "{{tanggalSurat}}": data.tanggalSurat,
    "{{lampiran}}": data.lampiran || "-",
    "{{nomorSk}}": data.nomorSk,
    "{{tanggalSk}}": data.tanggalSk,
    "{{namaMahasiswa}}": mahasiswa.nama,
    "{{npm}}": mahasiswa.npm,
    "{{programStudi}}": mahasiswa.programStudi,
    "{{judulSkripsi}}": mahasiswa.judulSkripsi,
    "{{namaPembimbingPertama}}": pengajar.pembimbingPertama,
    "{{namaPembimbingKedua}}": pengajar.pembimbingKedua,
    "{{namaPengujiPertama}}": pengajar.pengujiPertama,
    "{{namaPengujiKedua}}": pengajar.pengujiKedua,
    "{{tanggalSidang}}": data.tanggalSidang,
    "{{waktuSidang}}": data.waktuSidang,
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
async function generateSuratUndanganSidangFTI(data) {
  return renderPdf({
    templatePath,
    cssPath,
    renderHtml: (template) => renderTemplate(template, data),
  });
}

module.exports = {
  generateSuratUndanganSidangFTI,
};
