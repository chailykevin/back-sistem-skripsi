-- Re-anchor skripsi from pengajuan_disposisi_pembimbing_id to outline_id.
-- Also drops the two bridge columns that were kept for this step:
--   kartu_konsultasi_outline.pengajuan_disposisi_pembimbing_id
--   pengajuan_sk_penelitian.pengajuan_disposisi_pembimbing_id

SET FOREIGN_KEY_CHECKS = 0;

-- Step 1: drop old unique index, add nullable outline_id
ALTER TABLE skripsi
  DROP INDEX uq_skripsi_pengajuan_disposisi_pembimbing_id,
  ADD COLUMN outline_id BIGINT UNSIGNED NULL AFTER id;

-- Step 2: back-fill outline_id from pengajuan_disposisi_pembimbing
UPDATE skripsi s
  JOIN pengajuan_disposisi_pembimbing pj ON pj.id = s.pengajuan_disposisi_pembimbing_id
  SET s.outline_id = pj.outline_id;

-- Step 3: enforce NOT NULL + UNIQUE FK
ALTER TABLE skripsi
  MODIFY COLUMN outline_id BIGINT UNSIGNED NOT NULL,
  ADD UNIQUE KEY uq_skripsi_outline_id (outline_id),
  ADD CONSTRAINT fk_skripsi_outline FOREIGN KEY (outline_id)
    REFERENCES outline (id) ON DELETE RESTRICT ON UPDATE CASCADE;

-- Drop pengajuan_disposisi_pembimbing_id — no longer the anchor
ALTER TABLE skripsi
  DROP COLUMN pengajuan_disposisi_pembimbing_id;

-- Drop bridge columns — skripsi INSERT no longer needs them
ALTER TABLE pengajuan_sk_penelitian
  DROP COLUMN pengajuan_disposisi_pembimbing_id;

ALTER TABLE kartu_konsultasi_outline
  DROP COLUMN pengajuan_disposisi_pembimbing_id;

SET FOREIGN_KEY_CHECKS = 1;
