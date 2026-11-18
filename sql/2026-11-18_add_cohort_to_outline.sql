-- Cohort ("angkatan") of an outline: the academic term the student started their thesis in.
-- Set once at outline creation from SIMIKO's active period (widya_miko.r_akademik.akdAktif = 1)
-- and never changed. The Kaprodi dashboard and reports group a student's whole journey by it,
-- because outline.submission_period_id is only set when an SK window happens to be open
-- (outline submission is no longer period-gated since 2026-11-11).

ALTER TABLE outline
  ADD COLUMN cohort_tahun_akademik VARCHAR(9) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NULL AFTER submission_period_id,
  ADD COLUMN cohort_periode_akademik ENUM('GANJIL', 'GENAP') CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NULL AFTER cohort_tahun_akademik,
  ADD INDEX idx_outline_cohort (program_studi_id, cohort_tahun_akademik, cohort_periode_akademik);

-- Backfill: the period tag when the outline has one (outlines created before 2026-11-11 always
-- did), otherwise the calendar term of created_at in WIB (Aug–Jan = Ganjil, Feb–Jul = Genap).
UPDATE outline o
LEFT JOIN outline_submission_period osp ON osp.id = o.submission_period_id
SET
  o.cohort_tahun_akademik = COALESCE(
    CONVERT(osp.tahun_akademik USING utf8mb4) COLLATE utf8mb4_unicode_ci,
    CASE
      WHEN MONTH(DATE_ADD(o.created_at, INTERVAL 7 HOUR)) >= 8
        THEN CONCAT(YEAR(DATE_ADD(o.created_at, INTERVAL 7 HOUR)), '/', YEAR(DATE_ADD(o.created_at, INTERVAL 7 HOUR)) + 1)
      ELSE CONCAT(YEAR(DATE_ADD(o.created_at, INTERVAL 7 HOUR)) - 1, '/', YEAR(DATE_ADD(o.created_at, INTERVAL 7 HOUR)))
    END
  ),
  o.cohort_periode_akademik = COALESCE(
    CONVERT(osp.periode_akademik USING utf8mb4) COLLATE utf8mb4_unicode_ci,
    CASE
      WHEN MONTH(DATE_ADD(o.created_at, INTERVAL 7 HOUR)) BETWEEN 2 AND 7 THEN 'GENAP'
      ELSE 'GANJIL'
    END
  )
WHERE o.cohort_tahun_akademik IS NULL;
