-- Sekretariat can only verify an SK Penulisan or return it for revision (decided 2026-11-12);
-- REJECTED is dropped from the status ENUM. A rejected SK left the student with an ACCEPTED outline
-- they could neither restart nor submit again.
--
-- Stops with an error if any SK is still REJECTED: decide what to do with those rows first. To see them:
--   SELECT id, outline_id, catatan_sekretariat FROM pengajuan_sk_penelitian WHERE status = 'REJECTED';
-- Run with the mysql client (or a tool that understands DELIMITER).

DROP PROCEDURE IF EXISTS tmp_assert_no_rejected_sk_penelitian;

DELIMITER //
CREATE PROCEDURE tmp_assert_no_rejected_sk_penelitian()
BEGIN
  IF EXISTS (SELECT 1 FROM pengajuan_sk_penelitian WHERE status = 'REJECTED') THEN
    SIGNAL SQLSTATE '45000'
      SET MESSAGE_TEXT = 'pengajuan_sk_penelitian still has REJECTED rows; resolve them before dropping the value';
  END IF;
END //
DELIMITER ;

CALL tmp_assert_no_rejected_sk_penelitian();
DROP PROCEDURE tmp_assert_no_rejected_sk_penelitian;

ALTER TABLE pengajuan_sk_penelitian
  MODIFY COLUMN status ENUM('DRAFT','SUBMITTED','VERIFIED','COMPLETED','NEED_REVISION')
    CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT 'DRAFT';
