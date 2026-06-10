-- Re-anchor sidang from pengajuan_disposisi_pembimbing_id to skripsi_id.
-- skripsi_id column already exists (nullable, backfilled in prior migration step).

SET FOREIGN_KEY_CHECKS = 0;

ALTER TABLE sidang
  MODIFY COLUMN skripsi_id BIGINT UNSIGNED NOT NULL,
  ADD KEY idx_sidang_skripsi_id (skripsi_id),
  ADD CONSTRAINT fk_sidang_skripsi FOREIGN KEY (skripsi_id)
    REFERENCES skripsi (id) ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE sidang DROP COLUMN pengajuan_disposisi_pembimbing_id;

SET FOREIGN_KEY_CHECKS = 1;
