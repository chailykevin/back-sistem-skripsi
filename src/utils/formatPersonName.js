const ACADEMIC_TITLES = new Map(
  [
    "S.E.", "S.S.", "S.Kom.", "S.T.", "S.H.", "S.Pd.", "S.Si.",
    "S.Sos.", "S.Ak.", "M.M.", "M.Kom.", "M.Hum.", "M.T.",
    "M.TI.", "M.TCSOL", "M.Si.", "M.Pd.", "M.Ak.", "M.H.",
    "M.A.", "M.Sc.", "MBA", "Ph.D.",
  ].map((title) => [title.replace(/[.\s]/g, "").toUpperCase(), title]),
);

/** Format source names without changing spelling or guessing unknown titles. */
function formatPersonName(value) {
  const clean = String(value ?? "").trim().replace(/\s+/g, " ");
  if (!clean) return "";

  const [personalName, ...titles] = clean.split(",");
  let name = personalName.trim();
  const prefixes = [];
  // Prefixes are handled separately so DR./PROF. retain their usual casing.
  const prefixPattern = /^(Prof|Dr|Ir)\.\s*/i;
  let match;
  while ((match = name.match(prefixPattern))) {
    const prefix = match[1].toLowerCase();
    prefixes.push(prefix[0].toUpperCase() + prefix.slice(1) + ".");
    name = name.slice(match[0].length);
  }

  name = name.replace(/\p{L}+/gu, (word) => {
    if (word !== word.toUpperCase()) return word;
    return word[0] + word.slice(1).toLowerCase();
  });

  const formattedName = [...prefixes, name].filter(Boolean).join(" ");
  const formattedTitles = titles.map((title) => {
    const trimmed = title.trim();
    const key = trimmed.replace(/[.\s]/g, "").toUpperCase();
    return ACADEMIC_TITLES.get(key) ?? trimmed;
  });
  return [formattedName, ...formattedTitles].join(", ");
}

module.exports = formatPersonName;
