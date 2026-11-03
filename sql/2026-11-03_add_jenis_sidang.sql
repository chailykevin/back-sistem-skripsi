-- Seminar Bisnis Digital foundation: a skripsi record can carry a Seminar sidang and later a
-- Skripsi sidang, so per-skripsi lookups must be scoped by type. Existing rows default to SKRIPSI.
-- pengajuan_sidang_kaprodi and revisi_pasca_sidang inherit the type through their FK.

ALTER TABLE skripsi
  ADD COLUMN jalur ENUM('SKRIPSI','SEMINAR_BISNIS_DIGITAL')
    CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT 'SKRIPSI' AFTER status;

ALTER TABLE pengajuan_sidang
  ADD COLUMN jenis ENUM('SKRIPSI','SEMINAR_BISNIS_DIGITAL')
    CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT 'SKRIPSI' AFTER skripsi_id,
  ADD KEY idx_pengajuan_sidang_skripsi_jenis (skripsi_id, jenis);

ALTER TABLE sidang
  ADD COLUMN jenis ENUM('SKRIPSI','SEMINAR_BISNIS_DIGITAL')
    CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT 'SKRIPSI' AFTER skripsi_id,
  ADD KEY idx_sidang_skripsi_jenis (skripsi_id, jenis);
