const path = require("node:path");
const fs = require("node:fs/promises");
const { escapeHtml } = require("./html.js");
const projectRootPath = path.resolve(__dirname, "../..");
const mimeTypes = { ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".png": "image/png" };

/** Converts a project-local image into a data URL for page.setContent(). */
async function imageToDataUrl(imagePath) {
  if (imagePath.startsWith("data:") || imagePath.startsWith("http")) return imagePath;
  const imageFilePath = path.resolve(projectRootPath, imagePath);
  const extension = path.extname(imageFilePath).toLowerCase();
  const mimeType = mimeTypes[extension];
  if (!mimeType) throw new Error(`Unsupported image type: ${imagePath}`);
  return `data:${mimeType};base64,${(await fs.readFile(imageFilePath)).toString("base64")}`;
}

/** Renders an optional signature image. Use null for an intentionally blank signature. */
async function renderSignature(signaturePath, alt = "", className = "signature-image") {
  if (signaturePath === null || signaturePath === undefined) return "";
  const source = await imageToDataUrl(signaturePath);
  return `<img class="${escapeHtml(className)}" src="${escapeHtml(source)}" alt="${escapeHtml(alt)}" />`;
}

module.exports = {
  imageToDataUrl,
  renderSignature,
};
