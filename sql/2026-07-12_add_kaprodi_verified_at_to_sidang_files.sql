ALTER TABLE pengajuan_sidang_files
  ADD COLUMN kaprodi_verified_at DATETIME NULL DEFAULT NULL
  AFTER kaprodi_status;
