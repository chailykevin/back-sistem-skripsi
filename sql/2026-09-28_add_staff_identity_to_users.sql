ALTER TABLE users
  ADD COLUMN staff_usr_id VARCHAR(50) NULL AFTER nidn,
  ADD UNIQUE KEY uq_users_staff_usr_id (staff_usr_id),
  ADD CONSTRAINT fk_users_staff_usr_id
    FOREIGN KEY (staff_usr_id) REFERENCES staf(usr_id)
    ON DELETE SET NULL
    ON UPDATE CASCADE;

ALTER TABLE program_studi
  MODIFY COLUMN kaprodi_nidn VARCHAR(50) NULL,
  MODIFY COLUMN sekprodi_nidn VARCHAR(50) NULL;

ALTER TABLE fakultas
  MODIFY COLUMN dekan_nidn VARCHAR(50) NULL;
