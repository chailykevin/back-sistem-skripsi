-- Migration: 2026-05-05_add_need_revision_status_sk_penelitian.sql
-- Adds NEED_REVISION to pengajuan_sk_penelitian.status enum

ALTER TABLE `pengajuan_sk_penelitian`
  MODIFY COLUMN `status` ENUM('DRAFT','SUBMITTED','VERIFIED','REJECTED','COMPLETED','NEED_REVISION') NOT NULL DEFAULT 'DRAFT';
