const path = require("node:path");
const fs = require("node:fs/promises");
const { escapeHtml } = require("./shared/html.js");
const { renderSignature } = require("./shared/images.js");
const { renderPdf } = require("./shared/pdf.js");
const templatePath = path.join(__dirname, "../templates/usulan-penguji-fti/template.html");
const cssPath = path.join(__dirname, "../templates/usulan-penguji-fti/template.css");
const pengujiUtama = [
  "RIYADI J. ISKANDAR, S.KOM., M.M., M.KOM.",
  "GENRAWAN HOENDARTO, S.T., M.KOM.",
  "TONY DARMANTO, S.T., M.KOM.",
  "KRISTINA, S.T., M.KOM.",
  "ALFRED YULIUS A.P., S.T., M.KOM.",
  "ANTONIUS, S.KOM., M.KOM.",
  "MANORANG GULTOM, S.T., M.T.",
  "THOMMY WILLAY, S.KOM., M.KOM.",
  "SANDI TENDEAN, S.KOM., M.KOM.",
  "RICKY I. NDAUMANU, S.KOM., M.KOM.",
  "JIMMY TJEN, PH.D.",
];
const pengujiKedua = [
  "RIYADI J. ISKANDAR, S.KOM., M.M., M.KOM.",
  "GENRAWAN HOENDARTO, S.T., M.KOM.",
  "THOMMY WILLAY, S.KOM., M.KOM.",
  "SANDI TENDEAN, S.KOM., M.KOM.",
  "TONY DARMANTO, S.T., M.KOM.",
  "KRISTINA, S.T., M.KOM.",
  "ANTONIUS, S.KOM., M.KOM.",
  "ALFRED YULIUS A.P., S.T., M.KOM.",
  "KARTONO, S.KOM., M.KOM.",
  "RICKY I. NDAUMANU, S.KOM., M.KOM.",
  "MANORANG GULTOM, S.T., M.T.",
  "SUSANA, S.KOM., M.TI.",
  "HENDRO, S.KOM., M.M., M.TI.",
  "PASKALIA KARTINI, S.T., M.T.",
  "KRISYESIKA, S.KOM., M.T.I.",
  "JIMMY TJEN, PH.D.",
  "AMOK DARMIANTO, S.KOM., M.KOM.",
];

function validateChoice(choice, roster, label) {
  if (!Number.isInteger(choice) || choice < 1 || choice > roster.length) {
    throw new Error(`${label} must be a number from 1 to ${roster.length}`);
  }
}

function resolvePengujiChoice(name, type) {
  const roster = type === "utama" ? pengujiUtama : pengujiKedua;
  const normalizedName = String(name ?? "")
    .trim()
    .replace(/\s+/g, " ")
    .toLocaleUpperCase("id-ID");
  const choice = roster.findIndex(
    (candidate) =>
      candidate.replace(/\s+/g, " ").toLocaleUpperCase("id-ID") ===
      normalizedName,
  );

  if (choice === -1) {
    throw new Error(
      `Selected ${type} examiner is not in the permitted examiner roster: ${name ?? ""}`,
    );
  }

  return choice + 1;
}

function renderRows(roster, selectedNumber) {
  return roster
    .map(
      (name, index) =>
        `<tr${index + 1 === selectedNumber ? ' class="selected"' : ""}><td>${index + 1}</td><td>${escapeHtml(name)}</td></tr>`,
    )
    .join("");
}

async function renderTemplate(template, data) {
  validateChoice(
    data.pilihanPenguji.utamaNomor,
    pengujiUtama,
    "pilihanPenguji.utamaNomor",
  );
  validateChoice(
    data.pilihanPenguji.keduaNomor,
    pengujiKedua,
    "pilihanPenguji.keduaNomor",
  );

  const [signatureKetuaProgramStudi, signatureMahasiswa, signatureDisposisi] =
    await Promise.all([
      renderSignature(
        data.ketuaProgramStudi.signatureBase64,
        "Tanda tangan ketua program studi",
      ),
      renderSignature(data.mahasiswa.signatureBase64, "Tanda tangan mahasiswa"),
      renderSignature(
        data.disposisi.signatureBase64,
        "Tanda tangan disposisi kaprodi",
        "signature-image",
        false,
      ),
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
      renderRows(pengujiUtama, data.pilihanPenguji.utamaNomor),
    )
    .replace(
      "{{pengujiKeduaRows}}",
      renderRows(pengujiKedua, data.pilihanPenguji.keduaNomor),
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
  resolvePengujiChoice,
};
