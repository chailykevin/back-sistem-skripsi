-- Rename pengajuan_judul → pengajuan_disposisi_pembimbing
-- Also renames child tables and all FK columns across downstream tables.

SET FOREIGN_KEY_CHECKS = 0;

-- 1. Rename main table and child tables
RENAME TABLE pengajuan_judul TO pengajuan_disposisi_pembimbing;
RENAME TABLE pengajuan_judul_file TO pengajuan_disposisi_pembimbing_file;
RENAME TABLE pengajuan_judul_syarat TO pengajuan_disposisi_pembimbing_syarat;

-- 2. Rename FK column + indexes on pengajuan_disposisi_pembimbing_file
ALTER TABLE pengajuan_disposisi_pembimbing_file
  DROP FOREIGN KEY fk_pj_file_pengajuan,
  DROP INDEX uq_pj_file_pengajuan_type,
  DROP INDEX idx_pj_file_pengajuan,
  DROP INDEX idx_pj_file_type,
  RENAME COLUMN pengajuan_judul_id TO pengajuan_disposisi_pembimbing_id,
  ADD UNIQUE KEY uq_pdp_file_pengajuan_type (pengajuan_disposisi_pembimbing_id, file_type),
  ADD KEY idx_pdp_file_pengajuan (pengajuan_disposisi_pembimbing_id),
  ADD KEY idx_pdp_file_type (file_type),
  ADD CONSTRAINT fk_pdp_file_pengajuan FOREIGN KEY (pengajuan_disposisi_pembimbing_id)
    REFERENCES pengajuan_disposisi_pembimbing (id) ON DELETE CASCADE ON UPDATE CASCADE;

-- 3. Rename FK column on pengajuan_disposisi_pembimbing_syarat
ALTER TABLE pengajuan_disposisi_pembimbing_syarat
  DROP FOREIGN KEY fk_pj_syarat_pengajuan,
  RENAME COLUMN pengajuan_judul_id TO pengajuan_disposisi_pembimbing_id,
  ADD CONSTRAINT fk_pdp_syarat_pengajuan FOREIGN KEY (pengajuan_disposisi_pembimbing_id)
    REFERENCES pengajuan_disposisi_pembimbing (id) ON DELETE CASCADE ON UPDATE CASCADE;

-- 4. kartu_konsultasi_outline
ALTER TABLE kartu_konsultasi_outline
  DROP FOREIGN KEY fk_kartu_pengajuan_judul_id,
  DROP INDEX uq_kartu_pengajuan_judul_id,
  RENAME COLUMN pengajuan_judul_id TO pengajuan_disposisi_pembimbing_id,
  ADD UNIQUE KEY uq_kartu_pengajuan_disposisi_pembimbing_id (pengajuan_disposisi_pembimbing_id),
  ADD CONSTRAINT fk_kartu_pengajuan_disposisi_pembimbing_id FOREIGN KEY (pengajuan_disposisi_pembimbing_id)
    REFERENCES pengajuan_disposisi_pembimbing (id) ON DELETE RESTRICT ON UPDATE CASCADE;

-- 5. konsultasi_outline_stage
ALTER TABLE konsultasi_outline_stage
  DROP FOREIGN KEY fk_konsultasi_stage_pengajuan_judul_id,
  DROP INDEX uq_konsultasi_stage_pengajuan_stage,
  RENAME COLUMN pengajuan_judul_id TO pengajuan_disposisi_pembimbing_id,
  ADD UNIQUE KEY uq_konsultasi_stage_pengajuan_disposisi_stage (pengajuan_disposisi_pembimbing_id, stage),
  ADD CONSTRAINT fk_konsultasi_stage_pengajuan_disposisi_pembimbing_id FOREIGN KEY (pengajuan_disposisi_pembimbing_id)
    REFERENCES pengajuan_disposisi_pembimbing (id) ON DELETE RESTRICT ON UPDATE CASCADE;

-- 6. halaman_persetujuan_judul
ALTER TABLE halaman_persetujuan_judul
  DROP FOREIGN KEY halaman_persetujuan_judul_ibfk_1,
  DROP INDEX uq_halaman_pengajuan_judul,
  RENAME COLUMN pengajuan_judul_id TO pengajuan_disposisi_pembimbing_id,
  ADD UNIQUE KEY uq_halaman_pengajuan_disposisi_pembimbing (pengajuan_disposisi_pembimbing_id),
  ADD CONSTRAINT fk_halaman_pengajuan_disposisi_pembimbing FOREIGN KEY (pengajuan_disposisi_pembimbing_id)
    REFERENCES pengajuan_disposisi_pembimbing (id);

-- 7. pengajuan_sk_penelitian
ALTER TABLE pengajuan_sk_penelitian
  DROP INDEX uq_sk_pengajuan_judul,
  RENAME COLUMN pengajuan_judul_id TO pengajuan_disposisi_pembimbing_id,
  ADD UNIQUE KEY uq_sk_pengajuan_disposisi_pembimbing (pengajuan_disposisi_pembimbing_id);

-- 8. kartu_konsultasi_skripsi
ALTER TABLE kartu_konsultasi_skripsi
  DROP INDEX uq_pengajuan_judul_id,
  RENAME COLUMN pengajuan_judul_id TO pengajuan_disposisi_pembimbing_id,
  ADD UNIQUE KEY uq_kartu_skripsi_pengajuan_disposisi_pembimbing_id (pengajuan_disposisi_pembimbing_id);

-- 9. konsultasi_skripsi_stage
ALTER TABLE konsultasi_skripsi_stage
  RENAME COLUMN pengajuan_judul_id TO pengajuan_disposisi_pembimbing_id;

-- 10. skripsi
ALTER TABLE skripsi
  DROP INDEX uq_pengajuan_judul_id,
  RENAME COLUMN pengajuan_judul_id TO pengajuan_disposisi_pembimbing_id,
  ADD UNIQUE KEY uq_skripsi_pengajuan_disposisi_pembimbing_id (pengajuan_disposisi_pembimbing_id);

-- 11. pengajuan_sidang
ALTER TABLE pengajuan_sidang
  DROP FOREIGN KEY pengajuan_sidang_ibfk_1,
  DROP KEY pengajuan_judul_id,
  RENAME COLUMN pengajuan_judul_id TO pengajuan_disposisi_pembimbing_id,
  ADD KEY idx_ps_pengajuan_disposisi_pembimbing_id (pengajuan_disposisi_pembimbing_id),
  ADD CONSTRAINT fk_ps_pengajuan_disposisi_pembimbing FOREIGN KEY (pengajuan_disposisi_pembimbing_id)
    REFERENCES pengajuan_disposisi_pembimbing (id);

-- 12. pengajuan_sidang_kaprodi
ALTER TABLE pengajuan_sidang_kaprodi
  DROP FOREIGN KEY fk_psk_pengajuan_judul,
  DROP KEY fk_psk_pengajuan_judul,
  RENAME COLUMN pengajuan_judul_id TO pengajuan_disposisi_pembimbing_id,
  ADD KEY fk_psk_pengajuan_disposisi_pembimbing (pengajuan_disposisi_pembimbing_id),
  ADD CONSTRAINT fk_psk_pengajuan_disposisi_pembimbing FOREIGN KEY (pengajuan_disposisi_pembimbing_id)
    REFERENCES pengajuan_disposisi_pembimbing (id);

-- 13. sidang
ALTER TABLE sidang
  DROP INDEX uq_pengajuan_judul,
  RENAME COLUMN pengajuan_judul_id TO pengajuan_disposisi_pembimbing_id,
  ADD UNIQUE KEY uq_sidang_pengajuan_disposisi_pembimbing (pengajuan_disposisi_pembimbing_id);

-- 14. revisi_pasca_sidang
ALTER TABLE revisi_pasca_sidang
  DROP FOREIGN KEY revisi_pasca_sidang_ibfk_2,
  DROP INDEX uk_pengajuan_judul,
  RENAME COLUMN pengajuan_judul_id TO pengajuan_disposisi_pembimbing_id,
  ADD UNIQUE KEY uk_revisi_pengajuan_disposisi_pembimbing (pengajuan_disposisi_pembimbing_id),
  ADD CONSTRAINT fk_revisi_pengajuan_disposisi_pembimbing FOREIGN KEY (pengajuan_disposisi_pembimbing_id)
    REFERENCES pengajuan_disposisi_pembimbing (id);

-- 15. pengumpulan_berkas_final
ALTER TABLE pengumpulan_berkas_final
  DROP FOREIGN KEY pengumpulan_berkas_final_ibfk_1,
  DROP INDEX uq_pengajuan_judul,
  RENAME COLUMN pengajuan_judul_id TO pengajuan_disposisi_pembimbing_id,
  ADD UNIQUE KEY uq_pengumpulan_pengajuan_disposisi_pembimbing (pengajuan_disposisi_pembimbing_id),
  ADD CONSTRAINT fk_pengumpulan_pengajuan_disposisi_pembimbing FOREIGN KEY (pengajuan_disposisi_pembimbing_id)
    REFERENCES pengajuan_disposisi_pembimbing (id);

SET FOREIGN_KEY_CHECKS = 1;
