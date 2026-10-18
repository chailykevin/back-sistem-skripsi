ALTER TABLE pengajuan_disposisi_pembimbing
  ADD COLUMN nomor_sk_surat_pengantar VARCHAR(255) NULL AFTER perlu_surat_pengantar,
  ADD COLUMN alamat_perusahaan VARCHAR(255) NULL AFTER nama_perusahaan;
