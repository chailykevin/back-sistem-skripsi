-- Password reset by email OTP and change password, both written to SIMIKO (widya_miko), where every
-- mahasiswa/dosen/staff password lives. Replaces the link-based reset and the student email capture:
-- the reset email now comes from SIMIKO (m_usermhs.mhsEmail, m_dosen.dsnEmail), so the local copies go.

DROP TABLE IF EXISTS password_reset_tokens;
DROP TABLE IF EXISTS mahasiswa_email_verification_tokens;

ALTER TABLE mahasiswa
  DROP COLUMN email_verified_at,
  DROP COLUMN email;

-- Tokens issued before this moment are rejected by the auth middleware.
ALTER TABLE users ADD COLUMN password_changed_at DATETIME NULL AFTER password_hash;

CREATE TABLE password_reset_otps (
  id                     BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  user_id                BIGINT UNSIGNED NOT NULL,
  email                  VARCHAR(255) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL,
  otp_hash               CHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  attempts               TINYINT UNSIGNED NOT NULL DEFAULT 0,
  expires_at             DATETIME NOT NULL,
  verified_at            DATETIME NULL,
  reset_token_hash       CHAR(64) CHARACTER SET ascii COLLATE ascii_bin NULL,
  reset_token_expires_at DATETIME NULL,
  used_at                DATETIME NULL,
  request_ip             VARCHAR(45) CHARACTER SET ascii COLLATE ascii_bin NULL,
  created_at             DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uq_password_reset_otps_reset_token (reset_token_hash),
  KEY idx_password_reset_otps_user_created (user_id, created_at),
  KEY idx_password_reset_otps_ip_created (request_ip, created_at),
  CONSTRAINT fk_password_reset_otps_user FOREIGN KEY (user_id)
    REFERENCES users (id) ON UPDATE CASCADE ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE password_change_log (
  id           BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  user_id      BIGINT UNSIGNED NOT NULL,
  username     VARCHAR(100) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL,
  account_type ENUM('MAHASISWA','DOSEN','STAF','LOKAL') CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL,
  method       ENUM('RESET','CHANGE') CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL,
  request_ip   VARCHAR(45) CHARACTER SET ascii COLLATE ascii_bin NULL,
  created_at   DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY idx_password_change_log_user (user_id, created_at),
  CONSTRAINT fk_password_change_log_user FOREIGN KEY (user_id)
    REFERENCES users (id) ON UPDATE CASCADE ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
