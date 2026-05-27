-- Migration: 2026-05-27_rename_sk_penelitian_filetype.sql
-- Renames file_type enum value SK_PENELITIAN → SK_PENUNJUKAN_PEMBIMBING
-- Step 1: Add the new value alongside the old one so existing rows remain valid
ALTER TABLE pengajuan_sk_penelitian_files
  MODIFY COLUMN file_type ENUM(
    'KRS',
    'REKAP_NILAI',
    'KARTU_KONSULTASI_OUTLINE',
    'FILE_OUTLINE',
    'HALAMAN_PERSETUJUAN',
    'SK_PENELITIAN',
    'SK_PENUNJUKAN_PEMBIMBING',
    'SURAT_KETERANGAN'
  ) NOT NULL;

-- Step 2: Migrate existing rows to the new value
UPDATE pengajuan_sk_penelitian_files
  SET file_type = 'SK_PENUNJUKAN_PEMBIMBING'
  WHERE file_type = 'SK_PENELITIAN';

-- Step 3: Drop the old value from the ENUM now that no rows use it
ALTER TABLE pengajuan_sk_penelitian_files
  MODIFY COLUMN file_type ENUM(
    'KRS',
    'REKAP_NILAI',
    'KARTU_KONSULTASI_OUTLINE',
    'FILE_OUTLINE',
    'HALAMAN_PERSETUJUAN',
    'SK_PENUNJUKAN_PEMBIMBING',
    'SURAT_KETERANGAN'
  ) NOT NULL;
