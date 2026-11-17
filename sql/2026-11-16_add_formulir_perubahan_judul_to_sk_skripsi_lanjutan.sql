-- Formulir Perubahan Judul Skripsi (Bisnis Digital): generated when the Seminar revisi completes with a
-- changed title (sidang.judul_baru), signed by mahasiswa, both pembimbing, Kaprodi and Dekan. The SK
-- Penulisan Skripsi can't be issued for a changed title until this form exists.
ALTER TABLE pengajuan_sk_skripsi_lanjutan
  ADD COLUMN formulir_perubahan_judul_file_name VARCHAR(255)
    CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NULL AFTER file_content,
  ADD COLUMN formulir_perubahan_judul_mime_type VARCHAR(100)
    CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NULL AFTER formulir_perubahan_judul_file_name,
  ADD COLUMN formulir_perubahan_judul_file_content LONGTEXT NULL AFTER formulir_perubahan_judul_mime_type;
