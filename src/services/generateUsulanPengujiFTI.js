const path = require("node:path");
const fs = require("node:fs/promises");
const { escapeHtml } = require("./shared/html.js");
const { renderNormalizedSignature } = require("./shared/images.js");
const { renderPdf } = require("./shared/pdf.js");
const templatePath = path.join(__dirname, "../templates/usulan-penguji-fti/template.html");
const cssPath = path.join(__dirname, "../templates/usulan-penguji-fti/template.css");
// pilihanPenguji.utama / .kedua are the prodi's eligible examiners (dosen_uji_sidang_skripsi_prodi),
// already sorted; utamaNomor / keduaNomor are the 1-based positions of the student's picks.
function validateChoice(choice, roster, label) {
  if (!Number.isInteger(choice) || choice < 1 || choice > roster.length) {
    throw new Error(`${label} must be a number from 1 to ${roster.length}`);
  }
}

function renderRows(roster, selectedNumber) {
  return roster
    .map(
      (name, index) =>
        `<tr${index + 1 === selectedNumber ? ' class="selected"' : ""}><td>${index + 1}</td><td>${escapeHtml(String(name).toLocaleUpperCase("id-ID"))}</td></tr>`,
    )
    .join("");
}

async function renderTemplate(template, data) {
  const { utama, kedua, utamaNomor, keduaNomor } = data.pilihanPenguji;
  validateChoice(utamaNomor, utama, "pilihanPenguji.utamaNomor");
  validateChoice(keduaNomor, kedua, "pilihanPenguji.keduaNomor");

  const [signatureKetuaProgramStudi, signatureMahasiswa, signatureDisposisi] =
    await Promise.all([
      renderNormalizedSignature(
        data.ketuaProgramStudi.signatureBase64,
        "Tanda tangan ketua program studi",
      ),
      renderNormalizedSignature(data.mahasiswa.signatureBase64, "Tanda tangan mahasiswa"),
      renderNormalizedSignature(data.disposisi.signatureBase64, "Tanda tangan disposisi kaprodi"),
    ]);

  const values = {
    "{{tanggal}}": data.tanggal,
    "{{programStudi}}": data.programStudi,
    "{{programStudiUppercase}}": data.programStudi.toLocaleUpperCase("id-ID"),
    "{{namaKetuaProgramStudi}}": data.ketuaProgramStudi.nama,
    "{{namaMahasiswa}}": data.mahasiswa.nama,
    "{{npm}}": data.mahasiswa.npm,
    "{{pembimbingUtama}}": data.mahasiswa.pembimbingUtama,
    "{{pembimbingKedua}}": data.mahasiswa.pembimbingKedua,
    "{{judulSkripsi}}": data.mahasiswa.judulSkripsi,
    "{{disposisiPengujiUtama}}": data.disposisi.pengujiUtama,
    "{{disposisiPengujiKedua}}": data.disposisi.pengujiKedua,
    "{{tanggalUjian}}": data.disposisi.tanggalUjian,
    "{{waktuUjian}}": data.disposisi.waktuUjian,
    "{{tanggalDisposisi}}": data.disposisi.tanggalDisposisi,
  };

  return Object.entries(values)
    .reduce(
      (html, [placeholder, value]) => html.replaceAll(placeholder, escapeHtml(value)),
      template,
    )
    .replace(
      "{{pengujiUtamaRows}}",
      renderRows(utama, utamaNomor),
    )
    .replace(
      "{{pengujiKeduaRows}}",
      renderRows(kedua, keduaNomor),
    )
    .replace("{{signatureKetuaProgramStudi}}", signatureKetuaProgramStudi)
    .replace("{{signatureMahasiswa}}", signatureMahasiswa)
    .replace("{{signatureDisposisi}}", signatureDisposisi);
}

async function generateUsulanPengujiFTI(data) {
  return renderPdf({
    templatePath,
    cssPath,
    renderHtml: async (template) => renderTemplate(template, data),
  });
}

module.exports = {
  generateUsulanPengujiFTI,
};
