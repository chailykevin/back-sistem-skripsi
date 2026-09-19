/** Escapes dynamic text and attribute values before inserting them into HTML. */
function escapeHtml(value) {
  return String(value ?? "").replace(/[&<>'"]/g, (character) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    "'": "&#39;",
    '"': "&quot;",
  })[character]);
}

/** Replaces a placeholder map after escaping every value. */
function replacePlaceholders(template, values) {
  return Object.entries(values).reduce(
    (html, [placeholder, value]) => html.replaceAll(placeholder, escapeHtml(value)),
    template,
  );
}

module.exports = {
  escapeHtml,
  replacePlaceholders,
};
