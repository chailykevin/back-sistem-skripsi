CREATE TABLE outline_submissions (
  id            BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  outline_id    BIGINT UNSIGNED NOT NULL,
  submission_no INT UNSIGNED NOT NULL,
  file_content  LONGTEXT NOT NULL,
  file_name     VARCHAR(255) NULL,
  submitted_at  DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uq_outline_submission (outline_id, submission_no),
  CONSTRAINT fk_outline_submissions_outline FOREIGN KEY (outline_id) REFERENCES outline (id)
);

CREATE TABLE outline_reviews (
  id            BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  submission_id BIGINT UNSIGNED NOT NULL,
  decision_note TEXT NULL,
  file_content  LONGTEXT NULL,
  file_name     VARCHAR(255) NULL,
  reviewed_at   DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uq_outline_review (submission_id),
  CONSTRAINT fk_outline_reviews_submission FOREIGN KEY (submission_id) REFERENCES outline_submissions (id)
);

-- Migrate existing data
INSERT INTO outline_submissions (outline_id, submission_no, file_content, file_name, submitted_at)
SELECT outline_id, revision_no, file_outline_mahasiswa, file_outline_mahasiswa_name, created_at
FROM outline_details;

INSERT INTO outline_reviews (submission_id, decision_note, file_content, file_name, reviewed_at)
SELECT os.id, od.decision_note, od.file_outline_kaprodi, od.file_outline_kaprodi_name, od.updated_at
FROM outline_details od
JOIN outline_submissions os ON os.outline_id = od.outline_id AND os.submission_no = od.revision_no
WHERE od.decision_note IS NOT NULL OR od.file_outline_kaprodi IS NOT NULL;

DROP TABLE outline_details;
