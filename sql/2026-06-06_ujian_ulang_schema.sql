-- Allow multiple sidang rows per student (for ujian ulang re-exam)
ALTER TABLE sidang DROP INDEX pengajuan_judul_id;

-- Allow multiple pengajuan_sidang_kaprodi rows per student (for re-exam)
ALTER TABLE pengajuan_sidang_kaprodi DROP INDEX pengajuan_judul_id;

-- Link pengajuan_sidang_kaprodi to specific pengajuan_sidang row (needed to distinguish re-exam kaprodi rows)
ALTER TABLE pengajuan_sidang_kaprodi ADD COLUMN pengajuan_sidang_id INT NULL AFTER pengajuan_judul_id;

-- Track re-exam attempt number on pengajuan_sidang (1 = original, 2+ = re-exam)
ALTER TABLE pengajuan_sidang ADD COLUMN ujian_ke TINYINT UNSIGNED NOT NULL DEFAULT 1 AFTER status;
