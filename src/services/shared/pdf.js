const fs = require("node:fs/promises");
const puppeteer = require("puppeteer");
/** Loads a template pair, renders supplied HTML, and returns its PDF buffer. */
async function renderPdf({ templatePath, cssPath, renderHtml }) {
  const [template, css] = await Promise.all([fs.readFile(templatePath, "utf8"), fs.readFile(cssPath, "utf8")]);
  const browser = await puppeteer.launch();
  try {
    const page = await browser.newPage();
    await page.setContent(await renderHtml(template), { waitUntil: "load" });
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
  renderPdf,
};
