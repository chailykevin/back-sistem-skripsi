-- Run these checks first; each must return 0 rows, otherwise clean the data before applying the rest.
-- SELECT pengajuan_sidang_id, file_type, COUNT(*) FROM pengajuan_sidang_files GROUP BY pengajuan_sidang_id, file_type HAVING COUNT(*) > 1;
-- SELECT id FROM pengajuan_sidang_files WHERE file_type IS NULL;
-- SELECT sidang_id, COUNT(*) FROM revisi_pasca_sidang GROUP BY sidang_id HAVING COUNT(*) > 1;
-- SELECT pengajuan_sidang_id, COUNT(*) FROM sidang GROUP BY pengajuan_sidang_id HAVING COUNT(*) > 1;

ALTER TABLE pengajuan_sidang_files MODIFY COLUMN file_type enum(
  'BERKAS_SKRIPSI','SURAT_SURVEI','SURAT_KETERANGAN','JURNAL','SURAT_PERNYATAAN_TIDAK_PLAGIAT',
  'LEMBAR_USULAN_PENGUJI','LEMBAR_PERMOHONAN_UJIAN','PAS_FOTO','KTM','BUKTI_PEMBAYARAN',
  'LEMBAR_KONSULTASI_JURNAL','KARTU_KONSULTASI_SKRIPSI','SK_PENUNJUKAN_PEMBIMBING','REKAP_NILAI',
  'SURAT_PERNYATAAN_PENYELESAIAN','SURAT_PERNYATAAN_PERBAIKAN','SURAT_PERNYATAAN_KELENGKAPAN',
  'FOTOCOPY_KONVERSI','BUKTI_HADIR_SIDANG','KARTU_KONSULTASI_PA','KARTU_PRAKTIKUM',
  'SERTIFIKAT_POINT','SURAT_UNDANGAN_SIDANG'
) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL,
  ADD UNIQUE KEY uq_pengajuan_sidang_files_type (pengajuan_sidang_id, file_type);

ALTER TABLE revisi_pasca_sidang ADD UNIQUE KEY uq_revisi_pasca_sidang_sidang_id (sidang_id);

ALTER TABLE sidang ADD UNIQUE KEY uq_sidang_pengajuan_sidang_id (pengajuan_sidang_id);

DELETE t FROM password_reset_tokens t
LEFT JOIN users u ON u.id = t.user_id
WHERE u.id IS NULL;

ALTER TABLE password_reset_tokens
  MODIFY COLUMN user_id bigint unsigned NOT NULL,
  ADD CONSTRAINT fk_password_reset_tokens_user FOREIGN KEY (user_id)
    REFERENCES users (id) ON DELETE CASCADE ON UPDATE CASCADE;

DELETE t FROM mahasiswa_email_verification_tokens t
LEFT JOIN mahasiswa m ON m.npm = t.npm
WHERE m.npm IS NULL;

ALTER TABLE mahasiswa_email_verification_tokens
  MODIFY COLUMN npm varchar(30) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL,
  ADD CONSTRAINT fk_mahasiswa_email_verification_tokens_npm FOREIGN KEY (npm)
    REFERENCES mahasiswa (npm) ON DELETE CASCADE ON UPDATE CASCADE;

-- fk_skripsi_npm blocks altering the column while checks are on; widening varchar keeps it valid.
SET FOREIGN_KEY_CHECKS = 0;
ALTER TABLE skripsi MODIFY COLUMN npm varchar(30) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL;
SET FOREIGN_KEY_CHECKS = 1;

ALTER TABLE pengajuan_disposisi_pembimbing DROP INDEX idx_pengajuan_outline_npm;
ALTER TABLE konsultasi_outline_review_file DROP INDEX idx_konsultasi_review_file_review_id;
ALTER TABLE konsultasi_skripsi_review DROP INDEX idx_stage_id;
ALTER TABLE konsultasi_skripsi_submission DROP INDEX idx_stage_id;

ALTER TABLE usulan_perubahan_judul CONVERT TO CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

ALTER TABLE mahasiswa MODIFY COLUMN ipk decimal(3,2) DEFAULT NULL;
