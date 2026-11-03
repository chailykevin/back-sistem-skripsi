-- Seminar Bisnis Digital: set at SK Penelitian VERIFY from mahasiswa.tahap_tugas_akhir. Decides the
-- SK template and the Skep-BD vs Skep-Skripsi numbering, each with its own monthly counter per prodi.

ALTER TABLE pengajuan_sk_penelitian
  ADD COLUMN jenis_sk ENUM('SKRIPSI','SEMINAR_BISNIS_DIGITAL')
    CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT 'SKRIPSI' AFTER status;
