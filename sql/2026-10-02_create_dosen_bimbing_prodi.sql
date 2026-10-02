CREATE TABLE dosen_bimbing_prodi (
  id_dosen_bimbing_prodi BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  dosen_nidn VARCHAR(50) NOT NULL,
  program_studi_id BIGINT UNSIGNED NOT NULL,
  PRIMARY KEY (id_dosen_bimbing_prodi),
  UNIQUE KEY uq_dosen_bimbing_prodi_dosen_program_studi (dosen_nidn, program_studi_id),
  KEY idx_dosen_bimbing_prodi_program_studi (program_studi_id),
  CONSTRAINT fk_dosen_bimbing_prodi_dosen FOREIGN KEY (dosen_nidn) REFERENCES dosen(nidn) ON UPDATE CASCADE ON DELETE RESTRICT,
  CONSTRAINT fk_dosen_bimbing_prodi_program_studi FOREIGN KEY (program_studi_id) REFERENCES program_studi(id) ON UPDATE CASCADE ON DELETE RESTRICT
) ENGINE=InnoDB;
