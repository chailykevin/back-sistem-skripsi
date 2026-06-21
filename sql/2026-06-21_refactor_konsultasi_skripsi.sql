-- 1. Drop skripsi_id from konsultasi_skripsi_stage
--    FK name: fk_stage_skripsi, index name: idx_skripsi_id
--    (added by 2026-06-10_reanchor_konsultasi_skripsi.sql)
ALTER TABLE konsultasi_skripsi_stage
  DROP FOREIGN KEY fk_stage_skripsi,
  DROP INDEX idx_skripsi_id,
  DROP COLUMN skripsi_id;

-- 2. Merge kartu_konsultasi_skripsi_file into kartu_konsultasi_skripsi
ALTER TABLE kartu_konsultasi_skripsi
  ADD COLUMN docx_content         LONGTEXT NULL,
  ADD COLUMN docx_file_name       VARCHAR(255) NULL,
  ADD COLUMN docx_mime_type       VARCHAR(100) NULL,
  ADD COLUMN pdf_content          LONGTEXT NULL,
  ADD COLUMN pdf_file_name        VARCHAR(255) NULL,
  ADD COLUMN pdf_mime_type        VARCHAR(100) NULL,
  ADD COLUMN generated_by_user_id BIGINT UNSIGNED NULL,
  ADD COLUMN generated_at         DATETIME NULL;

DROP TABLE kartu_konsultasi_skripsi_file;

-- 3. Drop log table
DROP TABLE kartu_konsultasi_skripsi_log;

-- 4. Add missing timestamps
ALTER TABLE konsultasi_skripsi_submission
  ADD COLUMN created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  ADD COLUMN updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP;

ALTER TABLE konsultasi_skripsi_review_file
  ADD COLUMN updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP;
