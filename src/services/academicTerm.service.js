const db = require("../db");

function badRequest(message) {
  return Object.assign(new Error(message), { statusCode: 400 });
}

const PERIODE_BY_DIGIT = { 1: "GANJIL", 2: "GENAP" };
const PERIODES = new Set(["GANJIL", "GENAP"]);
const WIB_OFFSET_MS = 7 * 60 * 60 * 1000;

// SIMIKO akdKode: start year + 1 (Ganjil) or 2 (Genap), e.g. "20252" = 2025/2026 Genap.
function termFromAkdKode(akdKode) {
  const match = /^(\d{4})([12])$/.exec(String(akdKode ?? "").trim());
  if (!match) return null;
  const year = Number(match[1]);
  return { tahunAkademik: `${year}/${year + 1}`, periodeAkademik: PERIODE_BY_DIGIT[match[2]] };
}

// Calendar fallback in WIB: Aug–Jan = Ganjil, Feb–Jul = Genap.
function termFromDate(value) {
  const wib = new Date(new Date(value).getTime() + WIB_OFFSET_MS);
  const year = wib.getUTCFullYear();
  const month = wib.getUTCMonth() + 1;
  if (month >= 8) return { tahunAkademik: `${year}/${year + 1}`, periodeAkademik: "GANJIL" };
  if (month === 1) return { tahunAkademik: `${year - 1}/${year}`, periodeAkademik: "GANJIL" };
  return { tahunAkademik: `${year - 1}/${year}`, periodeAkademik: "GENAP" };
}

// The term SIMIKO marks active; the calendar term if SIMIKO can't be read or has no usable row.
async function getActiveAcademicTerm(queryable = db) {
  try {
    const [rows] = await queryable.query(
      `SELECT akdKode FROM widya_miko.r_akademik
       WHERE akdAktif = 1 AND del = 0
       ORDER BY akdKode DESC LIMIT 1`,
    );
    const term = termFromAkdKode(rows[0]?.akdKode);
    if (term) return term;
  } catch (err) {
    console.error("[academicTerm] SIMIKO r_akademik unreadable, using calendar term:", err.message);
  }
  return termFromDate(new Date());
}

function isValidTerm(term) {
  if (!term || !PERIODES.has(term.periodeAkademik)) return false;
  const match = /^(\d{4})\/(\d{4})$/.exec(String(term.tahunAkademik ?? ""));
  return Boolean(match) && Number(match[2]) === Number(match[1]) + 1;
}

function termIndex(term) {
  return Number(term.tahunAkademik.slice(0, 4)) * 2 + (term.periodeAkademik === "GENAP" ? 1 : 0);
}

// 1 in the cohort's own term, 2 in the next, ...
function semesterKe(cohort, term) {
  return termIndex(term) - termIndex(cohort) + 1;
}

function sameTerm(a, b) {
  return Boolean(a && b) && a.tahunAkademik === b.tahunAkademik && a.periodeAkademik === b.periodeAkademik;
}

// ?tahunAkademik=&periodeAkademik= → term, null when both omitted, 400 when partial or malformed.
function parseTermQuery(query) {
  const tahunAkademik = query?.tahunAkademik ? String(query.tahunAkademik) : null;
  const periodeAkademik = query?.periodeAkademik ? String(query.periodeAkademik).toUpperCase() : null;
  if (!tahunAkademik && !periodeAkademik) return null;
  const term = { tahunAkademik, periodeAkademik };
  if (!isValidTerm(term)) {
    throw badRequest("tahunAkademik (YYYY/YYYY) dan periodeAkademik (GANJIL/GENAP) harus diisi bersama.");
  }
  return term;
}

function cohortOf(row) {
  if (!row?.cohort_tahun_akademik || !row?.cohort_periode_akademik) return null;
  return { tahunAkademik: row.cohort_tahun_akademik, periodeAkademik: row.cohort_periode_akademik };
}

function formatTerm(term) {
  if (!term) return "";
  return `${term.tahunAkademik} ${term.periodeAkademik === "GENAP" ? "Genap" : "Ganjil"}`;
}

module.exports = {
  termFromAkdKode,
  termFromDate,
  getActiveAcademicTerm,
  isValidTerm,
  termIndex,
  semesterKe,
  sameTerm,
  parseTermQuery,
  cohortOf,
  formatTerm,
};
