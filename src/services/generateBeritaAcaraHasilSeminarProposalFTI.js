const path = require("node:path");
const { escapeHtml } = require("./shared/html.js");
const { imageToDataUrl, renderNormalizedSignature } = require("./shared/images.js");
const { renderPdf } = require("./shared/pdf.js");
const templatePath = path.join(__dirname, "../templates/berita-acara-hasil-seminar-proposal-fti/template.html");
const cssPath = path.join(__dirname, "../templates/berita-acara-hasil-seminar-proposal-fti/template.css");

function formatScore(value) {
  const score = Number(value);
  if (!Number.isFinite(score))
    throw new TypeError("nilaiUjian must be a finite number.");
  return score.toFixed(2);
}

function gradeFromScore(value) {
  if (value >= 80) return "A";
  if (value >= 70) return "B";
  if (value >= 60) return "C";
  return "D";
}

function renderResultOptions(result) {
  if (!["Diterima", "Tidak Diterima"].includes(result))
    throw new TypeError('hasilSeminar must be "Diterima" or "Tidak Diterima".');
  return result.toUpperCase();
}

function renderNotes(notes) {
  return notes === null || notes === undefined || notes === ""
    ? ""
    : escapeHtml(notes).replaceAll("\n", "<br />");
}

async function renderTemplate(template, data) {
  const score = Number(data.nilaiUjian);
  const { ketua, sekretaris, penguji } = data.majelisPenguji;
  const [logoUWDP, signatureKetua, signatureSekretaris, signaturePenguji] =
    await Promise.all([
      imageToDataUrl("assets/logo-UWDP.png"),
      renderNormalizedSignature(ketua.signatureBase64, "Tanda tangan ketua majelis penguji"),
      renderNormalizedSignature(
        sekretaris.signatureBase64,
        "Tanda tangan sekretaris majelis penguji",
      ),
      renderNormalizedSignature(penguji.signatureBase64, "Tanda tangan penguji"),
    ]);
  const values = {
    "{{logoUWDP}}": logoUWDP,
    "{{hari}}": data.hari,
    "{{tanggalUjian}}": data.tanggalUjian,
    "{{waktu}}": data.waktu,
    "{{namaMahasiswa}}": data.mahasiswa.nama,
    "{{npm}}": data.mahasiswa.npm,
    "{{programStudi}}": data.mahasiswa.programStudi,
    "{{judulSkripsi}}": data.mahasiswa.judulSkripsi,
    "{{ujianKe}}": data.ujianKe,
    "{{nilaiUjian}}": formatScore(score),
    "{{grade}}": gradeFromScore(score),
    "{{tanggalDokumen}}": data.tanggalDokumen,
    "{{namaKetua}}": ketua.nama,
    "{{namaSekretaris}}": sekretaris.nama,
    "{{namaPenguji}}": penguji.nama,
  };
  const html = Object.entries(values).reduce(
    (result, [placeholder, value]) =>
      result.replaceAll(placeholder, escapeHtml(value)),
    template,
  );
  return html
    .replace("{{hasilUjianOptions}}", renderResultOptions(data.hasilSeminar))
    .replace(
      "{{catatanMajelisPenguji}}",
      renderNotes(data.catatanMajelisPenguji),
    )
    .replace("{{signatureKetua}}", signatureKetua)
    .replace("{{signatureSekretaris}}", signatureSekretaris)
    .replace("{{signaturePenguji}}", signaturePenguji);
}

async function generateBeritaAcaraHasilSeminarProposalFTI(data) {
  return renderPdf({
    templatePath,
    cssPath,
    renderHtml: (template) => renderTemplate(template, data),
  });
}

module.exports = {
  generateBeritaAcaraHasilSeminarProposalFTI,
};
