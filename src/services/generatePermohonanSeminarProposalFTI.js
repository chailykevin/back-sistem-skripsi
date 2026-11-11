const path = require("node:path");
const { escapeHtml } = require("./shared/html.js");
const { renderNormalizedSignature: signature } = require("./shared/images.js");
const { renderPdf } = require("./shared/pdf.js");
const templatePath = path.join(__dirname, "../templates/permohonan-seminar-proposal-fti/template.html");
const cssPath = path.join(__dirname, "../templates/permohonan-seminar-proposal-fti/template.css");

// The disposisi half stays blank until Kaprodi submits it, when the letter is regenerated.
async function renderTemplate(template, data) {
  const { mahasiswa, ketuaProgramStudi, disposisi } = data;
  const [signatureMahasiswa, signatureKaprodi] = await Promise.all([
    signature(mahasiswa.signatureBase64, "Tanda tangan mahasiswa"),
    signature(ketuaProgramStudi.signatureBase64, "Tanda tangan ketua program studi"),
  ]);
  const values = {
    "{{tanggal}}": data.tanggal,
    "{{programStudi}}": data.programStudi,
    "{{programStudiUppercase}}": data.programStudi.toLocaleUpperCase("id-ID"),
    "{{namaMahasiswa}}": mahasiswa.nama,
    "{{npm}}": mahasiswa.npm,
    "{{tempatTanggalLahir}}": mahasiswa.tempatTanggalLahir,
    "{{alamat}}": mahasiswa.alamat,
    "{{noHp}}": mahasiswa.noHp,
    "{{noWa}}": mahasiswa.noWa,
    "{{judulSkripsi}}": mahasiswa.judulSkripsi,
    "{{tanggalDisposisi}}": disposisi.tanggalDisposisi,
    "{{penguji}}": disposisi.penguji,
    "{{hariTanggal}}": disposisi.hariTanggal,
    "{{waktu}}": disposisi.waktu,
    "{{namaKaprodi}}": ketuaProgramStudi.nama,
  };
  return Object.entries(values)
    .reduce(
      (html, [token, value]) => html.replaceAll(token, escapeHtml(value)),
      template,
    )
    .replace("{{signatureMahasiswa}}", signatureMahasiswa)
    .replace("{{signatureKaprodi}}", signatureKaprodi);
}

async function generatePermohonanSeminarProposalFTI(data) {
  return renderPdf({
    templatePath,
    cssPath,
    renderHtml: (template) => renderTemplate(template, data),
  });
}

module.exports = {
  generatePermohonanSeminarProposalFTI,
};
