-- Re-anchor pengajuan_sidang and pengajuan_sidang_kaprodi
-- from pengajuan_disposisi_pembimbing_id to skripsi_id.
-- Also adds perlu_surat_pengantar to skripsi (backfilled from pengajuan_disposisi_pembimbing).

-- Step 0: add perlu_surat_pengantar to skripsi
ALTER TABLE skripsi
  ADD COLUMN perlu_surat_pengantar TINYINT(1) NOT NULL DEFAULT 0
  AFTER pembimbing2_nama;

UPDATE skripsi s
  JOIN pengajuan_disposisi_pembimbing pj ON pj.outline_id = s.outline_id
  SET s.perlu_surat_pengantar = pj.perlu_surat_pengantar;

SET FOREIGN_KEY_CHECKS = 0;

-- pengajuan_sidang: three-step
ALTER TABLE pengajuan_sidang
  ADD COLUMN skripsi_id BIGINT UNSIGNED NULL AFTER id;

UPDATE pengajuan_sidang ps
  JOIN pengajuan_disposisi_pembimbing pj ON pj.id = ps.pengajuan_disposisi_pembimbing_id
  JOIN skripsi s ON s.outline_id = pj.outline_id
  SET ps.skripsi_id = s.id;

ALTER TABLE pengajuan_sidang
  MODIFY COLUMN skripsi_id BIGINT UNSIGNED NOT NULL,
  ADD KEY idx_pengajuan_sidang_skripsi_id (skripsi_id),
  ADD CONSTRAINT fk_pengajuan_sidang_skripsi FOREIGN KEY (skripsi_id)
    REFERENCES skripsi (id) ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE pengajuan_sidang DROP COLUMN pengajuan_disposisi_pembimbing_id;

-- pengajuan_sidang_kaprodi: three-step
ALTER TABLE pengajuan_sidang_kaprodi
  ADD COLUMN skripsi_id BIGINT UNSIGNED NULL AFTER id;

UPDATE pengajuan_sidang_kaprodi psk
  JOIN pengajuan_disposisi_pembimbing pj ON pj.id = psk.pengajuan_disposisi_pembimbing_id
  JOIN skripsi s ON s.outline_id = pj.outline_id
  SET psk.skripsi_id = s.id;

ALTER TABLE pengajuan_sidang_kaprodi
  MODIFY COLUMN skripsi_id BIGINT UNSIGNED NOT NULL,
  ADD KEY idx_pengajuan_sidang_kaprodi_skripsi_id (skripsi_id),
  ADD CONSTRAINT fk_pengajuan_sidang_kaprodi_skripsi FOREIGN KEY (skripsi_id)
    REFERENCES skripsi (id) ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE pengajuan_sidang_kaprodi DROP COLUMN pengajuan_disposisi_pembimbing_id;

-- Add skripsi_id to sidang (nullable for now; enforced NOT NULL when sidang is re-anchored)
ALTER TABLE sidang
  ADD COLUMN skripsi_id BIGINT UNSIGNED NULL AFTER pengajuan_disposisi_pembimbing_id;

UPDATE sidang sd
  JOIN pengajuan_disposisi_pembimbing pj ON pj.id = sd.pengajuan_disposisi_pembimbing_id
  JOIN skripsi s ON s.outline_id = pj.outline_id
  SET sd.skripsi_id = s.id;

SET FOREIGN_KEY_CHECKS = 1;
