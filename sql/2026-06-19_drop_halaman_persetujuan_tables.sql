-- Remove halaman_persetujuan_judul tables now that signing is auto-generated
-- and stored directly in pengajuan_sk_penelitian_files.
-- Drop child tables first (they FK into the root), then the root.
ALTER TABLE halaman_persetujuan_judul DROP FOREIGN KEY fk_halaman_outline;
DROP TABLE IF EXISTS halaman_persetujuan_judul_file;
DROP TABLE IF EXISTS halaman_persetujuan_judul_signatures;
DROP TABLE IF EXISTS halaman_persetujuan_judul;
