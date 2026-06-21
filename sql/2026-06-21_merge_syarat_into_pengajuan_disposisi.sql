ALTER TABLE pengajuan_disposisi_pembimbing
  ADD COLUMN syarat_transkrip              TINYINT(1) NOT NULL DEFAULT 0,
  ADD COLUMN syarat_krs                    TINYINT(1) NOT NULL DEFAULT 0,
  ADD COLUMN syarat_metodologi_nilai_min_c TINYINT(1) NOT NULL DEFAULT 0;

UPDATE pengajuan_disposisi_pembimbing pdp
JOIN pengajuan_disposisi_pembimbing_syarat s
  ON s.pengajuan_disposisi_pembimbing_id = pdp.id
SET
  pdp.syarat_transkrip              = s.syarat_transkrip,
  pdp.syarat_krs                    = s.syarat_krs,
  pdp.syarat_metodologi_nilai_min_c = s.syarat_metodologi_nilai_min_c;

DROP TABLE pengajuan_disposisi_pembimbing_syarat;
