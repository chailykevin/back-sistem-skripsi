ALTER TABLE kartu_konsultasi_outline
  ADD COLUMN file_content         LONGTEXT NULL,
  ADD COLUMN file_name            VARCHAR(255) NULL,
  ADD COLUMN mime_type            VARCHAR(100) NULL,
  ADD COLUMN generated_by_user_id BIGINT UNSIGNED NULL,
  ADD COLUMN generated_at         DATETIME NULL;

UPDATE kartu_konsultasi_outline k
JOIN kartu_konsultasi_outline_file f
  ON f.kartu_konsultasi_outline_id = k.id
  AND f.is_active = 1
  AND f.file_type = 'FINAL_DOCX'
SET
  k.file_content         = f.file_content,
  k.file_name            = f.file_name,
  k.mime_type            = f.mime_type,
  k.generated_by_user_id = f.generated_by_user_id,
  k.generated_at         = f.generated_at;

DROP TABLE kartu_konsultasi_outline_file;
