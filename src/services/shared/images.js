const path = require("node:path");
const fs = require("node:fs/promises");
const { escapeHtml } = require("./html.js");
const projectRootPath = path.resolve(__dirname, "../..");
const mimeTypes = {
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".png": "image/png",
};

/** Converts a project-local image into a data URL for page.setContent(). */
async function imageToDataUrl(imagePath) {
  if (imagePath.startsWith("data:") || imagePath.startsWith("http"))
    return imagePath;
  const imageFilePath = path.resolve(projectRootPath, imagePath);
  const extension = path.extname(imageFilePath).toLowerCase();
  const mimeType = mimeTypes[extension];
  if (!mimeType) throw new Error(`Unsupported image type: ${imagePath}`);
  return `data:${mimeType};base64,${(await fs.readFile(imageFilePath)).toString("base64")}`;
}

/**
 * Renders an optional signature from raw base64 image data or a data URL.
 * Raw base64 is treated as PNG. Use null for an intentionally blank signature.
 */
async function renderSignature(
  signatureBase64,
  alt = "",
  className = "signature-image",
) {
  if (
    signatureBase64 === null ||
    signatureBase64 === undefined ||
    signatureBase64 === ""
  ) {
    return "";
  }
  const source = signatureBase64.startsWith("data:")
    ? signatureBase64
    : `data:image/png;base64,${signatureBase64}`;
  return `<img class="${escapeHtml(className)}" src="${escapeHtml(source)}" alt="${escapeHtml(alt)}" />`;
}

module.exports = {
  imageToDataUrl,
  renderSignature,
};
