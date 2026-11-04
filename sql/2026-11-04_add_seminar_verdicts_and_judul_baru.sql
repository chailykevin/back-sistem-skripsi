-- Seminar Bisnis Digital verdicts follow the grade: JUDUL_DITERIMA (A–C) or JUDUL_DITOLAK (D).
-- sidang_notulen also gains GAGAL: submitHasilPenilaian writes the verdict onto every notulen, and
-- the column never got GAGAL in 2026-06-11_add_gagal_verdict.sql, so a GAGAL verdict failed there.
ALTER TABLE sidang
  MODIFY COLUMN hasil_sidang ENUM('LULUS','TIDAK_LULUS','GAGAL','JUDUL_DITERIMA','JUDUL_DITOLAK') NULL,
  ADD COLUMN judul_baru VARCHAR(255) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NULL AFTER catatan_penguji;

ALTER TABLE sidang_hasil_penilaian
  MODIFY COLUMN hasil_sidang ENUM('LULUS','TIDAK_LULUS','GAGAL','JUDUL_DITERIMA','JUDUL_DITOLAK') NULL;

ALTER TABLE sidang_notulen
  MODIFY COLUMN hasil_sidang ENUM('LULUS','TIDAK_LULUS','GAGAL','JUDUL_DITERIMA','JUDUL_DITOLAK') NULL;
