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
        penerimaan.perpustakaan.signatureBase64,
        "Tanda tangan perpustakaan",
        "signature-image",
        false,
      ),
      signature(
        penerimaan.lppm.signatureBase64,
        "Tanda tangan LPPM",
        "signature-image",
        false,
      ),
      signature(
        penerimaan.pembimbingPertama.signatureBase64,
        "Tanda tangan pembimbing pertama",
        "signature-image",
        false,
      ),
      signature(
        penerimaan.pembimbingKedua.signatureBase64,
        "Tanda tangan pembimbing kedua",
        "signature-image",
        false,
      ),
      signature(
        penerimaan.pengujiUtama.signatureBase64,
        "Tanda tangan penguji utama",
        "signature-image",
        false,
      ),
      signature(
        penerimaan.anggotaPenguji.signatureBase64,
        "Tanda tangan anggota penguji",
        "signature-image",
        false,
      ),
      signature(
        sekretarisProgramStudi.signatureBase64,
        "Tanda tangan sekretaris program studi",
      ),
      signature(mahasiswa.signatureBase64, "Tanda tangan mahasiswa"),
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
