-- Migration: 2026-05-27_add_surat_penyelesaian_filetype.sql
-- Adds SURAT_PENYELESAIAN_SKRIPSI to the file_type ENUM on pengajuan_sk_penelitian_files
ALTER TABLE pengajuan_sk_penelitian_files
  MODIFY COLUMN file_type ENUM(
    'KRS',
    'REKAP_NILAI',
    'KARTU_KONSULTASI_OUTLINE',
    'FILE_OUTLINE',
    'HALAMAN_PERSETUJUAN',
    'SK_PENUNJUKAN_PEMBIMBING',
    'SURAT_KETERANGAN',
    'SURAT_PENYELESAIAN_SKRIPSI'
  ) NOT NULL;
