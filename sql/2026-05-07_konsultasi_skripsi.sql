CREATE TABLE kartu_konsultasi_skripsi (
  id                    BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  pengajuan_judul_id    BIGINT UNSIGNED NOT NULL,
  nama_mahasiswa        VARCHAR(255)    NOT NULL,
  npm                   VARCHAR(20)     NOT NULL,
  program_studi_id      BIGINT UNSIGNED,
  program_studi_nama    VARCHAR(255),
  judul_skripsi         VARCHAR(255),
  pembimbing1_nidn      VARCHAR(20),
  pembimbing1_nama      VARCHAR(255),
  pembimbing1_signature LONGTEXT,
  pembimbing2_nidn      VARCHAR(20),
  pembimbing2_nama      VARCHAR(255),
  pembimbing2_signature LONGTEXT,
  is_completed          TINYINT(1)      NOT NULL DEFAULT 0,
  completed_at          TIMESTAMP       NULL,
  created_at            TIMESTAMP       NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at            TIMESTAMP       NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uq_pengajuan_judul_id (pengajuan_judul_id),
  KEY idx_npm (npm),
  KEY idx_program_studi_id (program_studi_id)
);

CREATE TABLE konsultasi_skripsi_stage (
  id                          BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  kartu_konsultasi_skripsi_id BIGINT UNSIGNED NOT NULL,
  pengajuan_judul_id          BIGINT UNSIGNED NOT NULL,
  chapter_group               ENUM('BAB_1_2', 'BAB_3', 'BAB_4', 'BAB_5') NOT NULL,
  stage                       ENUM('PEMBIMBING_2', 'PEMBIMBING_1')         NOT NULL,
  pembimbing_nidn             VARCHAR(20)     NOT NULL,
  current_status              ENUM(
                                'WAITING_SUBMISSION',
                                'SUBMITTED',
                                'NEED_REVISION',
                                'CONTINUE',
                                'ACCEPTED'
                              ) NOT NULL DEFAULT 'WAITING_SUBMISSION',
  current_submission_no       INT UNSIGNED    NOT NULL DEFAULT 0,
  started_at                  TIMESTAMP       NOT NULL DEFAULT CURRENT_TIMESTAMP,
  finished_at                 TIMESTAMP       NULL,
  created_at                  TIMESTAMP       NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at                  TIMESTAMP       NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uq_kartu_chapter_stage (kartu_konsultasi_skripsi_id, chapter_group, stage),
  KEY idx_pembimbing_nidn (pembimbing_nidn),
  KEY idx_pengajuan_judul_id (pengajuan_judul_id),
  FOREIGN KEY (kartu_konsultasi_skripsi_id)
    REFERENCES kartu_konsultasi_skripsi(id) ON DELETE CASCADE
);

CREATE TABLE konsultasi_skripsi_submission (
  id                          BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  konsultasi_skripsi_stage_id BIGINT UNSIGNED NOT NULL,
  submission_no               INT UNSIGNED    NOT NULL,
  file_content                LONGTEXT        NOT NULL,
  file_name                   VARCHAR(255),
  submitted_by_user_id        BIGINT UNSIGNED,
  submitted_at                TIMESTAMP       NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY uq_stage_submission_no (konsultasi_skripsi_stage_id, submission_no),
  KEY idx_stage_id (konsultasi_skripsi_stage_id),
  FOREIGN KEY (konsultasi_skripsi_stage_id)
    REFERENCES konsultasi_skripsi_stage(id) ON DELETE CASCADE
);

CREATE TABLE konsultasi_skripsi_review (
  id                          BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  konsultasi_skripsi_stage_id BIGINT UNSIGNED NOT NULL,
  submission_no               INT UNSIGNED    NOT NULL,
  reviewer_user_id            BIGINT UNSIGNED,
  decision_status             ENUM('NEED_REVISION', 'CONTINUE', 'ACCEPTED') NOT NULL,
  catatan_mahasiswa           TEXT,
  catatan_kartu               TEXT,
  reviewed_at                 TIMESTAMP       NOT NULL DEFAULT CURRENT_TIMESTAMP,
  created_at                  TIMESTAMP       NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at                  TIMESTAMP       NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uq_stage_submission_review (konsultasi_skripsi_stage_id, submission_no),
  KEY idx_stage_id (konsultasi_skripsi_stage_id),
  FOREIGN KEY (konsultasi_skripsi_stage_id)
    REFERENCES konsultasi_skripsi_stage(id) ON DELETE CASCADE
);

CREATE TABLE konsultasi_skripsi_review_file (
  id                           BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  konsultasi_skripsi_review_id BIGINT UNSIGNED NOT NULL,
  file_content                 LONGTEXT        NOT NULL,
  file_name                    VARCHAR(255),
  uploaded_by_user_id          BIGINT UNSIGNED,
  created_at                   TIMESTAMP       NOT NULL DEFAULT CURRENT_TIMESTAMP,
  KEY idx_review_id (konsultasi_skripsi_review_id),
  FOREIGN KEY (konsultasi_skripsi_review_id)
    REFERENCES konsultasi_skripsi_review(id) ON DELETE CASCADE
);

CREATE TABLE kartu_konsultasi_skripsi_log (
  id                           BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  kartu_konsultasi_skripsi_id  BIGINT UNSIGNED NOT NULL,
  konsultasi_skripsi_stage_id  BIGINT UNSIGNED,
  konsultasi_skripsi_review_id BIGINT UNSIGNED,
  chapter_group                ENUM('BAB_1_2', 'BAB_3', 'BAB_4', 'BAB_5'),
  stage                        VARCHAR(20),
  submission_no                INT UNSIGNED,
  reviewer_nidn                VARCHAR(20),
  reviewer_nama                VARCHAR(255),
  status                       VARCHAR(50),
  catatan_kartu                TEXT,
  logged_at                    TIMESTAMP       NOT NULL DEFAULT CURRENT_TIMESTAMP,
  KEY idx_kartu_id (kartu_konsultasi_skripsi_id),
  KEY idx_logged_at (logged_at),
  FOREIGN KEY (kartu_konsultasi_skripsi_id)
    REFERENCES kartu_konsultasi_skripsi(id) ON DELETE CASCADE
);

CREATE TABLE kartu_konsultasi_skripsi_file (
  id                           BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  kartu_konsultasi_skripsi_id  BIGINT UNSIGNED NOT NULL,
  file_type                    VARCHAR(50)     NOT NULL DEFAULT 'FINAL_DOCX',
  file_content                 LONGTEXT        NOT NULL,
  file_name                    VARCHAR(255),
  generated_by_user_id         BIGINT UNSIGNED,
  generated_at                 TIMESTAMP       NOT NULL DEFAULT CURRENT_TIMESTAMP,
  is_active                    TINYINT(1)      NOT NULL DEFAULT 1,
  KEY idx_kartu_id (kartu_konsultasi_skripsi_id),
  KEY idx_is_active (is_active),
  FOREIGN KEY (kartu_konsultasi_skripsi_id)
    REFERENCES kartu_konsultasi_skripsi(id) ON DELETE CASCADE
);
