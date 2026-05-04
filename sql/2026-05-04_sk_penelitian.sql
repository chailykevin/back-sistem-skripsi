-- ============================================================
-- Migration: 2026-05-04_sk_penelitian.sql
-- Creates 5 new tables for Halaman Persetujuan and SK Penelitian
-- ============================================================

-- Table 1: halaman_persetujuan_judul
CREATE TABLE IF NOT EXISTS `halaman_persetujuan_judul` (
  `id`                 bigint unsigned NOT NULL AUTO_INCREMENT,
  `pengajuan_judul_id` bigint unsigned NOT NULL,
  `status`             ENUM('PENDING','COMPLETED') NOT NULL DEFAULT 'PENDING',
  `created_at`         timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at`         timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_halaman_pengajuan_judul` (`pengajuan_judul_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

-- Table 2: halaman_persetujuan_judul_signatures
CREATE TABLE IF NOT EXISTS `halaman_persetujuan_judul_signatures` (
  `id`                           bigint unsigned NOT NULL AUTO_INCREMENT,
  `halaman_persetujuan_judul_id` bigint unsigned NOT NULL,
  `signer_role`                  ENUM('MAHASISWA','PEMBIMBING_2','PEMBIMBING_1','KAPRODI') NOT NULL,
  `signature_image`              LONGTEXT,
  `signed_at`                    datetime DEFAULT NULL,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_halaman_signer` (`halaman_persetujuan_judul_id`, `signer_role`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

-- Table 3: halaman_persetujuan_judul_file
CREATE TABLE IF NOT EXISTS `halaman_persetujuan_judul_file` (
  `id`                           bigint unsigned NOT NULL AUTO_INCREMENT,
  `halaman_persetujuan_judul_id` bigint unsigned NOT NULL,
  `file_name`                    varchar(255) NOT NULL,
  `mime_type`                    varchar(100) NOT NULL,
  `file_content`                 LONGTEXT NOT NULL,
  `generated_by_user_id`         bigint unsigned DEFAULT NULL,
  `generated_at`                 timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `idx_halaman_file_header` (`halaman_persetujuan_judul_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

-- Table 4: pengajuan_sk_penelitian
CREATE TABLE IF NOT EXISTS `pengajuan_sk_penelitian` (
  `id`                  bigint unsigned NOT NULL AUTO_INCREMENT,
  `pengajuan_judul_id`  bigint unsigned NOT NULL,
  `status`              ENUM('DRAFT','SUBMITTED','VERIFIED','REJECTED','COMPLETED') NOT NULL DEFAULT 'DRAFT',
  `catatan_sekretariat` TEXT DEFAULT NULL,
  `verified_by_user_id` bigint unsigned DEFAULT NULL,
  `submitted_at`        datetime DEFAULT NULL,
  `verified_at`         datetime DEFAULT NULL,
  `completed_at`        datetime DEFAULT NULL,
  `created_at`          timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at`          timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_sk_pengajuan_judul` (`pengajuan_judul_id`),
  KEY `idx_sk_status` (`status`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

-- Table 5: pengajuan_sk_penelitian_files
CREATE TABLE IF NOT EXISTS `pengajuan_sk_penelitian_files` (
  `id`                         bigint unsigned NOT NULL AUTO_INCREMENT,
  `pengajuan_sk_penelitian_id` bigint unsigned NOT NULL,
  `file_type`                  ENUM('KRS','REKAP_NILAI','KARTU_KONSULTASI_OUTLINE','FILE_OUTLINE','HALAMAN_PERSETUJUAN','SK_PENELITIAN') NOT NULL,
  `file_name`                  varchar(255) NOT NULL,
  `mime_type`                  varchar(100) DEFAULT NULL,
  `file_content`               LONGTEXT NOT NULL,
  `source`                     ENUM('UPLOADED','GENERATED','SYSTEM') NOT NULL DEFAULT 'UPLOADED',
  `created_at`                 timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `idx_sk_files_sk_id` (`pengajuan_sk_penelitian_id`),
  KEY `idx_sk_files_type` (`file_type`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
