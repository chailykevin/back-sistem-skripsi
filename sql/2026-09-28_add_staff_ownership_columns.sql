ALTER TABLE program_studi
  ADD COLUMN kaprodi_staff_usr_id VARCHAR(50) NULL AFTER kaprodi_nidn,
  ADD COLUMN sekprodi_staff_usr_id VARCHAR(50) NULL AFTER sekprodi_nidn,
  ADD CONSTRAINT fk_program_studi_kaprodi_staff
    FOREIGN KEY (kaprodi_staff_usr_id) REFERENCES staf(usr_id)
    ON DELETE SET NULL
    ON UPDATE CASCADE,
  ADD CONSTRAINT fk_program_studi_sekprodi_staff
    FOREIGN KEY (sekprodi_staff_usr_id) REFERENCES staf(usr_id)
    ON DELETE SET NULL
    ON UPDATE CASCADE;

ALTER TABLE fakultas
  ADD COLUMN dekan_staff_usr_id VARCHAR(50) NULL AFTER dekan_nidn,
  ADD CONSTRAINT fk_fakultas_dekan_staff
    FOREIGN KEY (dekan_staff_usr_id) REFERENCES staf(usr_id)
    ON DELETE SET NULL
    ON UPDATE CASCADE;
