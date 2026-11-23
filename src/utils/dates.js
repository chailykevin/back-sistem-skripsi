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

const BULAN_ROMAWI = [
  "I",
  "II",
  "III",
  "IV",
  "V",
  "VI",
  "VII",
  "VIII",
  "IX",
  "X",
  "XI",
  "XII",
];

// "5 Januari 2026"; accepts a Date or anything `new Date()` accepts.
function formatTanggal(date) {
  const d = new Date(date);
  return `${d.getDate()} ${BULAN_ID[d.getMonth()]} ${d.getFullYear()}`;
}

const BULAN_SINGKAT = ["Jan", "Feb", "Mar", "Apr", "Mei", "Jun", "Jul", "Agu", "Sep", "Okt", "Nov", "Des"];
const HARI_ID = ["Minggu", "Senin", "Selasa", "Rabu", "Kamis", "Jumat", "Sabtu"];

// "5 Jan 2026", for metadata where the full month name would not fit.
function formatTanggalSingkat(date) {
  const d = new Date(date);
  return `${d.getDate()} ${BULAN_SINGKAT[d.getMonth()]} ${d.getFullYear()}`;
}

// "Senin, 5 Januari 2026"
function formatHariTanggal(date) {
  const d = new Date(date);
  return `${HARI_ID[d.getDay()]}, ${formatTanggal(d)}`;
}

// "2026-01-05" in the server's local time, for DATE columns (toISOString() would give the UTC date,
// a day early before 07:00 WIB).
function toIsoDate(date = new Date()) {
  const d = new Date(date);
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  return `${d.getFullYear()}-${mm}-${dd}`;
}

module.exports = { BULAN_ID, BULAN_ROMAWI, formatTanggal, formatTanggalSingkat, formatHariTanggal, toIsoDate };
