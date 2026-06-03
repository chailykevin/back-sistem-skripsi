CREATE TABLE sidang (
  id                  BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  pengajuan_judul_id  BIGINT UNSIGNED NOT NULL,
  pengajuan_sidang_id BIGINT UNSIGNED NOT NULL,

  npm                 VARCHAR(20) NOT NULL,
  nama_mahasiswa      VARCHAR(255) NOT NULL,
  program_studi_id    BIGINT UNSIGNED NOT NULL,
  program_studi_nama  VARCHAR(255) NOT NULL,
  judul_skripsi       TEXT NOT NULL,
  ujian_ke            TINYINT UNSIGNED NOT NULL,

  pembimbing1_nidn    VARCHAR(50) NOT NULL,
  pembimbing1_nama    VARCHAR(255) NOT NULL,
  pembimbing2_nidn    VARCHAR(50) NOT NULL,
  pembimbing2_nama    VARCHAR(255) NOT NULL,
  penguji1_nidn       VARCHAR(50) NOT NULL,
  penguji1_nama       VARCHAR(255) NOT NULL,
  penguji2_nidn       VARCHAR(50) NOT NULL,
  penguji2_nama       VARCHAR(255) NOT NULL,

  tanggal_sidang      DATE NOT NULL,
  waktu_sidang        TIME NOT NULL,
  tempat_sidang       VARCHAR(255) NOT NULL,
  tanggal_disposisi   DATE NULL,

  hasil_sidang        ENUM('LULUS','TIDAK_LULUS') NULL,
  catatan_penguji     TEXT NULL,

  status              ENUM('SCHEDULED','ONGOING','COMPLETED') NOT NULL DEFAULT 'SCHEDULED',
  completed_at        DATETIME NULL,
  created_at          TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at          TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,

  PRIMARY KEY (id),
  UNIQUE KEY uq_pengajuan_judul (pengajuan_judul_id),
  KEY idx_pengajuan_sidang (pengajuan_sidang_id)
);

CREATE TABLE sidang_penilaian (
  id                    BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  sidang_id             BIGINT UNSIGNED NOT NULL,
  role                  ENUM('PEMBIMBING_1','PEMBIMBING_2','PENGUJI_1','PENGUJI_2') NOT NULL,
  nidn                  VARCHAR(50) NOT NULL,
  nama                  VARCHAR(255) NOT NULL,

  nilai_isi             DECIMAL(5,2) NULL,
  keterangan_isi        VARCHAR(255) NULL,
  nilai_bahasa          DECIMAL(5,2) NULL,
  keterangan_bahasa     VARCHAR(255) NULL,
  nilai_tsp             DECIMAL(5,2) NULL,
  keterangan_tsp        VARCHAR(255) NULL,
  nilai_penguasaan      DECIMAL(5,2) NULL,
  keterangan_penguasaan VARCHAR(255) NULL,
  nilai_penunjang       DECIMAL(5,2) NULL,
  keterangan_penunjang  VARCHAR(255) NULL,
  total_nilai           DECIMAL(5,2) NULL,

  file_content          LONGTEXT NULL,
  file_name             VARCHAR(255) NULL,
  submitted_at          DATETIME NULL,

  created_at            TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at            TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,

  PRIMARY KEY (id),
  UNIQUE KEY uq_sidang_role (sidang_id, role)
);

CREATE TABLE sidang_notulen (
  id           BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  sidang_id    BIGINT UNSIGNED NOT NULL,
  role         ENUM('PENGUJI_1','PENGUJI_2') NOT NULL,
  nidn         VARCHAR(50) NOT NULL,
  nama         VARCHAR(255) NOT NULL,

  note         TEXT NULL,
  hasil_sidang ENUM('LULUS','TIDAK_LULUS') NULL,

  file_content LONGTEXT NULL,
  file_name    VARCHAR(255) NULL,
  submitted_at DATETIME NULL,

  created_at   TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at   TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,

  PRIMARY KEY (id),
  UNIQUE KEY uq_sidang_role (sidang_id, role)
);

CREATE TABLE sidang_hasil_penilaian (
  id                BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  sidang_id         BIGINT UNSIGNED NOT NULL,

  nilai_pembimbing1 DECIMAL(5,2) NULL,
  nilai_pembimbing2 DECIMAL(5,2) NULL,
  nilai_penguji1    DECIMAL(5,2) NULL,
  nilai_penguji2    DECIMAL(5,2) NULL,
  total_nilai       DECIMAL(5,2) NULL,
  rata              DECIMAL(5,2) NULL,
  grade             CHAR(1) NULL,
  hasil_sidang      ENUM('LULUS','TIDAK_LULUS') NULL,
  catatan_penguji   TEXT NULL,

  file_content      LONGTEXT NULL,
  file_name         VARCHAR(255) NULL,
  submitted_at      DATETIME NULL,

  created_at        TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at        TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,

  PRIMARY KEY (id),
  UNIQUE KEY uq_sidang (sidang_id)
);

CREATE TABLE sidang_files (
  id           BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  sidang_id    BIGINT UNSIGNED NOT NULL,
  file_type    ENUM('BERITA_ACARA') NOT NULL,
  file_name    VARCHAR(255) NOT NULL,
  file_content LONGTEXT NOT NULL,
  created_at   TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,

  PRIMARY KEY (id),
  UNIQUE KEY uq_sidang_filetype (sidang_id, file_type)
);
