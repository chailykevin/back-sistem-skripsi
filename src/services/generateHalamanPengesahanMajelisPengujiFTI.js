const path = require("node:path");
const { escapeHtml } = require("./shared/html.js");
const { renderSignature: signature } = require("./shared/images.js");
const { renderPdf } = require("./shared/pdf.js");
const templatePath = path.join(__dirname, "../templates/halaman-pengesahan-majelis-penguji-fti/template.html");
const cssPath = path.join(__dirname, "../templates/halaman-pengesahan-majelis-penguji-fti/template.css");
async function renderTemplate(template, data) {
  const { mahasiswa, majelisPenguji } = data;
  const [student, ketua, sekretaris, utama, anggota] = await Promise.all([
    signature(mahasiswa.signaturePath, "Tanda tangan mahasiswa"),
    signature(majelisPenguji.ketua.signaturePath, "Tanda tangan ketua"),
    signature(
      majelisPenguji.sekretaris.signaturePath,
      "Tanda tangan sekretaris",
    ),
    signature(
      majelisPenguji.pengujiUtama.signaturePath,
      "Tanda tangan penguji utama",
    ),
    signature(
      majelisPenguji.anggotaPenguji.signaturePath,
      "Tanda tangan anggota penguji",
    ),
  ]);
  const values = {
    "{{judulSkripsi}}": mahasiswa.judulSkripsi,
    "{{namaMahasiswa}}": mahasiswa.nama,
    "{{npm}}": mahasiswa.npm,
    "{{tanggalSidang}}": data.tanggalSidang,
    "{{namaKetua}}": majelisPenguji.ketua.nama,
    "{{namaSekretaris}}": majelisPenguji.sekretaris.nama,
    "{{namaPengujiUtama}}": majelisPenguji.pengujiUtama.nama,
    "{{namaAnggotaPenguji}}": majelisPenguji.anggotaPenguji.nama,
  };
  return Object.entries(values)
    .reduce(
      (html, [token, value]) => html.replaceAll(token, escapeHtml(value)),
      template,
    )
    .replace("{{signatureMahasiswa}}", student)
    .replace("{{signatureKetua}}", ketua)
    .replace("{{signatureSekretaris}}", sekretaris)
    .replace("{{signaturePengujiUtama}}", utama)
    .replace("{{signatureAnggotaPenguji}}", anggota);
}
async function generateHalamanPengesahanMajelisPengujiFTI(data) {
  return renderPdf({
    templatePath,
    cssPath,
    renderHtml: (template) => renderTemplate(template, data),
  });
}

module.exports = {
  generateHalamanPengesahanMajelisPengujiFTI,
};
