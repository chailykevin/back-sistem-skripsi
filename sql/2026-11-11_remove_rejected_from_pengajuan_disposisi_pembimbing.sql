-- Kaprodi can only approve a disposisi or ask for a revision (decided 2026-11-11); REJECTED is
-- dropped from the status ENUM. Any legacy REJECTED row is turned into NEED_REVISION first,
-- keeping its catatan_kaprodi, so the student can still resubmit it.

UPDATE pengajuan_disposisi_pembimbing
SET status = 'NEED_REVISION'
WHERE status = 'REJECTED';

ALTER TABLE pengajuan_disposisi_pembimbing
  MODIFY COLUMN status ENUM('SUBMITTED','NEED_REVISION','APPROVED')
    CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT 'SUBMITTED';
