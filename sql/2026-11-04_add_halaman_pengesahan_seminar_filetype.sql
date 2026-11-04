-- Seminar Bisnis Digital: the revisi of a JUDUL_DITERIMA seminar ends with the Halaman Pengesahan
-- Proposal Skripsi (3 dosen signatures, no Dekan page).
ALTER TABLE revisi_pasca_sidang_files
  MODIFY COLUMN file_type ENUM(
    'HALAMAN_PENGESAHAN_MAJELIS_PENGUJI',
    'HALAMAN_PENGESAHAN_DEKAN',
    'HALAMAN_PENGESAHAN_SEMINAR_BD'
  ) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL;
