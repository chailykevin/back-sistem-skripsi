-- Seminar Bisnis Digital → Skripsi bridge. Created when the Seminar revisi completes (JUDUL_DITERIMA):
-- Kaprodi forwards it (no reject), Sekretariat issues the SK Skripsi (Skep-Skripsi series). The SK lives
-- here, not on pengajuan_sk_penelitian, so the kartu keeps showing the Seminar SK number.
CREATE TABLE pengajuan_sk_skripsi_lanjutan (
  id                   BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  skripsi_id           BIGINT UNSIGNED NOT NULL,
  seminar_sidang_id    BIGINT UNSIGNED NOT NULL,
  status               ENUM('WAITING_KAPRODI','WAITING_SEKRETARIAT','COMPLETED')
                         CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT 'WAITING_KAPRODI',
  judul_seminar        VARCHAR(255) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL,
  judul_skripsi        VARCHAR(255) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NULL,
  nomor_surat          VARCHAR(100) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NULL,
  file_name            VARCHAR(255) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NULL,
  mime_type            VARCHAR(100) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NULL,
  file_content         LONGTEXT NULL,
  forwarded_by_user_id BIGINT UNSIGNED NULL,
  forwarded_at         DATETIME NULL,
  issued_by_user_id    BIGINT UNSIGNED NULL,
  completed_at         DATETIME NULL,
  created_at           DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at           DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uq_pengajuan_sk_skripsi_lanjutan_skripsi (skripsi_id),
  KEY idx_pengajuan_sk_skripsi_lanjutan_status (status),
  CONSTRAINT fk_pengajuan_sk_skripsi_lanjutan_skripsi FOREIGN KEY (skripsi_id)
    REFERENCES skripsi (id) ON UPDATE CASCADE ON DELETE RESTRICT,
  CONSTRAINT fk_pengajuan_sk_skripsi_lanjutan_sidang FOREIGN KEY (seminar_sidang_id)
    REFERENCES sidang (id) ON UPDATE CASCADE ON DELETE RESTRICT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
