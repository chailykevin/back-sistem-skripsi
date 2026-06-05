CREATE TABLE revisi_pasca_sidang (
  id BIGINT UNSIGNED PRIMARY KEY AUTO_INCREMENT,
  sidang_id BIGINT UNSIGNED NOT NULL,
  pengajuan_judul_id BIGINT UNSIGNED NOT NULL,
  npm VARCHAR(20) NOT NULL,
  status ENUM('DRAFT','WAITING_PENGUJI2','WAITING_PENGUJI1','WAITING_DOSPEM2','WAITING_DOSPEM1','COMPLETED') NOT NULL DEFAULT 'DRAFT',
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uk_pengajuan_judul (pengajuan_judul_id),
  FOREIGN KEY (sidang_id) REFERENCES sidang(id),
  FOREIGN KEY (pengajuan_judul_id) REFERENCES pengajuan_judul(id)
);

CREATE TABLE revisi_pasca_sidang_submissions (
  id BIGINT UNSIGNED PRIMARY KEY AUTO_INCREMENT,
  revisi_id BIGINT UNSIGNED NOT NULL,
  submission_no TINYINT UNSIGNED NOT NULL DEFAULT 1,
  file_content LONGTEXT NOT NULL,
  file_name VARCHAR(255) NOT NULL,
  submitted_at DATETIME NOT NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (revisi_id) REFERENCES revisi_pasca_sidang(id)
);

CREATE TABLE revisi_pasca_sidang_signatures (
  id BIGINT UNSIGNED PRIMARY KEY AUTO_INCREMENT,
  revisi_id BIGINT UNSIGNED NOT NULL,
  submission_id BIGINT UNSIGNED NOT NULL,
  signer_role ENUM('PENGUJI_2','PENGUJI_1','PEMBIMBING_2','PEMBIMBING_1') NOT NULL,
  nidn VARCHAR(20) NOT NULL,
  nama VARCHAR(255) NOT NULL,
  catatan TEXT NULL,
  signed_at DATETIME NOT NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY uk_submission_role (submission_id, signer_role),
  FOREIGN KEY (revisi_id) REFERENCES revisi_pasca_sidang(id),
  FOREIGN KEY (submission_id) REFERENCES revisi_pasca_sidang_submissions(id)
);

CREATE TABLE revisi_pasca_sidang_files (
  id BIGINT UNSIGNED PRIMARY KEY AUTO_INCREMENT,
  revisi_id BIGINT UNSIGNED NOT NULL,
  file_type ENUM('HALAMAN_PENGESAHAN_MAJELIS_PENGUJI','HALAMAN_PENGESAHAN_DEKAN') NOT NULL,
  file_name VARCHAR(255) NOT NULL,
  file_content LONGTEXT NOT NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY uk_revisi_file_type (revisi_id, file_type),
  FOREIGN KEY (revisi_id) REFERENCES revisi_pasca_sidang(id)
);
