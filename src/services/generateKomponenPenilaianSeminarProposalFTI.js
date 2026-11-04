const path = require("node:path");
const { escapeHtml } = require("./shared/html.js");
const { imageToDataUrl, renderNormalizedSignature } = require("./shared/images.js");
const { renderPdf } = require("./shared/pdf.js");
const templatePath = path.join(__dirname, "../templates/komponen-penilaian-seminar-proposal-fti/template.html");
const cssPath = path.join(__dirname, "../templates/komponen-penilaian-seminar-proposal-fti/template.css");

function formatWeight(weight) {
  return typeof weight === "number" ? `${weight}%` : weight;
}

function renderAssessmentRows(rows) {
  const rowsToRender =
    rows.length === 0
      ? [{ komponen: "", bobot: "", nilai: "", keterangan: "" }]
      : rows;
  return rowsToRender
    .map(
      (row, index) =>
        `<tr><td>${escapeHtml(index + 1)}.</td><td>${escapeHtml(row.komponen)}</td><td>${escapeHtml(formatWeight(row.bobot))}</td><td>${escapeHtml(row.nilai)}</td><td>${escapeHtml(row.keterangan)}</td></tr>`,
    )
    .join("");
}

function calculateTotal(rows) {
  if (rows.length === 0) return "";
  const total = rows.reduce((sum, row) => {
    if (typeof row.nilai !== "number" || !Number.isFinite(row.nilai))
      throw new TypeError(
        "Each komponenPenilaian.nilai must be a finite number.",
      );
    return sum + row.nilai;
  }, 0);
  return total.toFixed(2);
}

async function renderTemplate(template, data) {
  if (!Array.isArray(data.komponenPenilaian))
    throw new TypeError("komponenPenilaian must be an array.");
  const [logoUWDP, signature] = await Promise.all([
    imageToDataUrl("assets/logo-UWDP.png"),
    renderNormalizedSignature(data.penilai.signatureBase64),
  ]);
  const values = {
    "{{logoUWDP}}": logoUWDP,
    "{{namaMahasiswa}}": data.mahasiswa.nama,
    "{{npm}}": data.mahasiswa.npm,
    "{{programStudi}}": data.mahasiswa.programStudi,
    "{{ujianKe}}": data.ujianKe,
    "{{tanggalUjian}}": data.tanggalUjian,
    "{{judulSkripsi}}": data.mahasiswa.judulSkripsi,
    "{{tanggalDokumen}}": data.tanggalDokumen,
    "{{role}}": data.penilai.role,
    "{{namaPenilai}}": data.penilai.nama,
    "{{totalNilai}}": calculateTotal(data.komponenPenilaian),
  };
  const html = Object.entries(values).reduce(
    (result, [placeholder, value]) =>
      result.replaceAll(placeholder, escapeHtml(value)),
    template,
  );
  return html
    .replace("{{signature}}", signature)
    .replace(
      "{{assessmentRows}}",
      renderAssessmentRows(data.komponenPenilaian),
    );
}

async function generateKomponenPenilaianSeminarProposalFTI(data) {
  return renderPdf({
    templatePath,
    cssPath,
    renderHtml: (template) => renderTemplate(template, data),
  });
}

module.exports = {
  generateKomponenPenilaianSeminarProposalFTI,
};
