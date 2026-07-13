CREATE TABLE revisi_pasca_sidang_review_file (
  id                             BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  revisi_pasca_sidang_review_id BIGINT UNSIGNED NOT NULL,
  file_content                   LONGTEXT        NOT NULL,
  file_name                      VARCHAR(255),
  mime_type                      VARCHAR(100)    NULL,
  uploaded_by_user_id             BIGINT UNSIGNED,
  created_at                     TIMESTAMP       NOT NULL DEFAULT CURRENT_TIMESTAMP,
  KEY idx_review_id (revisi_pasca_sidang_review_id),
  FOREIGN KEY (revisi_pasca_sidang_review_id)
    REFERENCES revisi_pasca_sidang_reviews(id) ON DELETE CASCADE
);
