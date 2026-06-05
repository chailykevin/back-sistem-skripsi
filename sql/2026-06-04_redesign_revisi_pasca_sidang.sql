-- Drop original tables if they exist (from 2026-06-04_create_revisi_pasca_sidang.sql)
DROP TABLE IF EXISTS revisi_pasca_sidang_signatures;
DROP TABLE IF EXISTS revisi_pasca_sidang_submissions;
DROP TABLE IF EXISTS revisi_pasca_sidang_files;
DROP TABLE IF EXISTS revisi_pasca_sidang;

CREATE TABLE revisi_pasca_sidang (
  id BIGINT UNSIGNED PRIMARY KEY AUTO_INCREMENT,
  sidang_id BIGINT UNSIGNED NOT NULL,
  pengajuan_judul_id BIGINT UNSIGNED NOT NULL,
  npm VARCHAR(20) NOT NULL,
  is_completed TINYINT(1) NOT NULL DEFAULT 0,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uk_pengajuan_judul (pengajuan_judul_id),
  FOREIGN KEY (sidang_id) REFERENCES sidang(id),
  FOREIGN KEY (pengajuan_judul_id) REFERENCES pengajuan_judul(id)
);

CREATE TABLE revisi_pasca_sidang_stages (
  id BIGINT UNSIGNED PRIMARY KEY AUTO_INCREMENT,
  revisi_id BIGINT UNSIGNED NOT NULL,
  signer_role ENUM('PENGUJI_2','PENGUJI_1','PEMBIMBING_2','PEMBIMBING_1') NOT NULL,
  nidn VARCHAR(20) NOT NULL,
  nama VARCHAR(255) NOT NULL,
  current_status ENUM('WAITING_SUBMISSION','SUBMITTED','NEED_REVISION','APPROVED') NOT NULL DEFAULT 'WAITING_SUBMISSION',
  current_submission_no TINYINT UNSIGNED NOT NULL DEFAULT 0,
  started_at DATETIME NULL DEFAULT NULL,
  finished_at DATETIME NULL DEFAULT NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uk_revisi_role (revisi_id, signer_role),
  FOREIGN KEY (revisi_id) REFERENCES revisi_pasca_sidang(id)
);

CREATE TABLE revisi_pasca_sidang_submissions (
  id BIGINT UNSIGNED PRIMARY KEY AUTO_INCREMENT,
  stage_id BIGINT UNSIGNED NOT NULL,
  submission_no TINYINT UNSIGNED NOT NULL,
  file_content LONGTEXT NOT NULL,
  file_name VARCHAR(255) NOT NULL,
  submitted_at DATETIME NOT NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (stage_id) REFERENCES revisi_pasca_sidang_stages(id)
);

CREATE TABLE revisi_pasca_sidang_reviews (
  id BIGINT UNSIGNED PRIMARY KEY AUTO_INCREMENT,
  stage_id BIGINT UNSIGNED NOT NULL,
  submission_no TINYINT UNSIGNED NOT NULL,
  decision ENUM('APPROVED','NEED_REVISION') NOT NULL,
  catatan TEXT NULL,
  reviewed_at DATETIME NOT NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY uk_stage_submission (stage_id, submission_no),
  FOREIGN KEY (stage_id) REFERENCES revisi_pasca_sidang_stages(id)
);

CREATE TABLE revisi_pasca_sidang_files (
  id BIGINT UNSIGNED PRIMARY KEY AUTO_INCREMENT,
  revisi_id BIGINT UNSIGNED NOT NULL,
  file_type ENUM('HALAMAN_PENGESAHAN_MAJELIS_PENGUJI','HALAMAN_PENGESAHAN_DEKAN') NOT NULL,
  file_name VARCHAR(255) NOT NULL,
  file_content LONGTEXT NOT NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY uk_revisi_file_type (revisi_id, file_type),
  FOREIGN KEY (revisi_id) REFERENCES revisi_pasca_sidang(id)
);
