// A stored signature only counts if it decodes to image bytes: a data URL, or raw base64.
function hasSignature(signatureValue) {
  if (signatureValue == null) return false;
  const raw = String(signatureValue).trim();
  if (!raw) return false;

  const dataUrlMatch = raw.match(/^data:image\/[a-zA-Z0-9.+-]+;base64,(.+)$/i);
  const base64 = (dataUrlMatch ? dataUrlMatch[1] : raw).replace(/\s+/g, "");
  return (
    base64.length > 0 &&
    /^[A-Za-z0-9+/=]+$/.test(base64) &&
    base64.length % 4 === 0
  );
}

function assertSignatures(checks) {
  const missing = checks
    .filter((c) => !hasSignature(c.signatureImage))
    .map((c) => ({ role: c.role, nama: c.nama ?? "" }));
  if (missing.length > 0) {
    const detail = missing
      .map((m) => `${m.role}${m.nama ? ` (${m.nama})` : ""}`)
      .join(", ");
    const err = new Error(
      `Dokumen belum dapat dibuat karena tanda tangan berikut belum tersimpan: ${detail}. Mohon hubungi admin agar pihak terkait mengunggah tanda tangan terlebih dahulu.`,
    );
    err.statusCode = 400;
    err.missingSignatures = missing;
    throw err;
  }
}

module.exports = { hasSignature, assertSignatures };
