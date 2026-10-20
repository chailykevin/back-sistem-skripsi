-- Migration: 2026-10-20_sk_penelitian_files_transkrip_disposisi_filetype.sql
-- Drops KRS, renames REKAP_NILAI -> TRANSKRIP_NILAI, adds PENGAJUAN_DISPOSISI_PEMBIMBING
-- on pengajuan_sk_penelitian_files.file_type (no existing rows use KRS/REKAP_NILAI)
ALTER TABLE pengajuan_sk_penelitian_files
  MODIFY COLUMN file_type ENUM(
    'PENGAJUAN_DISPOSISI_PEMBIMBING',
    'TRANSKRIP_NILAI',
    'KARTU_KONSULTASI_OUTLINE',
    'FILE_OUTLINE',
    'HALAMAN_PERSETUJUAN',
    'SK_PENUNJUKAN_PEMBIMBING',
    'SURAT_KETERANGAN',
    'SURAT_PENGANTAR_PENELITIAN',
    'SURAT_PENYELESAIAN_SKRIPSI'
  ) NOT NULL;
