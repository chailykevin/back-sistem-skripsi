-- Re-anchor pengajuan_sk_penelitian from pengajuan_disposisi_pembimbing_id to outline_id.
-- pengajuan_disposisi_pembimbing_id kept as plain non-unique column —
-- skripsi INSERT still references it until skripsi is re-anchored to outline_id.

SET FOREIGN_KEY_CHECKS = 0;

-- Add column first (nullable so existing rows don't fail)
ALTER TABLE pengajuan_sk_penelitian
  DROP INDEX uq_sk_pengajuan_disposisi_pembimbing,
  ADD COLUMN outline_id BIGINT UNSIGNED NULL AFTER id;

-- Back-fill outline_id from the linked pengajuan_disposisi_pembimbing row
UPDATE pengajuan_sk_penelitian sk
  JOIN pengajuan_disposisi_pembimbing pj ON pj.id = sk.pengajuan_disposisi_pembimbing_id
  SET sk.outline_id = pj.outline_id;

-- Now enforce NOT NULL + unique FK
ALTER TABLE pengajuan_sk_penelitian
  MODIFY COLUMN outline_id BIGINT UNSIGNED NOT NULL,
  ADD UNIQUE KEY uq_sk_outline_id (outline_id),
  ADD CONSTRAINT fk_sk_outline FOREIGN KEY (outline_id)
    REFERENCES outline (id) ON DELETE RESTRICT ON UPDATE CASCADE;

SET FOREIGN_KEY_CHECKS = 1;
