-- SK VERIFY created skripsi rows without copying perlu_surat_pengantar from the disposisi, so the
-- column stayed 0 and the Sidang Skripsi never required SURAT_KETERANGAN (fixed in
-- skPenelitian.controller.js on 2026-11-24). This copies the student's choice onto existing rows.
-- A pengajuan sidang already submitted or verified is not re-checked; the flag only matters at the
-- next submit/verify (e.g. an ujian ulang).
UPDATE skripsi s
JOIN pengajuan_disposisi_pembimbing pj ON pj.outline_id = s.outline_id
SET s.perlu_surat_pengantar = pj.perlu_surat_pengantar
WHERE s.perlu_surat_pengantar <> pj.perlu_surat_pengantar;
