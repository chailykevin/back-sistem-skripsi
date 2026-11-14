-- Kaprodi and Sekretariat can only approve a Pengajuan Sidang / Seminar Proposal or return it for
-- revision (decided 2026-11-12); REJECTED is dropped from both status ENUMs. A rejected Kaprodi form
-- could neither be edited nor resubmitted, and a rejected pengajuan had no way forward on the
-- student's page.
--
-- Existing REJECTED rows become NEED_REVISION, which lets the student fix and resubmit them (the
-- catatan stays). A REJECTED pengajuan_sidang that a newer pengajuan of the same skripsi and jenis has
-- already replaced can't be reopened; the script stops if one exists. To see them:
--   SELECT o.id, o.skripsi_id, o.jenis FROM pengajuan_sidang o
--   WHERE o.status = 'REJECTED' AND EXISTS (SELECT 1 FROM pengajuan_sidang n
--     WHERE n.skripsi_id = o.skripsi_id AND n.jenis = o.jenis AND n.id > o.id);
-- Run with the mysql client (or a tool that understands DELIMITER).

UPDATE pengajuan_sidang_kaprodi
SET status = 'NEED_REVISION', updated_at = CURRENT_TIMESTAMP
WHERE status = 'REJECTED';

UPDATE pengajuan_sidang ps
SET ps.status = 'NEED_REVISION',
    ps.verified_by_user_id = NULL,
    ps.verified_at = NULL,
    ps.updated_at = CURRENT_TIMESTAMP
WHERE ps.status = 'REJECTED'
  AND ps.id NOT IN (
    SELECT id FROM (
      SELECT o.id FROM pengajuan_sidang o
      JOIN pengajuan_sidang n ON n.skripsi_id = o.skripsi_id AND n.jenis = o.jenis AND n.id > o.id
      WHERE o.status = 'REJECTED'
    ) superseded
  );

DROP PROCEDURE IF EXISTS tmp_assert_no_rejected_pengajuan_sidang;

DELIMITER //
CREATE PROCEDURE tmp_assert_no_rejected_pengajuan_sidang()
BEGIN
  IF EXISTS (SELECT 1 FROM pengajuan_sidang WHERE status = 'REJECTED') THEN
    SIGNAL SQLSTATE '45000'
      SET MESSAGE_TEXT = 'pengajuan_sidang still has REJECTED rows replaced by a newer pengajuan; resolve them before dropping the value';
  END IF;
END //
DELIMITER ;

CALL tmp_assert_no_rejected_pengajuan_sidang();
DROP PROCEDURE tmp_assert_no_rejected_pengajuan_sidang;

-- VERIFIED stays in pengajuan_sidang for older rows (never set any more).
ALTER TABLE pengajuan_sidang
  MODIFY COLUMN status ENUM('DRAFT','SUBMITTED','NEED_REVISION','VERIFIED','WAITING_FOR_DISPOSISI','WAITING_FOR_SURAT','COMPLETED')
    CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT 'DRAFT';

ALTER TABLE pengajuan_sidang_kaprodi
  MODIFY COLUMN status ENUM('DRAFT','SUBMITTED','NEED_REVISION','VALID','DISPOSISI_SENT','COMPLETED')
    CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT 'DRAFT';
