ALTER TABLE users ADD COLUMN email VARCHAR(255) NULL AFTER nidn;
ALTER TABLE mahasiswa ADD COLUMN email_verified_at DATETIME NULL AFTER email;

CREATE TABLE password_reset_tokens (
  id INT AUTO_INCREMENT PRIMARY KEY,
  user_id INT NOT NULL,
  token_hash CHAR(64) NOT NULL,
  expires_at DATETIME NOT NULL,
  used_at DATETIME NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_password_reset_token_hash (token_hash),
  INDEX idx_password_reset_user_id (user_id)
);

CREATE TABLE mahasiswa_email_verification_tokens (
  id INT AUTO_INCREMENT PRIMARY KEY,
  npm VARCHAR(20) NOT NULL,
  email VARCHAR(255) NOT NULL,
  token_hash CHAR(64) NOT NULL,
  expires_at DATETIME NOT NULL,
  used_at DATETIME NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_mahasiswa_email_verif_token_hash (token_hash),
  INDEX idx_mahasiswa_email_verif_npm (npm)
);
