ALTER TABLE pengajuan_sidang_kaprodi
  ADD COLUMN status_pernikahan ENUM('Belum Menikah', 'Sudah Menikah') NULL
  AFTER no_wa;
