const path = require("path");

const MB = 1024 * 1024;

const UPLOAD_RULES = {
  DOCUMENT: { extensions: [".pdf", ".doc", ".docx"], maxBytes: 10 * MB, label: "PDF, DOC, atau DOCX" },
  SCAN: { extensions: [".pdf", ".jpg", ".jpeg", ".png"], maxBytes: 10 * MB, label: "PDF, JPG, atau PNG" },
  // Transkrip nilai at Pengajuan Disposisi Pembimbing and its re-upload in SK Penulisan.
  TRANSKRIP: { extensions: [".pdf", ".jpg", ".jpeg", ".png", ".xlsx"], maxBytes: 10 * MB, label: "PDF, JPG, PNG, atau XLSX" },
  // Konsultasi Skripsi chapter files and the pembimbing's annotated file, and the whole Berkas Skripsi
  // and Artikel Jurnal at Pengajuan Sidang. Capped at 10 MB like every other rule: production MySQL's
  // max_allowed_packet is 16 MB and files are stored as base64 (+33%).
  SKRIPSI_CHAPTER: { extensions: [".pdf", ".doc", ".docx"], maxBytes: 10 * MB, label: "PDF, DOC, atau DOCX" },
  // File Skripsi and Artikel Penelitian at Pengumpulan Berkas Final (the student page accepts only PDF).
  PDF: { extensions: [".pdf"], maxBytes: 10 * MB, label: "PDF" },
  // Pas foto at Pengajuan Sidang.
  PHOTO: { extensions: [".jpg", ".jpeg", ".png"], maxBytes: 2 * MB, label: "JPG atau PNG" },
};

// Decoded size of a base64 payload (optionally a data URL) without decoding it.
function base64ByteLength(content) {
  const base64 = String(content).replace(/^data:[^,]*,/, "").replace(/\s/g, "");
  const padding = base64.endsWith("==") ? 2 : base64.endsWith("=") ? 1 : 0;
  return Math.floor((base64.length * 3) / 4) - padding;
}

// Server-side copy of the upload limits the pages enforce. Returns an error message, or null.
function validateUpload(content, fileName, rule, label) {
  const ext = path.extname(String(fileName ?? "")).toLowerCase();
  if (!rule.extensions.includes(ext)) {
    return `${label} harus berformat ${rule.label}`;
  }
  if (base64ByteLength(content) > rule.maxBytes) {
    return `Ukuran ${label} melebihi batas maksimum ${rule.maxBytes / MB} MB`;
  }
  return null;
}

module.exports = { UPLOAD_RULES, validateUpload };
