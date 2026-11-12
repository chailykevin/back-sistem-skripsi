-- pengajuan_sk_penelitian.jenis_sk is decided at VERIFY (from mahasiswa.tahap_tugas_akhir), but it was
-- added as NOT NULL DEFAULT 'SKRIPSI', so every pending SK already read as SKRIPSI and the
-- `jenis_sk ?? tahap_tugas_akhir` fallbacks (Sekretariat list/detail, student SK page, SK Penulisan
-- notification names) could never show "SK Penulisan Proposal". NULL now means "not verified yet".
-- Every reader that needs a real value (SK numbering, kartu Konsultasi Skripsi, Dekan list) only looks
-- at COMPLETED SKs, which keep theirs.

ALTER TABLE pengajuan_sk_penelitian
  MODIFY COLUMN jenis_sk ENUM('SKRIPSI','SEMINAR_BISNIS_DIGITAL')
    CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NULL DEFAULT NULL;

UPDATE pengajuan_sk_penelitian
SET jenis_sk = NULL
WHERE status <> 'COMPLETED';
