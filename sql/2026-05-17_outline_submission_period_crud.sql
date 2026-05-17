-- Migration: Convert outline_submission_period from singleton to multi-row CRUD table.
-- Adds tahun_akademik, periode_akademik columns and links outline to its submission period.

-- 1. Add new columns to outline_submission_period
ALTER TABLE outline_submission_period
  ADD COLUMN tahun_akademik VARCHAR(9) NOT NULL DEFAULT '' AFTER id,
  ADD COLUMN periode_akademik ENUM('GANJIL', 'GENAP') NOT NULL DEFAULT 'GANJIL' AFTER tahun_akademik;

-- 2. Change id from tinyint (singleton-enforced) to bigint AUTO_INCREMENT
ALTER TABLE outline_submission_period
  MODIFY COLUMN id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT;

-- 3. Remove the DEFAULT '' and DEFAULT 'GANJIL' now that existing rows are backfilled
ALTER TABLE outline_submission_period
  ALTER COLUMN tahun_akademik DROP DEFAULT,
  ALTER COLUMN periode_akademik DROP DEFAULT;

-- 4. Add submission_period_id FK column to outline
ALTER TABLE outline
  ADD COLUMN submission_period_id BIGINT UNSIGNED NULL AFTER program_studi_id,
  ADD CONSTRAINT fk_outline_submission_period
    FOREIGN KEY (submission_period_id) REFERENCES outline_submission_period(id)
    ON DELETE SET NULL;
