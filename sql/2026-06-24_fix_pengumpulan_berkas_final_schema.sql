-- 1. Fix user_id type + add FK on confirmations
--    Was plain int with no FK constraint
ALTER TABLE pengumpulan_berkas_final_confirmations
  MODIFY COLUMN user_id BIGINT UNSIGNED DEFAULT NULL,
  ADD CONSTRAINT fk_confirmations_user FOREIGN KEY (user_id) REFERENCES users (id);

-- 2. Drop nidn from confirmations — user_id is the sole canonical identity reference
ALTER TABLE pengumpulan_berkas_final_confirmations
  DROP COLUMN nidn;

-- 3. Drop npm from pengumpulan_berkas_final — derivable via skripsi_id → skripsi.npm
ALTER TABLE pengumpulan_berkas_final
  DROP COLUMN npm;
