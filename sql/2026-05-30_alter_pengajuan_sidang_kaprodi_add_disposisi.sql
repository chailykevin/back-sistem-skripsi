ALTER TABLE pengajuan_sidang_kaprodi
  ADD COLUMN tanggal_sidang DATE NULL AFTER penguji2_nidn,
  ADD COLUMN waktu_sidang TIME NULL AFTER tanggal_sidang,
  ADD COLUMN tempat_sidang VARCHAR(255) NULL AFTER waktu_sidang,
  ADD COLUMN tanggal_disposisi DATE NULL AFTER tempat_sidang,
  ADD COLUMN disposisi_submitted_at DATETIME NULL AFTER tanggal_disposisi,
  MODIFY COLUMN status ENUM('DRAFT','SUBMITTED','NEED_REVISION','VALID','REJECTED','DISPOSISI_SENT') NOT NULL DEFAULT 'DRAFT';
