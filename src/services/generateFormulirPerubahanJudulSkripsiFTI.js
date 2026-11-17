const path = require("node:path");
const { escapeHtml } = require("./shared/html.js");
const { renderNormalizedSignature: signature } = require("./shared/images.js");
const { renderPdf } = require("./shared/pdf.js");
const templatePath = path.join(__dirname, "../templates/formulir-perubahan-judul-skripsi-fti/template.html");
const cssPath = path.join(__dirname, "../templates/formulir-perubahan-judul-skripsi-fti/template.css");

// The form asks for the revised part of the new title to be bolded: words of the new title that are
// not in the longest common word sequence with the old title (case-insensitive) are wrapped in <b>.
function highlightChangedWords(judulLama, judulBaru) {
  const oldWords = String(judulLama ?? "").trim().split(/\s+/).filter(Boolean);
  const newWords = String(judulBaru ?? "").trim().split(/\s+/).filter(Boolean);
  const a = oldWords.map((w) => w.toLowerCase());
  const b = newWords.map((w) => w.toLowerCase());
  const lcs = Array.from({ length: a.length + 1 }, () => new Array(b.length + 1).fill(0));
  for (let i = a.length - 1; i >= 0; i--) {
    for (let j = b.length - 1; j >= 0; j--) {
      lcs[i][j] = a[i] === b[j] ? lcs[i + 1][j + 1] + 1 : Math.max(lcs[i + 1][j], lcs[i][j + 1]);
    }
  }
  const changed = new Array(b.length).fill(true);
  let i = 0;
  let j = 0;
  while (i < a.length && j < b.length) {
    if (a[i] === b[j]) {
      changed[j] = false;
      i++;
      j++;
    } else if (lcs[i + 1][j] >= lcs[i][j + 1]) {
      i++;
    } else {
      j++;
    }
  }

  const parts = [];
  let run = [];
  let runChanged = null;
  const flush = () => {
    if (!run.length) return;
    const text = escapeHtml(run.join(" "));
    parts.push(runChanged ? `<b>${text}</b>` : text);
    run = [];
  };
  newWords.forEach((word, k) => {
    if (runChanged !== changed[k]) flush();
    runChanged = changed[k];
    run.push(word);
  });
  flush();
  return parts.join(" ");
}

async function renderTemplate(template, data) {
  const { mahasiswa, pembimbing, kaprodi, dekan } = data;
  const [sigMahasiswa, sigUtama, sigKedua, sigKaprodi, sigDekan] = await Promise.all([
    signature(mahasiswa.signatureBase64, "Tanda tangan mahasiswa"),
    signature(pembimbing.utama.signatureBase64, "Tanda tangan dosen pembimbing utama"),
    signature(pembimbing.kedua.signatureBase64, "Tanda tangan dosen pembimbing kedua"),
    signature(kaprodi.signatureBase64, "Tanda tangan ketua program studi"),
    signature(dekan.signatureBase64, "Tanda tangan dekan"),
  ]);
  const text = {
    namaMahasiswa: mahasiswa.nama,
    npm: mahasiswa.npm,
    noHp: mahasiswa.noHp,
    nomorSk: data.nomorSk,
    tanggalSeminar: data.tanggalSeminar,
    namaPembimbingUtama: pembimbing.utama.nama,
    namaPembimbingKedua: pembimbing.kedua.nama,
    namaPenguji: data.penguji.nama,
    judulLama: data.judulLama,
    tanggal: data.tanggal,
    programStudi: data.programStudi,
    namaKaprodi: kaprodi.nama,
    namaDekan: dekan.nama,
  };
  const html = {
    judulBaru: highlightChangedWords(data.judulLama, data.judulBaru),
    signatureMahasiswa: sigMahasiswa,
    signaturePembimbingUtama: sigUtama,
    signaturePembimbingKedua: sigKedua,
    signatureKaprodi: sigKaprodi,
    signatureDekan: sigDekan,
  };
  // One pass, so a value that happens to contain "{{...}}" is never substituted again.
  return template.replace(/\{\{(\w+)\}\}/g, (token, key) => {
    if (key in html) return html[key];
    if (key in text) return escapeHtml(text[key]);
    throw new Error(`Unknown placeholder ${token} in formulir perubahan judul template`);
  });
}

async function generateFormulirPerubahanJudulSkripsiFTI(data) {
  return renderPdf({
    templatePath,
    cssPath,
    renderHtml: (template) => renderTemplate(template, data),
  });
}

module.exports = {
  generateFormulirPerubahanJudulSkripsiFTI,
  highlightChangedWords,
};
