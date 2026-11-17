-- Form Pengajuan Topik Seminar Bisnis Digital (students with tahap_tugas_akhir = SEMINAR_BISNIS_DIGITAL):
-- Kaprodi ticks five syarat. Data Perkembangan Akademik is the transkrip (syarat_transkrip, file TRANSKRIP);
-- the student also uploads a fotocopy KTM; the other three are conditions Kaprodi checks on that document.
ALTER TABLE pengajuan_disposisi_pembimbing
  ADD COLUMN syarat_ktm             TINYINT(1) NOT NULL DEFAULT 0 AFTER syarat_transkrip,
  ADD COLUMN syarat_sks_min         TINYINT(1) NOT NULL DEFAULT 0 AFTER syarat_ktm,
  ADD COLUMN syarat_simulasi_bisnis TINYINT(1) NOT NULL DEFAULT 0 AFTER syarat_sks_min,
  ADD COLUMN syarat_nilai_d         TINYINT(1) NOT NULL DEFAULT 0 AFTER syarat_simulasi_bisnis;

ALTER TABLE pengajuan_disposisi_pembimbing_file
  MODIFY COLUMN file_type ENUM('PENGAJUAN_DISPOSISI_PEMBIMBING','TRANSKRIP','KRS','METODOLOGI','KTM')
    CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL;
