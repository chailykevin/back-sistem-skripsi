const path = require("node:path");
const { escapeHtml } = require("./shared/html.js");
const { imageToDataUrl, renderNormalizedSignature } = require("./shared/images.js");
const { renderPdf } = require("./shared/pdf.js");
const templatePath = path.join(__dirname, "../templates/surat-undangan-sidang-fti/template.html");
const cssPath = path.join(__dirname, "../templates/surat-undangan-sidang-fti/template.css");

function formatWaktuSidang(waktuSidang) {
  const match = String(waktuSidang ?? "").match(/^(\d{1,2}):(\d{2})/);
  if (!match) return "";

  const startMinutes = Number(match[1]) * 60 + Number(match[2]);
  const endMinutes = (startMinutes + 2 * 60) % (24 * 60);
  const formatTime = (minutes) => {
    const hours = String(Math.floor(minutes / 60)).padStart(2, "0");
    const mins = String(minutes % 60).padStart(2, "0");
    return `${hours}.${mins}`;
  };

  return `${formatTime(startMinutes)} - ${formatTime(endMinutes)} WIB`;
}

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
    "{{rentangWaktuSidang}}": formatWaktuSidang(data.waktuSidang),
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
