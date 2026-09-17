const path = require("node:path");
const { escapeHtml } = require("./shared/html.js");
const { imageToDataUrl, renderSignature } = require("./shared/images.js");
const fs = require("node:fs/promises");
const puppeteer = require("puppeteer");
const templatePath = path.join(__dirname, "../templates/halaman-persetujuan-judul-desain-skripsi-fti/template.html");
const cssPath = path.join(__dirname, "../templates/halaman-persetujuan-judul-desain-skripsi-fti/template.css");
const projectRootUrl = path.join(__dirname, "../");
const mimeTypes = {
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".png": "image/png",
};

function renderPyramidTitle(title) {
  const words = String(title).trim().split(/\s+/).filter(Boolean);
  if (words.length < 4) return escapeHtml(title);

  const lineCount = words.length > 7 || title.length > 55 ? 3 : 2;
  const targetRatios = lineCount === 3 ? [0.42, 0.33, 0.25] : [0.56, 0.44];
  const targetLength = words.join(" ").length;
  let bestLines = null;
  let bestScore = Number.POSITIVE_INFINITY;

  function tryPartitions(startIndex, lines) {
    if (lines.length === lineCount - 1) {
      const candidate = [...lines, words.slice(startIndex).join(" ")];
      if (candidate.some((line) => !line)) return;
      const lengths = candidate.map((line) => line.length);
      const score =
        lengths.reduce(
          (total, length, index) =>
            total + (length - targetLength * targetRatios[index]) ** 2,
          0,
        ) +
        lengths
          .slice(1)
          .reduce(
            (total, length, index) =>
              total + Math.max(0, length - lengths[index]) ** 2 * 20,
            0,
          );
      if (score < bestScore) {
        bestLines = candidate;
        bestScore = score;
      }
      return;
    }

    for (
      let endIndex = startIndex + 1;
      endIndex < words.length;
      endIndex += 1
    ) {
      tryPartitions(endIndex, [
        ...lines,
        words.slice(startIndex, endIndex).join(" "),
      ]);
    }
  }

  tryPartitions(0, []);
  return bestLines.map((line) => `<span>${escapeHtml(line)}</span>`).join("");
}

async function renderTemplate(template, data) {
  const [
    signatureMahasiswa,
    signaturePembimbingPertama,
    signaturePembimbingKedua,
    signatureKetuaProgramStudi,
  ] = await Promise.all([
    renderSignature(data.mahasiswa.signatureBase64, "Tanda tangan mahasiswa"),
    renderSignature(
      data.pembimbing.pertama.signatureBase64,
      "Tanda tangan pembimbing pertama",
    ),
    renderSignature(
      data.pembimbing.kedua.signatureBase64,
      "Tanda tangan pembimbing kedua",
    ),
    renderSignature(
      data.ketuaProgramStudi.signatureBase64,
      "Tanda tangan ketua program studi",
    ),
  ]);
  const values = {
    "{{namaMahasiswa}}": data.mahasiswa.nama,
    "{{npm}}": data.mahasiswa.npm,
    "{{namaPembimbingPertama}}": data.pembimbing.pertama.nama,
    "{{namaPembimbingKedua}}": data.pembimbing.kedua.nama,
    "{{namaKetuaProgramStudi}}": data.ketuaProgramStudi.nama,
    "{{programStudi}}": data.programStudi,
    "{{programStudiFooter}}": data.programStudi.toUpperCase(),
    "{{tahun}}": data.tahun,
  };
  const html = Object.entries(values).reduce(
    (result, [placeholder, value]) =>
      result.replaceAll(placeholder, escapeHtml(value)),
    template,
  );
  return html
    .replace(
      "{{judulSkripsi}}",
      renderPyramidTitle(data.judulSkripsi.toUpperCase()),
    )
    .replace("{{signatureMahasiswa}}", signatureMahasiswa)
    .replace("{{signaturePembimbingPertama}}", signaturePembimbingPertama)
    .replace("{{signaturePembimbingKedua}}", signaturePembimbingKedua)
    .replace("{{signatureKetuaProgramStudi}}", signatureKetuaProgramStudi);
}

async function generateHalamanPersetujuanJudulDesainSkripsiFTI(data) {
  const [template, css] = await Promise.all([
    fs.readFile(templatePath, "utf8"),
    fs.readFile(cssPath, "utf8"),
  ]);
  const browser = await puppeteer.launch();
  try {
    const page = await browser.newPage();
    await page.setContent(await renderTemplate(template, data), {
      waitUntil: "load",
    });
    await page.addStyleTag({ content: css });
    return await page.pdf({
      preferCSSPageSize: true,
      printBackground: true,
      margin: { top: "0", right: "0", bottom: "0", left: "0" },
    });
  } finally {
    await browser.close();
  }
}

module.exports = {
  generateHalamanPersetujuanJudulDesainSkripsiFTI,
};
