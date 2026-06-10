-- Re-anchor kartu_konsultasi_outline and konsultasi_outline_stage from
-- pengajuan_disposisi_pembimbing_id to outline_id.
-- Also adds approved pembimbing fields to outline so downstream tables
-- can source all data from outline directly.

SET FOREIGN_KEY_CHECKS = 0;

-- 1. Add approved-state fields to outline
ALTER TABLE outline
  ADD COLUMN pembimbing1_nidn  VARCHAR(20)  NULL AFTER program_studi_id,
  ADD COLUMN pembimbing1_nama  VARCHAR(255) NULL AFTER pembimbing1_nidn,
  ADD COLUMN pembimbing2_nidn  VARCHAR(20)  NULL AFTER pembimbing1_nama,
  ADD COLUMN pembimbing2_nama  VARCHAR(255) NULL AFTER pembimbing2_nidn,
  ADD COLUMN judul_final       VARCHAR(500) NULL AFTER pembimbing2_nama,
  ADD COLUMN approved_at       DATETIME     NULL AFTER judul_final;

-- 2. Swap anchor FK on kartu_konsultasi_outline:
--    drop pengajuan_disposisi_pembimbing_id unique FK, add outline_id unique FK.
--    Keep pengajuan_disposisi_pembimbing_id as a plain non-unique column so that
--    autoGenerateHalamanPersetujuan and autoSubmitSkPenelitian can still reference it.
ALTER TABLE kartu_konsultasi_outline
  DROP FOREIGN KEY fk_kartu_pengajuan_disposisi_pembimbing_id,
  DROP INDEX       uq_kartu_pengajuan_disposisi_pembimbing_id,
  ADD COLUMN outline_id BIGINT UNSIGNED NOT NULL DEFAULT 0 AFTER id,
  ADD UNIQUE KEY uq_kartu_outline_id (outline_id),
  ADD CONSTRAINT fk_kartu_outline FOREIGN KEY (outline_id)
    REFERENCES outline (id) ON DELETE RESTRICT ON UPDATE CASCADE;

-- 3. Swap anchor on konsultasi_outline_stage:
--    drop pengajuan_disposisi_pembimbing_id, add outline_id plain FK.
ALTER TABLE konsultasi_outline_stage
  DROP COLUMN pengajuan_disposisi_pembimbing_id,
  ADD COLUMN outline_id BIGINT UNSIGNED NOT NULL DEFAULT 0 AFTER kartu_konsultasi_outline_id,
  ADD CONSTRAINT fk_stage_outline FOREIGN KEY (outline_id)
    REFERENCES outline (id) ON DELETE RESTRICT ON UPDATE CASCADE;

SET FOREIGN_KEY_CHECKS = 1;
