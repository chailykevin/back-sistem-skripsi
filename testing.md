# Pengujian Sistem Skripsi

## a. Pengujian Fitur Login

Tabel 4.1
Pengujian Fitur Login

| No | Skenario Pengujian | Data Uji (Input) | Hasil Harapan | Status |
|----|-------------------|-----------------|---------------|--------|
| 1 | Melakukan login dengan akun mahasiswa valid. | Username: 22421562<br>Password: 123 | Sistem berhasil autentikasi dan mengarahkan ke dashboard mahasiswa. | Valid |
| 2 | Melakukan login dengan akun kaprodi valid. | Username: susan_kaprodi<br>Password: 123 | Sistem berhasil autentikasi dan mengarahkan ke dashboard kaprodi. | Valid |
| 3 | Melakukan login dengan akun sekretariat valid. | Username: antonius_sekretariat<br>Password: 123 | Sistem berhasil autentikasi dan mengarahkan ke dashboard sekretariat. | Valid |
| 4 | Melakukan login dengan akun dosen valid. | Username: riyadi<br>Password: 123 | Sistem berhasil autentikasi dan mengarahkan ke dashboard dosen. | Valid |
| 5 | Melakukan login dengan username yang tidak terdaftar. | Username: mahasiswa999<br>Password: 123 | Sistem menolak login dan menampilkan pesan kesalahan. | Valid |
| 6 | Melakukan login dengan password yang salah. | Username: 22421562<br>Password: wrongpass | Sistem menolak login dan menampilkan pesan kesalahan. | Valid |

## b. Pengujian Fitur Pengajuan Outline

Tabel 4.2
Pengujian Fitur Pengajuan Outline

| No | Skenario Pengujian | Data Uji (Input) | Hasil Harapan | Status |
|----|-------------------|-----------------|---------------|--------|
| 1 | Mahasiswa mengajukan outline pada saat periode pengajuan sedang dibuka. | Judul, latar belakang, dan file outline diunggah oleh akun 22421562. | Sistem menyimpan pengajuan dengan status SUBMITTED dan mengirim notifikasi kepada kaprodi. | Valid |
| 2 | Mahasiswa mengajukan outline di luar periode pengajuan yang aktif. | Pengajuan dilakukan saat tidak ada periode yang sedang dibuka. | Sistem menolak pengajuan dan menampilkan pesan bahwa periode tidak sedang dibuka. | Valid |
| 3 | Mahasiswa mengajukan outline kedua saat masih memiliki outline aktif. | Akun 22421562 mencoba mengajukan outline baru saat outline sebelumnya masih berstatus SUBMITTED. | Sistem menolak pengajuan dan menampilkan pesan konflik. | Valid |
| 4 | Kaprodi menerima pengajuan outline mahasiswa. | Kaprodi (susan_kaprodi) memilih aksi ACCEPTED pada outline yang diajukan. | Sistem memperbarui status outline menjadi ACCEPTED dan mengirim notifikasi kepada mahasiswa. | Valid |
| 5 | Kaprodi meminta revisi pada pengajuan outline mahasiswa. | Kaprodi (susan_kaprodi) memilih aksi NEED_REVISION disertai catatan revisi. | Sistem memperbarui status outline menjadi NEED_REVISION dan mengirim notifikasi kepada mahasiswa. | Valid |
| 6 | Kaprodi menolak pengajuan outline mahasiswa. | Kaprodi (susan_kaprodi) memilih aksi REJECTED disertai catatan. | Sistem memperbarui status outline menjadi REJECTED dan mengirim notifikasi kepada mahasiswa. | Valid |
| 7 | Mahasiswa mengajukan ulang outline setelah diminta revisi. | Akun 22421562 mengunggah file outline yang telah diperbaiki. | Sistem memperbarui pengajuan dengan status SUBMITTED kembali dan mengirim notifikasi kepada kaprodi. | Valid |

## c. Pengujian Fitur Pengajuan Disposisi Pembimbing

Tabel 4.3
Pengujian Fitur Pengajuan Disposisi Pembimbing

| No | Skenario Pengujian | Data Uji (Input) | Hasil Harapan | Status |
|----|-------------------|-----------------|---------------|--------|
| 1 | Mahasiswa mengajukan disposisi pembimbing dengan data lengkap. | Akun 22421562 mengisi judul, calon pembimbing 1 dan 2, serta kelengkapan syarat administrasi. | Sistem menyimpan pengajuan, membangkitkan formulir disposisi secara otomatis, dan mengirim notifikasi kepada kaprodi. | Valid |
| 2 | Kaprodi menyetujui pengajuan disposisi dan menetapkan dosen pembimbing. | Kaprodi (susan_kaprodi) memilih aksi APPROVED dan menetapkan dosen pembimbing 1 dan 2. | Sistem memperbarui status menjadi APPROVED, memperbarui formulir dengan keputusan dan tanda tangan kaprodi, lalu mengirim notifikasi kepada mahasiswa. | Valid |
| 3 | Kaprodi meminta revisi pada pengajuan disposisi. | Kaprodi (susan_kaprodi) memilih aksi NEED_REVISION disertai catatan. | Sistem memperbarui status menjadi NEED_REVISION dan mengirim notifikasi kepada mahasiswa. | Valid |
| 4 | Kaprodi menolak pengajuan disposisi. | Kaprodi (susan_kaprodi) memilih aksi REJECTED disertai catatan. | Sistem memperbarui status menjadi REJECTED dan mengirim notifikasi kepada mahasiswa. | Valid |
| 5 | Mahasiswa mengajukan ulang disposisi setelah diminta revisi. | Akun 22421562 memperbaiki data dan mengajukan ulang. | Sistem memperbarui pengajuan dengan status SUBMITTED kembali, membangkitkan ulang formulir disposisi, dan mengirim notifikasi kepada kaprodi. | Valid |

## d. Pengujian Fitur Konsultasi Outline

Tabel 4.4
Pengujian Fitur Konsultasi Outline

| No | Skenario Pengujian | Data Uji (Input) | Hasil Harapan | Status |
|----|-------------------|-----------------|---------------|--------|
| 1 | Mahasiswa menginisiasi konsultasi outline dan mengunggah file ke Pembimbing 2. | Akun 22421562 mengunggah file outline pada tahap Pembimbing 2. | Sistem menyimpan unggahan dan mengirim notifikasi kepada Pembimbing 2. | Valid |
| 2 | Pembimbing 2 meminta mahasiswa melakukan perbaikan. | Dosen pembimbing 2 memilih aksi NEED_REVISION disertai catatan. | Sistem memperbarui status tahap menjadi NEED_REVISION dan mengirim notifikasi kepada mahasiswa. | Valid |
| 3 | Pembimbing 2 menyetujui dan meneruskan ke Pembimbing 1. | Dosen pembimbing 2 memilih aksi CONTINUE. | Sistem membuat tahap baru untuk Pembimbing 1 dan mengirim notifikasi kepada Pembimbing 1. | Valid |
| 4 | Mahasiswa mengunggah file outline kepada Pembimbing 1. | Akun 22421562 mengunggah file pada tahap Pembimbing 1. | Sistem menyimpan unggahan dan mengirim notifikasi kepada Pembimbing 1. | Valid |
| 5 | Pembimbing 1 meminta mahasiswa melakukan perbaikan. | Dosen pembimbing 1 memilih aksi NEED_REVISION disertai catatan. | Sistem memperbarui status tahap menjadi NEED_REVISION dan mengirim notifikasi kepada mahasiswa. | Valid |
| 6 | Pembimbing 1 menyetujui outline dan menyelesaikan konsultasi. | Dosen pembimbing 1 memilih aksi ACCEPTED. | Sistem menandai kartu konsultasi outline sebagai selesai, membangkitkan dokumen kartu konsultasi secara otomatis, dan mengirim notifikasi kepada mahasiswa. | Valid |

## e. Pengujian Fitur Halaman Persetujuan Judul

Tabel 4.5
Pengujian Fitur Halaman Persetujuan Judul

| No | Skenario Pengujian | Data Uji (Input) | Hasil Harapan | Status |
|----|-------------------|-----------------|---------------|--------|
| 1 | Sistem menerbitkan halaman persetujuan judul secara otomatis setelah konsultasi outline selesai. | Pembimbing 1 menyetujui outline (tahap akhir konsultasi outline). | Sistem secara otomatis mengambil tanda tangan mahasiswa, kedua pembimbing, dan kaprodi, lalu membangkitkan dokumen halaman persetujuan judul tanpa tindakan manual. | Valid |
| 2 | Halaman persetujuan judul tetap dapat diterbitkan meskipun salah satu tanda tangan belum tersimpan. | Salah satu pihak belum menyimpan tanda tangan digital di akunnya. | Sistem tetap membangkitkan dokumen dengan kolom tanda tangan yang bersangkutan dikosongkan. | Valid |

## f. Pengujian Fitur Pengajuan SK Penelitian

Tabel 4.6
Pengujian Fitur Pengajuan SK Penelitian

| No | Skenario Pengujian | Data Uji (Input) | Hasil Harapan | Status |
|----|-------------------|-----------------|---------------|--------|
| 1 | Mahasiswa menginisiasi pengajuan SK Penelitian setelah konsultasi outline selesai. | Akun 22421562 memanggil endpoint init SK Penelitian. | Sistem membuat draft pengajuan SK dan secara otomatis melampirkan halaman persetujuan judul yang telah diterbitkan sebelumnya. | Valid |
| 2 | Mahasiswa mengunggah rekap nilai dan mengajukan SK Penelitian. | Akun 22421562 mengunggah file rekap nilai lalu memilih submit. | Sistem menarik KRS, kartu konsultasi outline, dan file outline secara otomatis, lalu memperbarui status menjadi SUBMITTED dan mengirim notifikasi kepada sekretariat. | Valid |
| 3 | Sekretariat memverifikasi berkas individual. | Sekretariat (antonius_sekretariat) memperbarui status salah satu berkas menjadi VERIFIED. | Sistem memperbarui status berkas yang bersangkutan tanpa mengubah status induk pengajuan. | Valid |
| 4 | Sekretariat meminta reupload pada berkas yang tidak memenuhi syarat. | Sekretariat (antonius_sekretariat) memperbarui status berkas menjadi NEED_REUPLOAD. | Sistem memperbarui status berkas dan mengirim notifikasi kepada mahasiswa. | Valid |
| 5 | Sekretariat memverifikasi keseluruhan pengajuan setelah semua berkas terverifikasi. | Sekretariat (antonius_sekretariat) memilih aksi VERIFY. | Sistem memperbarui status menjadi COMPLETED, menerbitkan SK Penunjukan Pembimbing dan Surat Penyelesaian Skripsi secara otomatis, lalu membuat record skripsi bagi mahasiswa. | Valid |
| 6 | Sekretariat memverifikasi pengajuan saat masih ada berkas yang belum terverifikasi. | Sekretariat (antonius_sekretariat) memilih aksi VERIFY sebelum semua berkas berstatus VERIFIED. | Sistem menolak aksi dan menampilkan pesan bahwa masih ada berkas yang belum terverifikasi. | Valid |
| 7 | Sekretariat meminta revisi keseluruhan pengajuan. | Sekretariat (antonius_sekretariat) memilih aksi NEED_REVISION disertai catatan. | Sistem memperbarui status menjadi NEED_REVISION dan mengirim notifikasi kepada mahasiswa. | Valid |

## g. Pengujian Fitur Konsultasi Skripsi

Tabel 4.7
Pengujian Fitur Konsultasi Skripsi

| No | Skenario Pengujian | Data Uji (Input) | Hasil Harapan | Status |
|----|-------------------|-----------------|---------------|--------|
| 1 | Mahasiswa menginisiasi konsultasi skripsi setelah SK Penelitian diverifikasi. | Akun 22421562 memanggil endpoint init konsultasi skripsi. | Sistem membuat kartu konsultasi skripsi dan tahap awal untuk Bab 1 & 2 kepada Pembimbing 2. | Valid |
| 2 | Mahasiswa mengunggah file Bab 1 & 2 kepada Pembimbing 2. | Akun 22421562 mengunggah file bab 1 & 2. | Sistem menyimpan unggahan dan mengirim notifikasi kepada Pembimbing 2. | Valid |
| 3 | Pembimbing 2 meminta perbaikan pada Bab 1 & 2. | Dosen pembimbing 2 memilih aksi NEED_REVISION disertai catatan. | Sistem memperbarui status tahap menjadi NEED_REVISION dan mengirim notifikasi kepada mahasiswa. | Valid |
| 4 | Pembimbing 2 menyetujui Bab 1 & 2 dan meneruskan ke Pembimbing 1. | Dosen pembimbing 2 memilih aksi CONTINUE. | Sistem membuat tahap baru untuk Pembimbing 1 pada kelompok bab yang sama. | Valid |
| 5 | Pembimbing 1 menyetujui Bab 1 & 2 dan membuka kelompok bab berikutnya. | Dosen pembimbing 1 memilih aksi ACCEPTED pada Bab 1 & 2. | Sistem membuat tahap Pembimbing 2 untuk Bab 3 dan mengirim notifikasi kepada mahasiswa. | Valid |
| 6 | Mahasiswa mencoba mengunggah Bab 3 sebelum Bab 1 & 2 disetujui. | Akun 22421562 mencoba mengunggah file Bab 3 saat tahap Bab 1 & 2 belum selesai. | Sistem menolak unggahan dan menampilkan pesan bahwa kelompok bab sebelumnya belum diselesaikan. | Valid |
| 7 | Seluruh bab (Bab 1–5) selesai disetujui oleh kedua pembimbing. | Pembimbing 1 menyetujui Bab 5 (tahap akhir). | Sistem menandai kartu konsultasi skripsi sebagai selesai, membangkitkan dokumen kartu konsultasi skripsi secara otomatis, dan memperbarui status skripsi menjadi COMPLETED. | Valid |

## h. Pengujian Fitur Pengajuan Sidang

Tabel 4.8
Pengujian Fitur Pengajuan Sidang

| No | Skenario Pengujian | Data Uji (Input) | Hasil Harapan | Status |
|----|-------------------|-----------------|---------------|--------|
| 1 | Mahasiswa menginisiasi pengajuan sidang ke kaprodi setelah skripsi selesai. | Akun 22421562 memanggil endpoint init pengajuan sidang kaprodi. | Sistem membuat draft pengajuan sidang kaprodi dan secara otomatis melampirkan kartu konsultasi skripsi serta SK penunjukan pembimbing. | Valid |
| 2 | Mahasiswa mengisi data diri dan mengajukan ke kaprodi. | Akun 22421562 mengisi seluruh field wajib (IPK, semester, penguji usulan, dll.) lalu memilih submit. | Sistem memperbarui status menjadi SUBMITTED, membangkitkan dokumen Lembar Usulan Penguji dan Lembar Permohonan Ujian secara otomatis, lalu mengirim notifikasi kepada kaprodi. | Valid |
| 3 | Kaprodi memverifikasi berkas konten skripsi. | Kaprodi (susan_kaprodi) memperbarui kaprodi_status salah satu berkas menjadi VERIFIED. | Sistem memperbarui kaprodi_status berkas yang bersangkutan. | Valid |
| 4 | Kaprodi menyatakan pengajuan valid setelah semua berkas wajib terverifikasi. | Kaprodi (susan_kaprodi) memilih aksi VALID. | Sistem memperbarui status pengajuan kaprodi menjadi VALID dan mengirim notifikasi kepada mahasiswa. | Valid |
| 5 | Kaprodi meminta revisi pada pengajuan sidang. | Kaprodi (susan_kaprodi) memilih aksi NEED_REVISION disertai catatan. | Sistem memperbarui status menjadi NEED_REVISION dan mengirim notifikasi kepada mahasiswa. | Valid |
| 6 | Mahasiswa mengajukan berkas administrasi kepada sekretariat. | Akun 22421562 mengunggah berkas administrasi yang diperlukan lalu memilih submit ke sekretariat. | Sistem memperbarui status pengajuan sidang menjadi SUBMITTED dan mengirim notifikasi kepada sekretariat. | Valid |
| 7 | Sekretariat memverifikasi keseluruhan berkas administrasi. | Sekretariat (antonius_sekretariat) memilih aksi VERIFY setelah semua berkas berstatus VERIFIED. | Sistem memperbarui status menjadi WAITING_FOR_DISPOSISI dan mengirim notifikasi kepada mahasiswa dan kaprodi. | Valid |
| 8 | Kaprodi mengirimkan disposisi jadwal dan susunan penguji. | Kaprodi (susan_kaprodi) mengisi jadwal sidang dan penguji lalu mengirim disposisi. | Sistem memperbarui status menjadi WAITING_FOR_SURAT dan mengirim notifikasi kepada sekretariat. | Valid |
| 9 | Sekretariat menerbitkan surat undangan sidang. | Sekretariat (antonius_sekretariat) memanggil endpoint generate surat undangan. | Sistem membangkitkan surat undangan, memperbarui status menjadi COMPLETED, membuat record sidang secara otomatis, dan mengirimkan surat undangan kepada seluruh peserta melalui email. | Valid |
| 10 | Mahasiswa mencoba mengajukan sidang di luar periode pengajuan yang aktif. | Akun 22421562 memanggil endpoint init pengajuan sidang saat tidak ada periode aktif. | Sistem menolak pengajuan dan menampilkan pesan bahwa tidak ada periode pengajuan sidang yang sedang dibuka. | Valid |

## i. Pengujian Fitur Pelaksanaan Sidang

Tabel 4.9
Pengujian Fitur Pelaksanaan Sidang

| No | Skenario Pengujian | Data Uji (Input) | Hasil Harapan | Status |
|----|-------------------|-----------------|---------------|--------|
| 1 | Pembimbing 1 memulai sidang. | Dosen pembimbing 1 (susan atau riyadi sesuai data) memanggil endpoint start sidang. | Sistem memperbarui status sidang menjadi ONGOING dan mengirim notifikasi kepada mahasiswa serta seluruh peserta. | Valid |
| 2 | Penguji mencoba mengisi notulen sebelum sidang dimulai. | Dosen penguji memanggil endpoint notulen saat status sidang masih SCHEDULED. | Sistem menolak aksi dan menampilkan pesan bahwa sidang belum dimulai. | Valid |
| 3 | Penguji 1 mengisi catatan dan keputusan kelulusan. | Dosen penguji 1 mengisi catatan dan memilih hasilSidang LULUS. | Sistem menyimpan notulen dan membangkitkan dokumen notulen penguji, lalu mengirim notifikasi kepada Pembimbing 1. | Valid |
| 4 | Penguji 2 mengisi catatan dan keputusan kelulusan. | Dosen penguji 2 mengisi catatan dan memilih hasilSidang LULUS. | Sistem menyimpan notulen dan membangkitkan dokumen notulen penguji, lalu mengirim notifikasi kepada Pembimbing 1. | Valid |
| 5 | Seluruh peserta mengisi penilaian komponen sidang. | Keempat peserta (pembimbing 1, pembimbing 2, penguji 1, penguji 2) masing-masing mengisi nilai setiap komponen. | Sistem menyimpan penilaian dan membangkitkan dokumen komponen penilaian untuk masing-masing peserta. | Valid |
| 6 | Pembimbing 1 merekap hasil dan menetapkan hasil akhir sidang. | Dosen pembimbing 1 memanggil endpoint hasil penilaian dengan hasilSidang LULUS dan catatan penguji. | Sistem menghitung rata-rata nilai, menentukan grade, membangkitkan dokumen hasil penilaian akhir dan berita acara, memperbarui status sidang menjadi COMPLETED, serta mengirim notifikasi kepada seluruh peserta. | Valid |
| 7 | Pembimbing 1 merekap hasil dengan keputusan TIDAK_LULUS. | Dosen pembimbing 1 memilih hasilSidang TIDAK_LULUS. | Sistem memperbarui status sidang menjadi COMPLETED, mengirim notifikasi TIDAK_LULUS kepada mahasiswa dan seluruh peserta, lalu secara otomatis membuat record revisi pasca sidang. | Valid |
| 8 | Pembimbing 1 merekap hasil dengan keputusan GAGAL (plagiarisme). | Dosen pembimbing 1 memilih hasilSidang GAGAL. | Sistem memperbarui status skripsi menjadi GAGAL, mengirim notifikasi GAGAL kepada mahasiswa, dan tidak membuat record revisi pasca sidang. | Valid |
| 9 | Pembimbing 1 mencoba merekap hasil sebelum semua peserta mengisi penilaian. | Dosen pembimbing 1 memanggil endpoint hasil penilaian saat masih ada penilaian yang belum diisi. | Sistem menolak aksi dan menampilkan pesan bahwa belum semua penilaian terisi. | Valid |

## j. Pengujian Fitur Revisi Pasca Sidang

Tabel 4.10
Pengujian Fitur Revisi Pasca Sidang

| No | Skenario Pengujian | Data Uji (Input) | Hasil Harapan | Status |
|----|-------------------|-----------------|---------------|--------|
| 1 | Mahasiswa menginisiasi revisi pasca sidang. | Akun 22421562 memanggil endpoint init revisi pasca sidang. | Sistem mengembalikan record revisi yang telah dibuat otomatis dan memastikan tahap Penguji 2 sudah tersedia. | Valid |
| 2 | Mahasiswa mengunggah file revisi kepada Penguji 2. | Akun 22421562 mengunggah file revisi pada tahap aktif (Penguji 2). | Sistem menyimpan unggahan, memperbarui status tahap menjadi SUBMITTED, dan mengirim notifikasi kepada Penguji 2. | Valid |
| 3 | Penguji 2 meminta perbaikan lebih lanjut. | Dosen penguji 2 memilih aksi NEED_REVISION disertai catatan. | Sistem memperbarui status tahap menjadi NEED_REVISION dan mengirim notifikasi kepada mahasiswa. | Valid |
| 4 | Penguji 2 menyetujui revisi dan meneruskan ke Penguji 1. | Dosen penguji 2 memilih aksi APPROVED. | Sistem mencatat waktu selesai tahap Penguji 2, memperbarui notulen Penguji 2 dengan tanda tangan, membuat tahap Penguji 1, dan mengirim notifikasi kepada mahasiswa. | Valid |
| 5 | Proses revisi berlanjut melalui Penguji 1, Pembimbing 2, hingga Pembimbing 1. | Masing-masing penandatangan menyetujui revisi secara berurutan. | Sistem membuat tahap berikutnya secara otomatis setiap kali satu tahap disetujui, hingga seluruh rantai selesai. | Valid |
| 6 | Pembimbing 1 menyetujui revisi sebagai tahap terakhir (hasil sidang LULUS). | Dosen pembimbing 1 memilih aksi APPROVED pada tahap terakhir. | Sistem menandai revisi sebagai selesai, membangkitkan Halaman Pengesahan Majelis Penguji dan Halaman Pengesahan Dekan, lalu mengirim notifikasi kepada mahasiswa. | Valid |
| 7 | Penandatangan yang tidak aktif mencoba mengisi review. | Dosen yang bukan penandatangan aktif memanggil endpoint review. | Sistem menolak aksi dan menampilkan pesan tidak diizinkan. | Valid |

## k. Pengujian Fitur Pengumpulan Berkas Final

Tabel 4.11
Pengujian Fitur Pengumpulan Berkas Final

| No | Skenario Pengujian | Data Uji (Input) | Hasil Harapan | Status |
|----|-------------------|-----------------|---------------|--------|
| 1 | Mahasiswa menginisiasi pengumpulan berkas final setelah revisi pasca sidang selesai. | Akun 22421562 memanggil endpoint init pengumpulan berkas final. | Sistem membuat record pengumpulan berkas dengan status DRAFT dan enam baris konfirmasi penerima. | Valid |
| 2 | Mahasiswa mengunggah file skripsi dan artikel penelitian lalu mengajukan. | Akun 22421562 mengunggah FILE_SKRIPSI dan ARTIKEL_PENELITIAN kemudian memilih submit. | Sistem memperbarui status menjadi SUBMITTED dan mengirim notifikasi kepada seluruh penerima. | Valid |
| 3 | Penerima individu (perpustakaan) mengonfirmasi penerimaan berkas. | Akun perpustakaan memanggil endpoint confirm. | Sistem mencatat waktu konfirmasi penerima yang bersangkutan. | Valid |
| 4 | Penerima individu (LPPM) mengonfirmasi penerimaan berkas. | Akun lppm memanggil endpoint confirm. | Sistem mencatat waktu konfirmasi penerima yang bersangkutan. | Valid |
| 5 | Dosen pembimbing dan penguji mengonfirmasi penerimaan berkas. | Keempat dosen (pembimbing 1, pembimbing 2, penguji 1, penguji 2) masing-masing memanggil endpoint confirm. | Sistem mencatat waktu konfirmasi masing-masing penerima. | Valid |
| 6 | Semua penerima telah mengonfirmasi dan sistem menerbitkan surat pernyataan penyerahan. | Konfirmasi keenam penerima telah tercatat. | Sistem secara otomatis membangkitkan surat pernyataan penyerahan yang memuat tanda tangan seluruh penerima, lalu memperbarui status menjadi WAITING_SIGNATURE. | Valid |
| 7 | Sekretaris prodi mengesahkan surat pernyataan penyerahan. | Akun hendro_sekprodi memanggil endpoint sign. | Sistem membangkitkan ulang dokumen dengan tanda tangan sekretaris prodi dan memperbarui status menjadi COMPLETED. | Valid |
| 8 | Mahasiswa mencoba menginisiasi pengumpulan berkas sebelum revisi pasca sidang selesai. | Akun 22421562 memanggil endpoint init saat is_completed revisi masih 0. | Sistem menolak aksi dan menampilkan pesan bahwa prasyarat belum terpenuhi. | Valid |

## l. Pengujian Fitur Notifikasi

Tabel 4.12
Pengujian Fitur Notifikasi

| No | Skenario Pengujian | Data Uji (Input) | Hasil Harapan | Status |
|----|-------------------|-----------------|---------------|--------|
| 1 | Pengguna mengakses daftar notifikasi miliknya. | Akun 22421562 memanggil endpoint GET /notifications. | Sistem mengembalikan maksimal 50 notifikasi terbaru yang dimiliki akun tersebut, diurutkan dari yang terbaru. | Valid |
| 2 | Notifikasi dikirimkan secara otomatis saat terjadi perubahan status pengajuan. | Kaprodi menyetujui pengajuan outline milik akun 22421562. | Sistem secara otomatis menyisipkan notifikasi baru ke dalam daftar notifikasi akun 22421562. | Valid |
| 3 | Pengguna menandai notifikasi sebagai telah dibaca. | Akun 22421562 memanggil endpoint POST /notifications/:id/read pada salah satu notifikasi. | Sistem memperbarui is_read menjadi 1 pada notifikasi yang bersangkutan. | Valid |
| 4 | Pengguna tidak dapat mengakses notifikasi milik pengguna lain. | Akun 22421562 mencoba memanggil endpoint read pada id notifikasi milik akun lain. | Sistem menolak aksi dan menampilkan pesan tidak diizinkan. | Valid |

## m. Pengujian Fitur Pengelolaan Periode Pengajuan Outline

Tabel 4.13
Pengujian Fitur Pengelolaan Periode Pengajuan Outline

| No | Skenario Pengujian | Data Uji (Input) | Hasil Harapan | Status |
|----|-------------------|-----------------|---------------|--------|
| 1 | Admin menambahkan periode pengajuan outline baru. | Tahun akademik: 2024/2025, Semester: GANJIL, Tanggal buka dan tutup diisi. | Sistem menyimpan periode baru ke database. | Valid |
| 2 | Admin mengubah tanggal tutup pada periode yang sudah ada. | Admin memperbarui close_at periode yang dipilih. | Sistem memperbarui data periode yang bersangkutan. | Valid |
| 3 | Admin menghapus periode yang belum memiliki pengajuan terhubung. | Admin memanggil endpoint DELETE pada periode tanpa outline terhubung. | Sistem menghapus periode dari database. | Valid |
| 4 | Admin menghapus periode yang sudah memiliki pengajuan outline terhubung. | Admin memanggil endpoint DELETE pada periode yang sudah direferensikan oleh minimal satu outline. | Sistem menolak penghapusan dan menampilkan pesan konflik. | Valid |
| 5 | Mahasiswa mengajukan outline saat periode sedang aktif. | Pengajuan dilakukan saat waktu server berada di antara open_at dan close_at periode aktif. | Sistem mengizinkan pengajuan dan menautkan outline ke periode yang sedang aktif. | Valid |
| 6 | Mahasiswa mengajukan outline saat tidak ada periode yang aktif. | Pengajuan dilakukan di luar rentang waktu semua periode yang ada. | Sistem menolak pengajuan dan menampilkan pesan bahwa tidak ada periode yang sedang dibuka. | Valid |

## n. Pengujian Fitur Pengelolaan Periode Pengajuan Sidang

Tabel 4.14
Pengujian Fitur Pengelolaan Periode Pengajuan Sidang

| No | Skenario Pengujian | Data Uji (Input) | Hasil Harapan | Status |
|----|-------------------|-----------------|---------------|--------|
| 1 | Admin menambahkan periode pengajuan sidang baru. | Tahun akademik: 2024/2025, Semester: GENAP, Tanggal buka dan tutup diisi. | Sistem menyimpan periode baru ke database. | Valid |
| 2 | Admin mengubah tanggal tutup pada periode yang sudah ada. | Admin memperbarui close_at periode yang dipilih. | Sistem memperbarui data periode yang bersangkutan. | Valid |
| 3 | Admin menghapus periode yang belum memiliki pengajuan terhubung. | Admin memanggil endpoint DELETE pada periode tanpa pengajuan sidang terhubung. | Sistem menghapus periode dari database. | Valid |
| 4 | Admin menghapus periode yang sudah memiliki pengajuan sidang terhubung. | Admin memanggil endpoint DELETE pada periode yang sudah direferensikan oleh minimal satu pengajuan sidang. | Sistem menolak penghapusan dan menampilkan pesan konflik. | Valid |
| 5 | Mahasiswa mengajukan sidang pertama kali saat periode sedang aktif. | Akun 22421562 memanggil endpoint init pengajuan sidang (ujian_ke = 1) saat periode aktif. | Sistem mengizinkan pengajuan dan menautkan pengajuan sidang ke periode yang sedang aktif. | Valid |
| 6 | Mahasiswa mengajukan ulang sidang (ujian ulang) saat tidak ada periode aktif. | Akun 22421562 melanjutkan alur ujian ulang (ujian_ke > 1) saat tidak ada periode aktif. | Sistem mengizinkan pengajuan ujian ulang tanpa memeriksa periode aktif. | Valid |

## o. Pengujian Fitur Manajemen Tanda Tangan

Tabel 4.15
Pengujian Fitur Manajemen Tanda Tangan

| No | Skenario Pengujian | Data Uji (Input) | Hasil Harapan | Status |
|----|-------------------|-----------------|---------------|--------|
| 1 | Pengguna menyimpan tanda tangan digital untuk pertama kali. | Akun 22421562 mengirim data base64 tanda tangan melalui endpoint POST /users/me/signature. | Sistem menyimpan tanda tangan ke kolom signature_image pada tabel users. | Valid |
| 2 | Pengguna memperbarui tanda tangan yang sudah tersimpan. | Akun 22421562 mengirim data base64 tanda tangan baru melalui endpoint POST /users/me/signature. | Sistem menimpa tanda tangan lama dengan tanda tangan baru. | Valid |
| 3 | Pengguna melihat status tanda tangan yang tersimpan. | Akun 22421562 memanggil endpoint GET /users/me/signature. | Sistem mengembalikan hasSignature: true dan data tanda tangan jika tersimpan, atau hasSignature: false jika belum ada. | Valid |
| 4 | Pengguna menghapus tanda tangan yang tersimpan. | Akun 22421562 memanggil endpoint DELETE /users/me/signature. | Sistem mengosongkan kolom signature_image dan mengembalikan hasSignature: false pada pemanggilan berikutnya. | Valid |
| 5 | Tanda tangan digunakan secara otomatis saat sistem menerbitkan dokumen resmi. | Akun riyadi (pembimbing 1) telah menyimpan tanda tangan, kemudian Pembimbing 1 menyetujui konsultasi outline. | Sistem membangkitkan kartu konsultasi outline dengan tanda tangan pembimbing 1 tertanam di dokumen tanpa tindakan manual. | Valid |
| 6 | Sistem tetap menerbitkan dokumen meskipun tanda tangan salah satu pihak belum tersimpan. | Salah satu pihak belum menyimpan tanda tangan saat dokumen akan dibangkitkan. | Sistem membangkitkan dokumen dengan kolom tanda tangan pihak yang bersangkutan dikosongkan tanpa menghentikan proses. | Valid |
