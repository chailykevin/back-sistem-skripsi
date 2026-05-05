-- Migration: 2026-05-05_replace_is_verified_with_status_sk_files.sql
-- Replaces is_verified column with status enum on pengajuan_sk_penelitian_files
-- sekretariat_note lives on pengajuan_sk_penelitian (catatan_sekretariat already exists there)

ALTER TABLE `pengajuan_sk_penelitian_files`
  DROP COLUMN `is_verified`,
  ADD COLUMN `status` ENUM('SUBMITTED','NEED_REUPLOAD','VERIFIED') NOT NULL DEFAULT 'SUBMITTED' AFTER `source`;
