ALTER TABLE skripsi
  ADD COLUMN `pengajuan_judul_id` BIGINT UNSIGNED NULL AFTER `npm`,
  ADD UNIQUE KEY `uq_pengajuan_judul_id` (`pengajuan_judul_id`);
