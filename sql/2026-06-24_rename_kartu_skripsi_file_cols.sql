ALTER TABLE kartu_konsultasi_skripsi
  DROP COLUMN pdf_content,
  DROP COLUMN pdf_file_name,
  DROP COLUMN pdf_mime_type,
  CHANGE COLUMN docx_content   file_content  LONGTEXT NULL,
  CHANGE COLUMN docx_file_name file_name     VARCHAR(255) NULL,
  CHANGE COLUMN docx_mime_type mime_type     VARCHAR(100) NULL;
