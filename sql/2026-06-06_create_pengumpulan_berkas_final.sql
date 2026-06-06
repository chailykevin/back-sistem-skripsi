CREATE TABLE pengumpulan_berkas_final (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  pengajuan_judul_id BIGINT UNSIGNED NOT NULL,
  npm VARCHAR(20) NOT NULL,
  status ENUM('DRAFT','SUBMITTED','COMPLETED') NOT NULL DEFAULT 'DRAFT',
  is_completed TINYINT(1) NOT NULL DEFAULT 0,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uq_pengajuan_judul (pengajuan_judul_id),
  FOREIGN KEY (pengajuan_judul_id) REFERENCES pengajuan_judul(id)
);

CREATE TABLE pengumpulan_berkas_final_files (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  pengumpulan_id BIGINT UNSIGNED NOT NULL,
  file_type ENUM('FILE_SKRIPSI','ARTIKEL_PENELITIAN','SURAT_PERNYATAAN_PENYERAHAN') NOT NULL,
  file_name VARCHAR(255) NOT NULL,
  mime_type VARCHAR(100) NULL,
  file_content LONGTEXT NOT NULL,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY uq_file_type (pengumpulan_id, file_type),
  FOREIGN KEY (pengumpulan_id) REFERENCES pengumpulan_berkas_final(id)
);

CREATE TABLE pengumpulan_berkas_final_confirmations (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  pengumpulan_id BIGINT UNSIGNED NOT NULL,
  recipient_role ENUM('PERPUSTAKAAN','LPPM','PEMBIMBING_1','PEMBIMBING_2','PENGUJI_1','PENGUJI_2') NOT NULL,
  nidn VARCHAR(20) NULL,
  user_id INT NULL,
  confirmed_at DATETIME NULL,
  UNIQUE KEY uq_role (pengumpulan_id, recipient_role),
  FOREIGN KEY (pengumpulan_id) REFERENCES pengumpulan_berkas_final(id)
);
