-- 1+2. Drop skripsi_id and npm from revisi_pasca_sidang
--      skripsi_id: derivable via sidang_id → sidang.skripsi_id (already joined in all queries)
--      npm: derivable via sidang_id → sidang.npm
ALTER TABLE revisi_pasca_sidang
  DROP FOREIGN KEY fk_revisi_skripsi,
  DROP COLUMN skripsi_id,
  DROP COLUMN npm;

-- 3. Replace nidn/nama with user_id on revisi_pasca_sidang_stages
--    user_id is nullable — guards against edge case where participant has no users row
ALTER TABLE revisi_pasca_sidang_stages
  DROP COLUMN nidn,
  DROP COLUMN nama,
  ADD COLUMN user_id BIGINT UNSIGNED NULL AFTER revisi_id,
  ADD CONSTRAINT fk_revisi_stages_user FOREIGN KEY (user_id) REFERENCES users (id);
