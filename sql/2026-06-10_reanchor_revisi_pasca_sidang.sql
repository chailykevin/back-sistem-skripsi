-- Step 8: Re-anchor revisi_pasca_sidang from pengajuan_disposisi_pembimbing_id to skripsi_id
-- revisi_pasca_sidang is 1:1 with skripsi (one root revisi per student, re-exam resets in-place)

SET FOREIGN_KEY_CHECKS = 0;

-- 1. Add nullable skripsi_id column
ALTER TABLE revisi_pasca_sidang
  ADD COLUMN skripsi_id BIGINT UNSIGNED NULL AFTER sidang_id;

-- 2. Backfill via sidang (which already has skripsi_id)
UPDATE revisi_pasca_sidang rps
JOIN sidang s ON s.id = rps.sidang_id
SET rps.skripsi_id = s.skripsi_id
WHERE rps.skripsi_id IS NULL;

-- 3. Enforce NOT NULL, add UNIQUE constraint, add FK
ALTER TABLE revisi_pasca_sidang
  MODIFY COLUMN skripsi_id BIGINT UNSIGNED NOT NULL,
  ADD UNIQUE KEY uq_revisi_skripsi_id (skripsi_id),
  ADD CONSTRAINT fk_revisi_skripsi FOREIGN KEY (skripsi_id)
    REFERENCES skripsi (id) ON DELETE RESTRICT ON UPDATE CASCADE;

-- 4. Drop the old FK constraint and column
ALTER TABLE revisi_pasca_sidang
  DROP FOREIGN KEY fk_revisi_pengajuan_disposisi_pembimbing;

ALTER TABLE revisi_pasca_sidang
  DROP COLUMN pengajuan_disposisi_pembimbing_id;

SET FOREIGN_KEY_CHECKS = 1;
