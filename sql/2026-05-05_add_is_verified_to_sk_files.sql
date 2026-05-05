-- Migration: 2026-05-05_add_is_verified_to_sk_files.sql
-- Adds is_verified column to pengajuan_sk_penelitian_files

ALTER TABLE `pengajuan_sk_penelitian_files`
  ADD COLUMN `is_verified` TINYINT(1) NOT NULL DEFAULT 0 AFTER `source`;
