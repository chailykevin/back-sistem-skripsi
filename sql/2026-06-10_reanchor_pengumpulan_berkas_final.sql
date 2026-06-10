-- Step 9 (final): Re-anchor pengumpulan_berkas_final from pengajuan_disposisi_pembimbing_id to skripsi_id

SET FOREIGN_KEY_CHECKS = 0;

-- 1. Add nullable skripsi_id column
ALTER TABLE pengumpulan_berkas_final
  ADD COLUMN skripsi_id BIGINT UNSIGNED NULL AFTER id;

-- 2. Backfill via pengajuan_disposisi_pembimbing → outline → skripsi
UPDATE pengumpulan_berkas_final pbf
JOIN pengajuan_disposisi_pembimbing pj ON pj.id = pbf.pengajuan_disposisi_pembimbing_id
JOIN skripsi sk ON sk.outline_id = pj.outline_id
SET pbf.skripsi_id = sk.id
WHERE pbf.skripsi_id IS NULL;

-- 3. Enforce NOT NULL, UNIQUE, FK
ALTER TABLE pengumpulan_berkas_final
  MODIFY COLUMN skripsi_id BIGINT UNSIGNED NOT NULL,
  ADD UNIQUE KEY uq_pengumpulan_skripsi_id (skripsi_id),
  ADD CONSTRAINT fk_pengumpulan_skripsi FOREIGN KEY (skripsi_id)
    REFERENCES skripsi (id) ON DELETE RESTRICT ON UPDATE CASCADE;

-- 4. Drop old FK and column
ALTER TABLE pengumpulan_berkas_final
  DROP FOREIGN KEY fk_pengumpulan_pengajuan_disposisi_pembimbing;

ALTER TABLE pengumpulan_berkas_final
  DROP COLUMN pengajuan_disposisi_pembimbing_id;

SET FOREIGN_KEY_CHECKS = 1;
