const MIME_BY_EXT = {
  ".docx":
    "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  ".doc": "application/msword",
  ".pdf": "application/pdf",
  ".xlsx": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
};

// For file tables without a mime_type column.
function mimeFromFileName(fileName) {
  const ext = fileName
    ? fileName.slice(fileName.lastIndexOf(".")).toLowerCase()
    : "";
  return MIME_BY_EXT[ext] ?? "application/octet-stream";
}

module.exports = { mimeFromFileName };
