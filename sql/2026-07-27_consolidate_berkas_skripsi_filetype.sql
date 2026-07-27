-- Consolidate 11 separate "berkas skripsi" file types into one BERKAS_SKRIPSI type.
-- Student now uploads a single combined document instead of 11 separate files.
-- SURAT_PERNYATAAN_TIDAK_PLAGIAT and the 3 optional types (DAFTAR_LAMPIRAN,
-- HALAMAN_LAMPIRAN, INDEKS) are unaffected.

-- Dev/test data only — clear existing rows under the old types so the ENUM
-- ALTER below doesn't reject them (no data preservation needed for this data).
DELETE FROM pengajuan_sidang_files
WHERE file_type IN (
  'JUDUL_LUAR','JUDUL_DALAM','PERSETUJUAN_UJIAN','ABSTRAK','KATA_PENGANTAR',
  'DAFTAR_ISI','DAFTAR_TABEL','DAFTAR_GAMBAR','BAB_1_5','DAFTAR_PUSTAKA',
  'RIWAYAT_HIDUP'
);

ALTER TABLE pengajuan_sidang_files
  MODIFY COLUMN file_type ENUM(
    'BERKAS_SKRIPSI',
    'DAFTAR_LAMPIRAN','HALAMAN_LAMPIRAN','INDEKS','SURAT_KETERANGAN',
    'SURAT_PERNYATAAN_TIDAK_PLAGIAT',
    'LEMBAR_USULAN_PENGUJI','LEMBAR_PERMOHONAN_UJIAN',
    'PAS_FOTO','KTM','BUKTI_PEMBAYARAN',
    'LEMBAR_KONSULTASI_JURNAL','KARTU_KONSULTASI_SKRIPSI',
    'SK_PENUNJUKAN_PEMBIMBING','REKAP_NILAI',
    'SURAT_PERNYATAAN_PENYELESAIAN','SURAT_PERNYATAAN_PERBAIKAN',
    'SURAT_PERNYATAAN_KELENGKAPAN',
    'KHS_1','KHS_2','KHS_3','KHS_4','KHS_5','KHS_6','KHS_7','KHS_8',
    'FOTOCOPY_KONVERSI','BUKTI_HADIR_SIDANG','KARTU_KONSULTASI_PA',
    'KARTU_PRAKTIKUM','SERTIFIKAT_POINT',
    'SURAT_UNDANGAN_SIDANG'
  ) NOT NULL;
