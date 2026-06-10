-- Re-anchor kartu_konsultasi_skripsi and konsultasi_skripsi_stage
-- from pengajuan_disposisi_pembimbing_id to skripsi_id.

SET FOREIGN_KEY_CHECKS = 0;

-- kartu_konsultasi_skripsi: three-step
ALTER TABLE kartu_konsultasi_skripsi
  DROP INDEX uq_kartu_skripsi_pengajuan_disposisi_pembimbing_id,
  ADD COLUMN skripsi_id BIGINT UNSIGNED NULL AFTER id;

UPDATE kartu_konsultasi_skripsi k
  JOIN pengajuan_disposisi_pembimbing pj ON pj.id = k.pengajuan_disposisi_pembimbing_id
  JOIN skripsi s ON s.outline_id = pj.outline_id
  SET k.skripsi_id = s.id;

ALTER TABLE kartu_konsultasi_skripsi
  MODIFY COLUMN skripsi_id BIGINT UNSIGNED NOT NULL,
  ADD UNIQUE KEY uq_kartu_skripsi_id (skripsi_id),
  ADD CONSTRAINT fk_kartu_skripsi FOREIGN KEY (skripsi_id)
    REFERENCES skripsi (id) ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE kartu_konsultasi_skripsi
  DROP COLUMN pengajuan_disposisi_pembimbing_id;

-- konsultasi_skripsi_stage: back-fill via kartu, then swap column
ALTER TABLE konsultasi_skripsi_stage
  DROP INDEX idx_pengajuan_judul_id,
  ADD COLUMN skripsi_id BIGINT UNSIGNED NULL AFTER kartu_konsultasi_skripsi_id;

UPDATE konsultasi_skripsi_stage st
  JOIN kartu_konsultasi_skripsi k ON k.id = st.kartu_konsultasi_skripsi_id
  SET st.skripsi_id = k.skripsi_id;

ALTER TABLE konsultasi_skripsi_stage
  MODIFY COLUMN skripsi_id BIGINT UNSIGNED NOT NULL,
  ADD KEY idx_skripsi_id (skripsi_id),
  ADD CONSTRAINT fk_stage_skripsi FOREIGN KEY (skripsi_id)
    REFERENCES skripsi (id) ON DELETE CASCADE;

ALTER TABLE konsultasi_skripsi_stage
  DROP COLUMN pengajuan_disposisi_pembimbing_id;

SET FOREIGN_KEY_CHECKS = 1;
