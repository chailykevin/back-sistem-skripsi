ALTER TABLE dosen
  ADD COLUMN program_studi_id BIGINT UNSIGNED NULL AFTER email,
  ADD CONSTRAINT fk_dosen_program_studi
    FOREIGN KEY (program_studi_id) REFERENCES program_studi(id)
    ON UPDATE CASCADE
    ON DELETE SET NULL;
