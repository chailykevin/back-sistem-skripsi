CREATE TABLE dosen_uji_sidang_skripsi_prodi (
  id_dosen_uji_sidang_skripsi_prodi BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  dosen_nidn VARCHAR(50) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL,
  program_studi_id BIGINT UNSIGNED NOT NULL,
  role ENUM('PENGUJI_1', 'PENGUJI_2') NOT NULL,
  PRIMARY KEY (id_dosen_uji_sidang_skripsi_prodi),
  UNIQUE KEY uq_dosen_uji_sidang_skripsi_prodi_dosen_prodi_role (dosen_nidn, program_studi_id, role),
  KEY idx_dosen_uji_sidang_skripsi_prodi_prodi_role (program_studi_id, role),
  CONSTRAINT fk_dosen_uji_sidang_skripsi_prodi_dosen FOREIGN KEY (dosen_nidn) REFERENCES dosen(nidn) ON UPDATE CASCADE ON DELETE RESTRICT,
  CONSTRAINT fk_dosen_uji_sidang_skripsi_prodi_program_studi FOREIGN KEY (program_studi_id) REFERENCES program_studi(id) ON UPDATE CASCADE ON DELETE RESTRICT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
