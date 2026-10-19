const path = require("node:path");
const { replacePlaceholders } = require("./shared/html.js");
const { imageToDataUrl, renderNormalizedSignature } = require("./shared/images.js");
const { renderPdf } = require("./shared/pdf.js");
const templatePath = path.join(__dirname, "../templates/surat-pengantar-penelitian-fti/template.html");
const cssPath = path.join(__dirname, "../templates/surat-pengantar-penelitian-fti/template.css");

const BULAN_ID = [
  "Januari",
  "Februari",
  "Maret",
  "April",
  "Mei",
  "Juni",
  "Juli",
  "Agustus",
  "September",
  "Oktober",
  "November",
  "Desember",
];

function formatTanggalIndonesia(date) {
  return `${date.getDate()} ${BULAN_ID[date.getMonth()]} ${date.getFullYear()}`;
}

/**
 * Loads everything the surat pengantar needs for one pengajuan_disposisi_pembimbing row.
 * Judul prefers the latest skripsi row created from the same outline, falling back to outline.judul.
 * Returns null when the pengajuan does not exist.
 */
async function getSuratPengantarPenelitianData(conn, pengajuanDisposisiPembimbingId) {
  const [[row]] = await conn.query(
    `SELECT pj.npm, pj.nomor_sk_surat_pengantar, pj.nama_perusahaan,
            pj.alamat_perusahaan, pj.submitted_at,
            m.nama AS nama_mahasiswa,
            ps.nama AS program_studi_nama,
            COALESCE(
              (SELECT s.judul FROM skripsi s
               WHERE s.outline_id = pj.outline_id
               ORDER BY s.id DESC LIMIT 1),
              o.judul
            ) AS judul_skripsi,
            COALESCE(staf_kaprodi.nama, d_kaprodi.nama) AS nama_kaprodi,
            md_kaprodi.dsnTtd AS kaprodi_sig
     FROM pengajuan_disposisi_pembimbing pj
     JOIN mahasiswa m ON m.npm = pj.npm
     JOIN program_studi ps ON ps.id = m.program_studi_id
     LEFT JOIN outline o ON o.id = pj.outline_id
     LEFT JOIN staf staf_kaprodi ON staf_kaprodi.usr_id = ps.kaprodi_staff_usr_id
     LEFT JOIN dosen d_kaprodi ON d_kaprodi.nidn = ps.kaprodi_nidn
     LEFT JOIN widya_miko.c_useradm cua_kaprodi ON cua_kaprodi.usrId = ps.kaprodi_staff_usr_id
     LEFT JOIN widya_miko.m_dosen md_kaprodi ON md_kaprodi.dsnNama = cua_kaprodi.usrNama
     WHERE pj.id = ?
     LIMIT 1`,
    [pengajuanDisposisiPembimbingId],
  );
  if (!row) return null;

  return {
    nomorSurat: row.nomor_sk_surat_pengantar ?? "",
    tanggalSurat: row.submitted_at
      ? formatTanggalIndonesia(new Date(row.submitted_at))
      : "",
    lampiran: "-",
    penerima: {
      namaPerusahaan: row.nama_perusahaan ?? "",
      alamatPerusahaan: row.alamat_perusahaan ?? "",
    },
    mahasiswa: {
      nama: row.nama_mahasiswa ?? "",
      npm: row.npm ?? "",
      programStudi: row.program_studi_nama ?? "",
      judulSkripsi: row.judul_skripsi ?? "",
    },
    ketuaProgramStudi: {
      nama: row.nama_kaprodi ?? "",
      signatureBase64: row.kaprodi_sig ?? null,
    },
  };
}

async function renderTemplate(template, data) {
  const [logoUWDP, signature] = await Promise.all([
    imageToDataUrl("assets/logo-UWDP.png"),
    renderNormalizedSignature(
      data.ketuaProgramStudi.signatureBase64,
      "Tanda tangan ketua program studi",
    ),
  ]);
  const { mahasiswa, penerima } = data;
  return replacePlaceholders(template, {
    "{{logoUWDP}}": logoUWDP,
    "{{nomorSurat}}": data.nomorSurat,
    "{{tanggalSurat}}": data.tanggalSurat,
    "{{lampiran}}": data.lampiran || "-",
    "{{namaPerusahaan}}": penerima.namaPerusahaan,
    "{{alamatPerusahaan}}": penerima.alamatPerusahaan,
    "{{namaMahasiswa}}": mahasiswa.nama,
    "{{npm}}": mahasiswa.npm,
    "{{programStudi}}": mahasiswa.programStudi,
    "{{judulSkripsi}}": mahasiswa.judulSkripsi,
    "{{namaKetuaProgramStudi}}": data.ketuaProgramStudi.nama,
  }).replace("{{signatureKetuaProgramStudi}}", signature);
}

async function generateSuratPengantarPenelitianFTI(data) {
  return renderPdf({
    templatePath,
    cssPath,
    renderHtml: (template) => renderTemplate(template, data),
  });
}

module.exports = {
  getSuratPengantarPenelitianData,
  generateSuratPengantarPenelitianFTI,
};
