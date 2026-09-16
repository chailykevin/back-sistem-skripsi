const path = require("node:path");
const { escapeHtml } = require("./shared/html.js");
const { imageToDataUrl, renderSignature } = require("./shared/images.js");
const { renderPdf } = require("./shared/pdf.js");
const templatePath = path.join(__dirname, "../templates/notulen-penguji-fti/template.html");
const cssPath = path.join(__dirname, "../templates/notulen-penguji-fti/template.css");
function renderNote(note) {
  return note === null || note === undefined || note === ""
    ? ""
    : escapeHtml(note).replaceAll("\n", "<br />");
}

async function renderTemplate(template, data) {
  if (!["Lulus", "Tidak Lulus"].includes(data.hasilSidang)) {
    throw new TypeError('hasilSidang must be "Lulus" or "Tidak Lulus".');
  }

  const [logoFTI, signature] = await Promise.all([
    imageToDataUrl("assets/logo-FTI.png"),
    renderSignature(data.penguji.signaturePath, "Tanda tangan penguji"),
  ]);
  const values = {
    "{{logoFTI}}": logoFTI,
    "{{npm}}": data.mahasiswa.npm,
    "{{namaMahasiswa}}": data.mahasiswa.nama,
    "{{programStudi}}": data.mahasiswa.programStudi,
    "{{judulSkripsi}}": data.mahasiswa.judulSkripsi,
    "{{namaPembimbingPertama}}": data.pembimbing.pertama,
    "{{namaPembimbingKedua}}": data.pembimbing.kedua,
    "{{tanggalSidang}}": data.tanggalSidang,
    "{{hasilSidang}}": data.hasilSidang,
    "{{role}}": data.penguji.role,
    "{{namaPenguji}}": data.penguji.nama,
  };
  const html = Object.entries(values).reduce(
    (result, [placeholder, value]) =>
      result.replaceAll(placeholder, escapeHtml(value)),
    template,
  );
  return html
    .replace("{{note}}", renderNote(data.note))
    .replace("{{signature}}", signature);
}

async function generateNotulenPengujiFTI(data) {
  return renderPdf({
    templatePath,
    cssPath,
    renderHtml: async (template) => renderTemplate(template, data),
  });
}

module.exports = {
  generateNotulenPengujiFTI,
};
