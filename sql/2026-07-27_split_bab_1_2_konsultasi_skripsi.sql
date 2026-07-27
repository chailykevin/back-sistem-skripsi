ALTER TABLE konsultasi_skripsi_stage
  MODIFY COLUMN chapter_group ENUM('BAB_1_2', 'BAB_1', 'BAB_2', 'BAB_3', 'BAB_4', 'BAB_5') NOT NULL;

UPDATE konsultasi_skripsi_stage
  SET chapter_group = 'BAB_1'
  WHERE chapter_group = 'BAB_1_2';

ALTER TABLE konsultasi_skripsi_stage
  MODIFY COLUMN chapter_group ENUM('BAB_1', 'BAB_2', 'BAB_3', 'BAB_4', 'BAB_5') NOT NULL;
