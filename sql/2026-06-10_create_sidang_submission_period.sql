CREATE TABLE sidang_submission_period (
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  tahun_akademik VARCHAR(9) NOT NULL,
  periode_akademik ENUM('GANJIL','GENAP') NOT NULL,
  open_at DATETIME NOT NULL,
  close_at DATETIME NOT NULL,
  created_by_user_id BIGINT UNSIGNED NULL,
  updated_by_user_id BIGINT UNSIGNED NULL,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  FOREIGN KEY (created_by_user_id) REFERENCES users(id) ON DELETE SET NULL,
  FOREIGN KEY (updated_by_user_id) REFERENCES users(id) ON DELETE SET NULL
);

ALTER TABLE pengajuan_sidang
  ADD COLUMN sidang_submission_period_id BIGINT UNSIGNED NULL,
  ADD FOREIGN KEY (sidang_submission_period_id)
    REFERENCES sidang_submission_period(id) ON DELETE SET NULL;
