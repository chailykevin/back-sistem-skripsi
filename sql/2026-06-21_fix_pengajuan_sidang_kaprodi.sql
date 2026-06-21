-- 1. Fix pengajuan_sidang_id: correct type, add NOT NULL, UNIQUE, and FK
--    (prerequisite for step 2 — skripsi_id/ujian_ke drop)
ALTER TABLE pengajuan_sidang_kaprodi
  MODIFY COLUMN pengajuan_sidang_id BIGINT UNSIGNED NOT NULL,
  ADD UNIQUE KEY uq_kaprodi_pengajuan_sidang_id (pengajuan_sidang_id),
  ADD CONSTRAINT fk_kaprodi_pengajuan_sidang
    FOREIGN KEY (pengajuan_sidang_id) REFERENCES pengajuan_sidang (id)
    ON DELETE CASCADE;

-- 2. Drop redundant columns now reachable via the FK above
ALTER TABLE pengajuan_sidang_kaprodi
  DROP COLUMN skripsi_id,
  DROP COLUMN ujian_ke;

-- 3. FK constraints on reviewer/verifier audit columns
ALTER TABLE pengajuan_sidang
  ADD CONSTRAINT fk_pengajuan_sidang_verified_by
    FOREIGN KEY (verified_by_user_id) REFERENCES users (id);

ALTER TABLE pengajuan_sidang_kaprodi
  ADD CONSTRAINT fk_kaprodi_reviewed_by
    FOREIGN KEY (reviewed_by_user_id) REFERENCES users (id);

-- 4. Add updated_at to pengajuan_sidang_files
ALTER TABLE pengajuan_sidang_files
  ADD COLUMN updated_at TIMESTAMP NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP;
