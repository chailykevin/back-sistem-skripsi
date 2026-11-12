const path = require("path");

const MB = 1024 * 1024;

const UPLOAD_RULES = {
  DOCUMENT: { extensions: [".pdf", ".doc", ".docx"], maxBytes: 10 * MB, label: "PDF, DOC, atau DOCX" },
  SCAN: { extensions: [".pdf", ".jpg", ".jpeg", ".png"], maxBytes: 10 * MB, label: "PDF, JPG, atau PNG" },
  // Transkrip nilai at Pengajuan Disposisi Pembimbing and its re-upload in SK Penulisan.
  TRANSKRIP: { extensions: [".pdf", ".jpg", ".jpeg", ".png", ".xlsx"], maxBytes: 10 * MB, label: "PDF, JPG, PNG, atau XLSX" },
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
