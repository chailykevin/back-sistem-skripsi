const nodemailer = require("nodemailer");

const BULAN_ID = ["Januari", "Februari", "Maret", "April", "Mei", "Juni", "Juli", "Agustus", "September", "Oktober", "November", "Desember"];

function formatTanggalIndonesia(date) {
  return `${date.getDate()} ${BULAN_ID[date.getMonth()]} ${date.getFullYear()}`;
}

function createTransport() {
  return nodemailer.createTransport({
    host: process.env.SMTP_HOST,
    port: Number(process.env.SMTP_PORT) || 587,
    secure: process.env.SMTP_SECURE === "true",
    auth: {
      user: process.env.SMTP_USER,
      pass: process.env.SMTP_PASS,
    },
  });
}

/**
 * Send surat undangan sidang to all recipients.
 * Best-effort — caller should catch and log errors; do not roll back DB.
 *
 * @param {object} opts
 * @param {string[]} opts.recipients  - filtered list of email addresses
 * @param {Buffer}  opts.suratBuffer  - generated DOCX buffer
 * @param {string}  opts.npm
 * @param {string}  opts.namaMahasiswa
 * @param {string}  opts.sidangDate   - formatted date string (DD MMM YYYY)
 * @param {string}  opts.sidangTime   - HH:MM string
 * @param {string}  opts.tempat
 * @param {string}  opts.judulSkripsi
 */
async function sendSuratUndangan({ recipients, suratBuffer, npm, namaMahasiswa, sidangDate, sidangTime, tempat, judulSkripsi }) {
  if (!recipients || recipients.length === 0) return;

  const transporter = createTransport();

  const subject = `Undangan Sidang Skripsi - ${namaMahasiswa}`;

  const html = `
<!DOCTYPE html>
<html lang="id">
<head><meta charset="UTF-8"></head>
<body style="font-family: Arial, sans-serif; font-size: 14px; color: #333; line-height: 1.6; max-width: 600px; margin: 0 auto; padding: 20px;">
  <p>Kepada Yth.,<br>Bapak/Ibu,</p>

  <p>
    Dengan hormat, bersama surat ini kami sampaikan pemberitahuan bahwa mahasiswa berikut
    telah dijadwalkan untuk melaksanakan Sidang Skripsi:
  </p>

  <table style="border-collapse: collapse; width: 100%; margin: 16px 0;">
    <tr>
      <td style="padding: 4px 8px; width: 160px; font-weight: bold;">Nama Mahasiswa</td>
      <td style="padding: 4px 8px;">: ${namaMahasiswa}</td>
    </tr>
    <tr>
      <td style="padding: 4px 8px; font-weight: bold;">NPM</td>
      <td style="padding: 4px 8px;">: ${npm}</td>
    </tr>
    <tr>
      <td style="padding: 4px 8px; font-weight: bold;">Judul Skripsi</td>
      <td style="padding: 4px 8px;">: ${judulSkripsi || "-"}</td>
    </tr>
    <tr>
      <td style="padding: 4px 8px; font-weight: bold;">Tanggal Sidang</td>
      <td style="padding: 4px 8px;">: ${sidangDate || "-"}</td>
    </tr>
    <tr>
      <td style="padding: 4px 8px; font-weight: bold;">Waktu</td>
      <td style="padding: 4px 8px;">: ${sidangTime || "-"}</td>
    </tr>
    <tr>
      <td style="padding: 4px 8px; font-weight: bold;">Tempat</td>
      <td style="padding: 4px 8px;">: ${tempat || "-"}</td>
    </tr>
  </table>

  <p>
    Surat undangan resmi terlampir dalam email ini. Mohon untuk hadir tepat waktu sesuai jadwal
    yang telah ditentukan.
  </p>

  <p>
    Atas perhatian dan kehadiran Bapak/Ibu, kami ucapkan terima kasih.
  </p>

  <br>
  <p style="margin: 0;">Hormat kami,</p>
  <p style="margin: 0; font-weight: bold;">Sistem Skripsi</p>
</body>
</html>
  `.trim();

  await transporter.sendMail({
    from: process.env.SMTP_FROM || process.env.SMTP_USER,
    to: recipients.join(", "),
    subject,
    html,
    attachments: [
      {
        filename: `Surat_Undangan_Sidang_${npm}.docx`,
        content: suratBuffer,
        contentType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
      },
    ],
  });
}

module.exports = { sendSuratUndangan };
