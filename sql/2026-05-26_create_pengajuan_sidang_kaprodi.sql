CREATE TABLE pengajuan_sidang_kaprodi (
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  pengajuan_judul_id BIGINT UNSIGNED NOT NULL UNIQUE,
  status ENUM('DRAFT','SUBMITTED','NEED_REVISION','VALID','REJECTED') NOT NULL DEFAULT 'DRAFT',

  tempat_lahir VARCHAR(100) NULL,
  tgl_lahir DATE NULL,
  alamat TEXT NULL,
  no_hp VARCHAR(30) NULL,
  no_wa VARCHAR(30) NULL,
  ujian_ke TINYINT UNSIGNED NULL,
  ipk DECIMAL(4,2) NULL,
  semua_mk_lulus TINYINT(1) NOT NULL DEFAULT 0,

  penguji1_nama VARCHAR(255) NULL,
  penguji1_nidn VARCHAR(50) NULL,
  penguji2_nama VARCHAR(255) NULL,
  penguji2_nidn VARCHAR(50) NULL,

  catatan_kaprodi TEXT NULL,
  reviewed_by_user_id BIGINT UNSIGNED NULL,
  submitted_at DATETIME NULL,
  reviewed_at DATETIME NULL,

  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  FOREIGN KEY (pengajuan_judul_id) REFERENCES pengajuan_judul(id)
);
