-- A title-change proposal always travels with an outline consultation
-- submission and is decided inside that stage's review.
-- Proposed during PEMBIMBING_2 stage: P2 decides, then P1 (in their next review).
-- Proposed during PEMBIMBING_1 stage: P1 alone decides.
CREATE TABLE IF NOT EXISTS usulan_perubahan_judul (
  id                                BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  outline_id                        BIGINT UNSIGNED NOT NULL,
  konsultasi_outline_submission_id  BIGINT UNSIGNED NOT NULL,
  diajukan_pada_stage               ENUM('PEMBIMBING_2', 'PEMBIMBING_1') NOT NULL,
  judul_lama                        VARCHAR(255)    NOT NULL,
  judul_usulan                      VARCHAR(255)    NOT NULL,
  alasan                            TEXT            NOT NULL,
  status                            ENUM(
                                      'WAITING_PEMBIMBING_2',
                                      'WAITING_PEMBIMBING_1',
                                      'APPROVED',
                                      'REJECTED'
                                    ) NOT NULL,
  pembimbing2_user_id               BIGINT UNSIGNED NULL,
  pembimbing2_keputusan_at          DATETIME        NULL,
  pembimbing2_catatan               TEXT            NULL,
  pembimbing1_user_id               BIGINT UNSIGNED NULL,
  pembimbing1_keputusan_at          DATETIME        NULL,
  pembimbing1_catatan               TEXT            NULL,
  alasan_penolakan                  TEXT            NULL,
  created_at                        TIMESTAMP       NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at                        TIMESTAMP       NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  -- 1 while the request is still pending, NULL otherwise; MySQL has no partial
  -- unique index, and NULLs never collide, so this enforces at most one
  -- pending request per outline while keeping unlimited finished ones.
  active_key                        TINYINT GENERATED ALWAYS AS (
                                      CASE WHEN status IN ('WAITING_PEMBIMBING_2', 'WAITING_PEMBIMBING_1')
                                           THEN 1 END
                                    ) STORED,
  PRIMARY KEY (id),
  UNIQUE KEY uq_usulan_judul_one_active (outline_id, active_key),
  KEY idx_usulan_judul_status (status),
  KEY idx_usulan_judul_submission (konsultasi_outline_submission_id),
  CONSTRAINT fk_usulan_judul_outline FOREIGN KEY (outline_id)
    REFERENCES outline (id) ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT fk_usulan_judul_submission FOREIGN KEY (konsultasi_outline_submission_id)
    REFERENCES konsultasi_outline_submission (id) ON DELETE CASCADE ON UPDATE CASCADE
) ENGINE=InnoDB;
