// Form Pengajuan Topik Seminar: the disposisi step of a Seminar Bisnis Digital student
// (tahap_tugas_akhir = SEMINAR_BISNIS_DIGITAL). The student proposes no pembimbing and uploads
// Data Perkembangan Akademik (stored as TRANSKRIP — it is the transkrip) and a fotocopy KTM; Kaprodi
// ticks five syarat, two for the files and three conditions read from Data Perkembangan Akademik.

// body field (Kaprodi review) → column
const SEMINAR_SYARAT = {
  syaratTranskrip: "syarat_transkrip",
  syaratKtm: "syarat_ktm",
  syaratSksMin: "syarat_sks_min",
  syaratSimulasiBisnis: "syarat_simulasi_bisnis",
  syaratNilaiD: "syarat_nilai_d",
};

// Ticks judged from Data Perkembangan Akademik: a newer one clears them, and any of them left
// unticked means the student has to upload a newer one.
const DATA_AKADEMIK_SYARAT_COLUMNS = [
  "syarat_transkrip",
  "syarat_sks_min",
  "syarat_simulasi_bisnis",
  "syarat_nilai_d",
];

function isSeminarTahap(tahapTugasAkhir) {
  return tahapTugasAkhir === "SEMINAR_BISNIS_DIGITAL";
}

async function isSeminarStudent(queryable, npm) {
  const [[row]] = await queryable.query(
    `SELECT tahap_tugas_akhir FROM mahasiswa WHERE npm = ? LIMIT 1`,
    [npm],
  );
  return isSeminarTahap(row?.tahap_tugas_akhir);
}

module.exports = {
  SEMINAR_SYARAT,
  DATA_AKADEMIK_SYARAT_COLUMNS,
  isSeminarTahap,
  isSeminarStudent,
};
