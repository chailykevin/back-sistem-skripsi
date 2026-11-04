const path = require("node:path");
const { escapeHtml } = require("./shared/html.js");
const { imageToDataUrl, renderNormalizedSignature } = require("./shared/images.js");
const { renderPdf } = require("./shared/pdf.js");
const templatePath = path.join(__dirname, "../templates/hasil-penilaian-akhir-seminar-proposal-fti/template.html");
const cssPath = path.join(__dirname, "../templates/hasil-penilaian-akhir-seminar-proposal-fti/template.css");

function formatNumber(value) {
  if (!Number.isFinite(value))
    throw new TypeError("Each assessor score must be a finite number.");
  return value.toFixed(2);
}

function gradeFromAverage(average) {
  if (average >= 80) return "A";
  if (average >= 70) return "B";
  if (average >= 60) return "C";
  return "D";
}

// Three assessors (both pembimbing and the single penguji), so the average is over 3.
async function renderTemplate(template, data) {
  const { pembimbingPertama, pembimbingKedua, penguji } = data.timPenguji;
  const scores = [pembimbingPertama, pembimbingKedua, penguji].map(({ nilai }) =>
    Number(nilai),
  );
  const grandTotal = scores.reduce((sum, score) => sum + score, 0);
  const average = grandTotal / scores.length;
  const [logoUWDP, signaturePimpinanSidang] = await Promise.all([
    imageToDataUrl("assets/logo-UWDP.png"),
    renderNormalizedSignature(pembimbingPertama.signatureBase64),
  ]);
  const values = {
    "{{logoUWDP}}": logoUWDP,
    "{{namaMahasiswa}}": data.mahasiswa.nama,
    "{{npm}}": data.mahasiswa.npm,
    "{{programStudi}}": data.mahasiswa.programStudi,
    "{{judulSkripsi}}": data.mahasiswa.judulSkripsi,
    "{{ujianKe}}": data.ujianKe,
    "{{tanggal}}": data.tanggal,
    "{{namaPembimbingPertama}}": pembimbingPertama.nama,
    "{{nilaiPembimbingPertama}}": formatNumber(scores[0]),
    "{{namaPembimbingKedua}}": pembimbingKedua.nama,
    "{{nilaiPembimbingKedua}}": formatNumber(scores[1]),
    "{{namaPenguji}}": penguji.nama,
    "{{nilaiPenguji}}": formatNumber(scores[2]),
    "{{grandTotalNilai}}": formatNumber(grandTotal),
    "{{rataRata}}": formatNumber(average),
    "{{grade}}": gradeFromAverage(average),
  };
  const html = Object.entries(values).reduce(
    (result, [placeholder, value]) =>
      result.replaceAll(placeholder, escapeHtml(value)),
    template,
  );
  return html.replace("{{signaturePimpinanSidang}}", signaturePimpinanSidang);
}

async function generateHasilPenilaianAkhirSeminarProposalFTI(data) {
  return renderPdf({
    templatePath,
    cssPath,
    renderHtml: (template) => renderTemplate(template, data),
  });
}

module.exports = {
  generateHasilPenilaianAkhirSeminarProposalFTI,
};
