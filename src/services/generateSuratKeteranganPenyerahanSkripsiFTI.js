const path = require("node:path");
const { escapeHtml } = require("./shared/html.js");
const { renderSignature: signature } = require("./shared/images.js");
const { renderPdf } = require("./shared/pdf.js");
const templatePath = path.join(__dirname, "../templates/surat-keterangan-penyerahan-skripsi-fti/template.html");
const cssPath = path.join(__dirname, "../templates/surat-keterangan-penyerahan-skripsi-fti/template.css");
async function renderTemplate(template, data) {
  const { mahasiswa, penerimaan, sekretarisProgramStudi } = data;
  const [perpus, lppm, first, second, utama, anggota, sekretaris, student] =
    await Promise.all([
      signature(
        penerimaan.perpustakaan.signaturePath,
        "Tanda tangan perpustakaan",
      ),
      signature(penerimaan.lppm.signaturePath, "Tanda tangan LPPM"),
      signature(
        penerimaan.pembimbingPertama.signaturePath,
        "Tanda tangan pembimbing pertama",
      ),
      signature(
        penerimaan.pembimbingKedua.signaturePath,
        "Tanda tangan pembimbing kedua",
      ),
      signature(
        penerimaan.pengujiUtama.signaturePath,
        "Tanda tangan penguji utama",
      ),
      signature(
        penerimaan.anggotaPenguji.signaturePath,
        "Tanda tangan anggota penguji",
      ),
      signature(
        sekretarisProgramStudi.signaturePath,
        "Tanda tangan sekretaris program studi",
      ),
      signature(mahasiswa.signaturePath, "Tanda tangan mahasiswa"),
    ]);
  const values = {
    "{{namaMahasiswa}}": mahasiswa.nama,
    "{{npm}}": mahasiswa.npm,
    "{{nomorHp}}": mahasiswa.nomorHp,
    "{{programStudi}}": mahasiswa.programStudi,
    "{{judulSkripsi}}": mahasiswa.judulSkripsi,
    "{{tanggalPerpustakaan}}": penerimaan.perpustakaan.tanggal,
    "{{tanggalLppm}}": penerimaan.lppm.tanggal,
    "{{tanggalPembimbingPertama}}": penerimaan.pembimbingPertama.tanggal,
    "{{tanggalPembimbingKedua}}": penerimaan.pembimbingKedua.tanggal,
    "{{tanggalPengujiUtama}}": penerimaan.pengujiUtama.tanggal,
    "{{tanggalAnggotaPenguji}}": penerimaan.anggotaPenguji.tanggal,
    "{{namaSekretarisProgramStudi}}": sekretarisProgramStudi.nama,
    "{{tanggalDibuat}}": data.tanggalDibuat,
  };
  return Object.entries(values)
    .reduce(
      (html, [token, value]) => html.replaceAll(token, escapeHtml(value)),
      template,
    )
    .replace("{{signaturePerpustakaan}}", perpus)
    .replace("{{signatureLppm}}", lppm)
    .replace("{{signaturePembimbingPertama}}", first)
    .replace("{{signaturePembimbingKedua}}", second)
    .replace("{{signaturePengujiUtama}}", utama)
    .replace("{{signatureAnggotaPenguji}}", anggota)
    .replace("{{signatureSekretarisProgramStudi}}", sekretaris)
    .replace("{{signatureMahasiswa}}", student);
}
async function generateSuratKeteranganPenyerahanSkripsiFTI(data) {
  return renderPdf({
    templatePath,
    cssPath,
    renderHtml: (template) => renderTemplate(template, data),
  });
}

module.exports = {
  generateSuratKeteranganPenyerahanSkripsiFTI,
};
