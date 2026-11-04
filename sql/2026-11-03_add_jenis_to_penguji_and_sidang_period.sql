-- Seminar Bisnis Digital keeps its own penguji list and its own submission window in the existing
-- tables. Existing rows default to SKRIPSI. Seminar penguji rows use only role PENGUJI_1 (one penguji)
-- and only the Bisnis Digital prodi; both rules are enforced by the API.

-- The new unique key is added before the old one is dropped in the same statement, so the
-- dosen_nidn foreign key keeps an index that starts with its column.
ALTER TABLE dosen_uji_sidang_skripsi_prodi
  ADD COLUMN jenis ENUM('SKRIPSI','SEMINAR_BISNIS_DIGITAL')
    CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT 'SKRIPSI' AFTER role,
  ADD UNIQUE KEY uq_dosen_uji_sidang_skripsi_prodi_dosen_prodi_role_jenis (dosen_nidn, program_studi_id, role, jenis),
  DROP INDEX uq_dosen_uji_sidang_skripsi_prodi_dosen_prodi_role,
  DROP INDEX idx_dosen_uji_sidang_skripsi_prodi_prodi_role,
  ADD KEY idx_dosen_uji_sidang_skripsi_prodi_prodi_jenis_role (program_studi_id, jenis, role);

ALTER TABLE sidang_submission_period
  ADD COLUMN jenis ENUM('SKRIPSI','SEMINAR_BISNIS_DIGITAL')
    CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT 'SKRIPSI' AFTER id,
  ADD KEY idx_sidang_submission_period_jenis_open (jenis, open_at, close_at);
