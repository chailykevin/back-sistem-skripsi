ALTER TABLE kartu_konsultasi_skripsi
  DROP INDEX idx_npm,
  DROP INDEX idx_program_studi_id,
  DROP COLUMN npm,
  DROP COLUMN program_studi_id,
  DROP COLUMN pembimbing1_nidn,
  DROP COLUMN pembimbing2_nidn;
