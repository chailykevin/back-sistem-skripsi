-- Re-anchor halaman_persetujuan_judul from pengajuan_disposisi_pembimbing_id to outline_id.
-- pengajuan_disposisi_pembimbing_id kept as plain non-unique column —
-- autoSubmitSkPenelitian still needs it until SK Penelitian is re-anchored.

SET FOREIGN_KEY_CHECKS = 0;

-- Add column first (nullable so existing rows don't fail)
ALTER TABLE halaman_persetujuan_judul
  DROP FOREIGN KEY fk_halaman_pengajuan_disposisi_pembimbing,
  DROP INDEX       uq_halaman_pengajuan_disposisi_pembimbing,
  ADD COLUMN outline_id BIGINT UNSIGNED NULL AFTER id;

-- Back-fill outline_id from the linked pengajuan_disposisi_pembimbing row
UPDATE halaman_persetujuan_judul h
  JOIN pengajuan_disposisi_pembimbing pj ON pj.id = h.pengajuan_disposisi_pembimbing_id
  SET h.outline_id = pj.outline_id;

-- Now enforce NOT NULL + unique FK
ALTER TABLE halaman_persetujuan_judul
  MODIFY COLUMN outline_id BIGINT UNSIGNED NOT NULL,
  ADD UNIQUE KEY uq_halaman_outline_id (outline_id),
  ADD CONSTRAINT fk_halaman_outline FOREIGN KEY (outline_id)
    REFERENCES outline (id) ON DELETE RESTRICT ON UPDATE CASCADE;

SET FOREIGN_KEY_CHECKS = 1;
