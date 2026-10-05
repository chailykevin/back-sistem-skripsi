-- Widen all existing pembimbing NIDN columns to VARCHAR(50).
-- Select the target SIMSI database before running this migration.
-- dosen.nidn and pengajuan_sidang_kaprodi.penguji1_nidn/penguji2_nidn
-- are already VARCHAR(50), so they require no alteration.
-- Preserve nullability, indexes, and existing foreign-key actions.
-- MySQL DDL implicitly commits; run during a maintenance window.

ALTER TABLE `konsultasi_outline_stage`
  DROP FOREIGN KEY `fk_konsultasi_stage_pembimbing_nidn`;

ALTER TABLE `konsultasi_outline_stage`
  MODIFY COLUMN `pembimbing_nidn` VARCHAR(50) NOT NULL;

ALTER TABLE `konsultasi_outline_stage`
  ADD CONSTRAINT `fk_konsultasi_stage_pembimbing_nidn`
    FOREIGN KEY (`pembimbing_nidn`) REFERENCES `dosen` (`nidn`)
    ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE `konsultasi_skripsi_stage`
  DROP FOREIGN KEY `fk_konsultasi_skripsi_stage_pembimbing`;

ALTER TABLE `konsultasi_skripsi_stage`
  MODIFY COLUMN `pembimbing_nidn` VARCHAR(50) NOT NULL;

ALTER TABLE `konsultasi_skripsi_stage`
  ADD CONSTRAINT `fk_konsultasi_skripsi_stage_pembimbing`
    FOREIGN KEY (`pembimbing_nidn`) REFERENCES `dosen` (`nidn`)
    ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE `outline`
  DROP FOREIGN KEY `fk_outline_pembimbing1_nidn`,
  DROP FOREIGN KEY `fk_outline_pembimbing2_nidn`;

ALTER TABLE `outline`
  MODIFY COLUMN `pembimbing1_nidn` VARCHAR(50) NULL DEFAULT NULL,
  MODIFY COLUMN `pembimbing2_nidn` VARCHAR(50) NULL DEFAULT NULL;

ALTER TABLE `outline`
  ADD CONSTRAINT `fk_outline_pembimbing1_nidn`
    FOREIGN KEY (`pembimbing1_nidn`) REFERENCES `dosen` (`nidn`)
    ON DELETE SET NULL ON UPDATE CASCADE,
  ADD CONSTRAINT `fk_outline_pembimbing2_nidn`
    FOREIGN KEY (`pembimbing2_nidn`) REFERENCES `dosen` (`nidn`)
    ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE `pengajuan_disposisi_pembimbing`
  DROP FOREIGN KEY `fk_pengajuan_pembimbing1_diajukan_nidn`,
  DROP FOREIGN KEY `fk_pengajuan_pembimbing2_diajukan_nidn`,
  DROP FOREIGN KEY `fk_pengajuan_pembimbing1_ditetapkan_nidn`,
  DROP FOREIGN KEY `fk_pengajuan_pembimbing2_ditetapkan_nidn`;

ALTER TABLE `pengajuan_disposisi_pembimbing`
  MODIFY COLUMN `pembimbing1_diajukan_nidn` VARCHAR(50) NULL DEFAULT NULL,
  MODIFY COLUMN `pembimbing2_diajukan_nidn` VARCHAR(50) NULL DEFAULT NULL,
  MODIFY COLUMN `pembimbing1_ditetapkan_nidn` VARCHAR(50) NULL DEFAULT NULL,
  MODIFY COLUMN `pembimbing2_ditetapkan_nidn` VARCHAR(50) NULL DEFAULT NULL;

ALTER TABLE `pengajuan_disposisi_pembimbing`
  ADD CONSTRAINT `fk_pengajuan_pembimbing1_diajukan_nidn`
    FOREIGN KEY (`pembimbing1_diajukan_nidn`) REFERENCES `dosen` (`nidn`)
    ON DELETE SET NULL ON UPDATE CASCADE,
  ADD CONSTRAINT `fk_pengajuan_pembimbing2_diajukan_nidn`
    FOREIGN KEY (`pembimbing2_diajukan_nidn`) REFERENCES `dosen` (`nidn`)
    ON DELETE SET NULL ON UPDATE CASCADE,
  ADD CONSTRAINT `fk_pengajuan_pembimbing1_ditetapkan_nidn`
    FOREIGN KEY (`pembimbing1_ditetapkan_nidn`) REFERENCES `dosen` (`nidn`)
    ON DELETE SET NULL ON UPDATE CASCADE,
  ADD CONSTRAINT `fk_pengajuan_pembimbing2_ditetapkan_nidn`
    FOREIGN KEY (`pembimbing2_ditetapkan_nidn`) REFERENCES `dosen` (`nidn`)
    ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE `skripsi`
  DROP FOREIGN KEY `fk_skripsi_pembimbing1`,
  DROP FOREIGN KEY `fk_skripsi_pembimbing2`;

ALTER TABLE `skripsi`
  MODIFY COLUMN `pembimbing1_nidn` VARCHAR(50) NULL DEFAULT NULL,
  MODIFY COLUMN `pembimbing2_nidn` VARCHAR(50) NULL DEFAULT NULL;

ALTER TABLE `skripsi`
  ADD CONSTRAINT `fk_skripsi_pembimbing1`
    FOREIGN KEY (`pembimbing1_nidn`) REFERENCES `dosen` (`nidn`)
    ON DELETE SET NULL ON UPDATE CASCADE,
  ADD CONSTRAINT `fk_skripsi_pembimbing2`
    FOREIGN KEY (`pembimbing2_nidn`) REFERENCES `dosen` (`nidn`)
    ON DELETE SET NULL ON UPDATE CASCADE;
