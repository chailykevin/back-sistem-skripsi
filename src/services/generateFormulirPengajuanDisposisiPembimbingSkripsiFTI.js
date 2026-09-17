const path = require("node:path");
const { escapeHtml } = require("./shared/html.js");
const fs = require("node:fs/promises");
const puppeteer = require("puppeteer");
const templatePath = path.join(
  __dirname,
  "../templates/formulir-pengajuan-disposisi-pembimbing-skripsi-fti/template.html",
);
const cssPath = path.join(
  __dirname,
  "../templates/formulir-pengajuan-disposisi-pembimbing-skripsi-fti/template.css",
);
function renderCheckbox(label, checked) {
  return `<span class="checkbox-option"><span class="checkbox">${checked ? "&#10003;" : ""}</span>${escapeHtml(label)}</span>`;
}

/**
 * Renders an optional signature from a raw base64 PNG string or a data URL.
 * Use null when the signature should remain blank.
 */
function renderBase64Signature(base64, alt) {
  if (base64 === null || base64 === undefined || base64 === "") return "";

  const source = base64.startsWith("data:")
    ? base64
    : `data:image/png;base64,${base64}`;
  return `<img class="signature-image" src="${escapeHtml(source)}" alt="${escapeHtml(alt)}" />`;
}

function renderRequirements(requirements) {
  const items = [
    ["Salinan transkrip nilai", requirements.salinanTranskripNilai],
    ["Kartu Rencana Studi (KRS)", requirements.kartuRencanaStudi],
    [
      "Lulus mata kuliah Metodologi Penelitian dengan nilai minimal C",
      requirements.lulusMetodologiPenelitian,
    ],
  ];
  return items
    .map(
      ([label, checked]) =>
        `<li class="requirement-item"><span class="checkbox">${checked ? "&#10003;" : ""}</span>${escapeHtml(label)}</li>`,
    )
    .join("");
}

async function renderTemplate(template, data) {
  const { mahasiswa, pengajuan, disposisi } = data;
  if (!["Diterima", "Ditolak"].includes(disposisi.keputusan)) {
    throw new Error('Keputusan must be either "Diterima" or "Ditolak".');
  }
  const [signaturePemohon, signatureKetuaProgramStudi] = await Promise.all([
    renderBase64Signature(pengajuan.signatureBase64, "Tanda tangan pemohon"),
    renderBase64Signature(
      disposisi.signatureBase64,
      "Tanda tangan ketua program studi",
    ),
  ]);
  const values = {
    "{{npm}}": mahasiswa.npm,
    "{{nama}}": mahasiswa.nama,
    "{{programStudi}}": mahasiswa.programStudi,
    "{{nomorHp}}": mahasiswa.nomorHp,
    "{{sksDiperoleh}}": mahasiswa.sksDiperoleh,
    "{{judulDiajukan}}": mahasiswa.judulDiajukan,
    "{{dosenPembimbingPertama}}": mahasiswa.dosenPembimbingPertama,
    "{{dosenPembimbingKedua}}": mahasiswa.dosenPembimbingKedua,
    "{{perluSuratPengantar}}": `<span class="checkbox-group">${renderCheckbox("Ya", pengajuan.perluSuratPengantar.ya)}${renderCheckbox("Tidak", pengajuan.perluSuratPengantar.tidak)}</span>`,
    "{{namaPerusahaan}}": pengajuan.namaPerusahaan,
    "{{tanggalPengajuan}}": pengajuan.tanggal,
    "{{namaPemohon}}": pengajuan.namaPemohon,
    "{{programStudiDisposisi}}": disposisi.programStudi.toUpperCase(),
    "{{tanggalDisposisi}}": disposisi.tanggal,
    "{{keputusan}}": disposisi.keputusan,
    "{{dosenPembimbingPertamaDisposisi}}": disposisi.dosenPembimbingPertama,
    "{{dosenPembimbingKeduaDisposisi}}": disposisi.dosenPembimbingKedua,
    "{{catatan}}": disposisi.catatan,
    "{{namaKetuaProgramStudi}}": disposisi.namaKetuaProgramStudi,
  };
  const html = Object.entries(values).reduce(
    (result, [placeholder, value]) =>
      result.replaceAll(
        placeholder,
        placeholder === "{{perluSuratPengantar}}" ? value : escapeHtml(value),
      ),
    template,
  );
  return html
    .replace(
      "{{syaratAdministratif}}",
      renderRequirements(pengajuan.syaratAdministratif),
    )
    .replace("{{signaturePemohon}}", signaturePemohon)
    .replace("{{signatureKetuaProgramStudi}}", signatureKetuaProgramStudi);
}

async function generateFormulirPengajuanDisposisiPembimbingSkripsiFTI(data) {
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
    await page.evaluate(() => {
      const form = document.querySelector(".page");
      const root = document.documentElement;
      const pageHeight = (296 / 25.4) * 96;
      const minimumHeight = (5 / 25.4) * 96;
      const maximumHeight = (50 / 25.4) * 96;
      const fits = (height) => {
        root.style.setProperty("--signature-height", `${height}px`);
        return form.getBoundingClientRect().height <= pageHeight + 1;
      };

      if (!fits(minimumHeight)) return;

      let low = minimumHeight;
      let high = maximumHeight;
      for (let iteration = 0; iteration < 16; iteration += 1) {
        const middle = (low + high) / 2;
        if (fits(middle)) low = middle;
        else high = middle;
      }
      root.style.setProperty("--signature-height", `${low}px`);
    });
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
  generateFormulirPengajuanDisposisiPembimbingSkripsiFTI,
};
