-- 1. FK on sidang.pengajuan_sidang_id → pengajuan_sidang(id)
ALTER TABLE sidang
  ADD CONSTRAINT fk_sidang_pengajuan_sidang
    FOREIGN KEY (pengajuan_sidang_id) REFERENCES pengajuan_sidang (id);

-- 2. FK constraints on four child tables → sidang(id) ON DELETE CASCADE
ALTER TABLE sidang_notulen
  ADD CONSTRAINT fk_notulen_sidang
    FOREIGN KEY (sidang_id) REFERENCES sidang (id) ON DELETE CASCADE;

ALTER TABLE sidang_files
  ADD CONSTRAINT fk_sidang_files_sidang
    FOREIGN KEY (sidang_id) REFERENCES sidang (id) ON DELETE CASCADE;

ALTER TABLE sidang_penilaian
  ADD CONSTRAINT fk_penilaian_sidang
    FOREIGN KEY (sidang_id) REFERENCES sidang (id) ON DELETE CASCADE;

ALTER TABLE sidang_hasil_penilaian
  ADD CONSTRAINT fk_hasil_penilaian_sidang
    FOREIGN KEY (sidang_id) REFERENCES sidang (id) ON DELETE CASCADE;

-- 3. Replace nidn/nama with user_id on sidang_notulen and sidang_penilaian
--    user_id is nullable — a participant with no users row (edge case) won't orphan the FK.
ALTER TABLE sidang_notulen
  ADD COLUMN user_id BIGINT UNSIGNED NULL AFTER sidang_id,
  ADD CONSTRAINT fk_notulen_user FOREIGN KEY (user_id) REFERENCES users (id),
  DROP COLUMN nidn,
  DROP COLUMN nama;

ALTER TABLE sidang_penilaian
  ADD COLUMN user_id BIGINT UNSIGNED NULL AFTER sidang_id,
  ADD CONSTRAINT fk_penilaian_user FOREIGN KEY (user_id) REFERENCES users (id),
  DROP COLUMN nidn,
  DROP COLUMN nama;

-- 4. Drop ujian_ke from sidang — derivable via pengajuan_sidang_id → pengajuan_sidang.ujian_ke
ALTER TABLE sidang DROP COLUMN ujian_ke;
