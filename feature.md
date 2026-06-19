# Fitur-Fitur Sistem Skripsi

1. Fitur Login

   Fitur ini memungkinkan pengguna untuk masuk ke dalam sistem menggunakan nama pengguna dan kata sandi. Sistem memverifikasi identitas pengguna, kemudian memeriksa peran yang dimiliki akun tersebut. Setelah berhasil masuk, sistem menerbitkan token sesi yang digunakan untuk mengakses fitur-fitur lain sesuai peran pengguna.
2. Fitur Pengajuan Outline

   Fitur ini memungkinkan mahasiswa mengajukan outline skripsi beserta judul, latar belakang, dan file dokumen outline kepada kaprodi untuk ditinjau. Kaprodi dapat menerima, meminta revisi, atau menolak pengajuan tersebut. Apabila outline memerlukan revisi atau ditolak, mahasiswa dapat mengajukan ulang dengan dokumen yang telah diperbaiki. Sistem hanya mengizinkan satu outline aktif per mahasiswa pada satu waktu.
3. Fitur Pengajuan Disposisi Pembimbing

   Fitur ini memungkinkan mahasiswa mengajukan calon dosen pembimbing yang diinginkan beserta kelengkapan syarat administrasi seperti transkrip, KRS, dan metodologi. Sistem secara otomatis menerbitkan formulir pengajuan disposisi yang memuat data mahasiswa dan tanda tangannya. Kaprodi meninjau kelengkapan syarat dan menetapkan dosen pembimbing yang definitif, kemudian sistem memperbarui formulir dengan keputusan dan tanda tangan kaprodi. Apabila pengajuan memerlukan revisi, mahasiswa dapat mengajukan ulang.
4. Fitur Konsultasi Outline

   Fitur ini mengelola proses bimbingan outline antara mahasiswa dan kedua dosen pembimbing. Mahasiswa mengunggah file outline kepada Pembimbing 2 terlebih dahulu, kemudian setelah disetujui dilanjutkan kepada Pembimbing 1. Setiap pembimbing dapat meminta mahasiswa untuk melakukan perbaikan sebelum memberikan persetujuan. Setelah Pembimbing 1 menyetujui, sistem secara otomatis menerbitkan kartu konsultasi outline sebagai bukti selesainya proses bimbingan outline.
5. Fitur Halaman Persetujuan Judul

   Fitur ini menerbitkan halaman persetujuan judul desain skripsi setelah konsultasi outline selesai. Sistem secara otomatis mengambil tanda tangan mahasiswa, kedua pembimbing, dan kaprodi yang telah tersimpan, lalu menerbitkan dokumen persetujuan tanpa memerlukan tindakan manual dari pihak mana pun. Apabila salah satu tanda tangan belum tersimpan, penerbitan dokumen dapat dilakukan secara manual setelah tanda tangan dilengkapi.
6. Fitur Pengajuan SK Penelitian

   Fitur ini memungkinkan mahasiswa mengajukan permohonan Surat Keputusan Penelitian kepada sekretariat. Mahasiswa mengunggah rekap nilai, sedangkan dokumen lainnya seperti KRS, kartu konsultasi outline, file outline, dan halaman persetujuan judul ditarik otomatis oleh sistem dari tahap-tahap sebelumnya. Sekretariat meninjau setiap berkas secara individual, lalu memverifikasi keseluruhan pengajuan. Setelah diverifikasi, sistem secara otomatis menerbitkan SK Penunjukan Pembimbing, Surat Penyelesaian Skripsi, dan apabila diperlukan, Surat Keterangan untuk penelitian di perusahaan.
7. Fitur Konsultasi Skripsi

   Fitur ini mengelola proses bimbingan penulisan bab-bab skripsi antara mahasiswa dan kedua dosen pembimbing. Mahasiswa mengunggah bab secara bertahap mengikuti urutan yang ditentukan, yaitu Bab 1 dan 2, Bab 3, Bab 4, lalu Bab 5. Setiap kelompok bab harus disetujui oleh Pembimbing 2 kemudian Pembimbing 1 sebelum mahasiswa dapat melanjutkan ke bab berikutnya. Setelah seluruh bab disetujui, sistem secara otomatis menerbitkan kartu konsultasi skripsi dan menandai skripsi sebagai selesai ditulis.
8. Fitur Pengajuan Sidang

   Fitur ini mengelola proses administrasi sebelum sidang skripsi dilaksanakan. Mahasiswa mengajukan berkas konten skripsi kepada kaprodi untuk diperiksa kelengkapannya, kemudian mengajukan berkas administrasi kepada sekretariat. Setelah sekretariat memverifikasi seluruh berkas, kaprodi mengirimkan disposisi yang memuat jadwal dan susunan penguji. Sekretariat kemudian menerbitkan surat undangan sidang yang dikirimkan kepada seluruh peserta, sekaligus menandai selesainya proses pengajuan dan dimulainya tahap pelaksanaan sidang.
9. Fitur Pelaksanaan Sidang

   Fitur ini mengelola jalannya sidang skripsi dari awal hingga pengumuman hasil. Pembimbing 1 memulai sidang, setelah itu setiap penguji mengisi catatan dan keputusan kelulusannya, sementara seluruh peserta (dua pembimbing dan dua penguji) mengisi penilaian dengan komponen-komponen yang telah ditentukan. Pembimbing 1 kemudian merekap seluruh nilai dan menetapkan hasil akhir sidang beserta grade yang diperoleh mahasiswa. Sistem secara otomatis menerbitkan berita acara dan dokumen hasil penilaian akhir berdasarkan data yang telah dimasukkan.
10. Fitur Revisi Pasca Sidang

    Fitur ini mengelola proses perbaikan skripsi setelah sidang selesai. Mahasiswa mengunggah file revisi secara berurutan kepada Penguji 2, Penguji 1, Pembimbing 2, dan Pembimbing 1. Setiap penandatangan dapat menyetujui atau meminta perbaikan lebih lanjut. Setelah seluruh pihak menyetujui, sistem secara otomatis menerbitkan halaman pengesahan majelis penguji dan halaman pengesahan dekan sebagai dokumen penutup revisi.
11. Fitur Pengumpulan Berkas Final

    Fitur ini memungkinkan mahasiswa menyerahkan dokumen akhir skripsi kepada seluruh pihak yang berkepentingan. Mahasiswa mengunggah file skripsi dan artikel penelitian, lalu setiap penerima yaitu perpustakaan, LPPM, kedua pembimbing, dan kedua penguji mengonfirmasi penerimaan berkas secara mandiri. Setelah semua pihak mengonfirmasi, sistem menerbitkan surat pernyataan penyerahan yang ditandatangani oleh seluruh penerima, dan sekretaris prodi mengesahkan dokumen tersebut sebagai penyelesaian akhir proses skripsi.
12. Fitur Notifikasi

    Fitur ini menyediakan umpan pemberitahuan yang bersifat personal untuk setiap pengguna. Notifikasi dikirimkan secara otomatis setiap kali terjadi perubahan status yang relevan pada alur kerja pengguna tersebut, seperti pengajuan yang perlu ditinjau, berkas yang telah diverifikasi, atau giliran yang harus segera dikerjakan. Pengguna dapat melihat daftar notifikasi terbaru dan menandai notifikasi sebagai telah dibaca.
13. Fitur Pengelolaan Periode Pengajuan Outline

    Fitur ini memungkinkan administrator mengatur jendela waktu di mana mahasiswa diizinkan mengajukan outline. Setiap periode dikonfigurasi dengan tahun akademik, semester, serta tanggal dan waktu buka dan tutupnya. Pengajuan outline yang dilakukan di luar periode aktif akan ditolak secara otomatis oleh sistem. Administrator dapat menambah, mengubah, dan menghapus periode, dengan pembatasan bahwa periode yang sudah memiliki pengajuan terhubung tidak dapat dihapus.
14. Fitur Pengelolaan Periode Pengajuan Sidang

    Fitur ini memungkinkan administrator mengatur jendela waktu di mana mahasiswa diizinkan mengajukan sidang skripsi. Pengaturannya sama dengan periode outline, yaitu mencakup tahun akademik, semester, serta tanggal dan waktu buka dan tutupnya. Pengajuan sidang pertama kali yang dilakukan di luar periode aktif akan ditolak secara otomatis, sedangkan pengajuan ulang sidang bagi mahasiswa yang tidak lulus dikecualikan dari pembatasan ini.
15. Fitur Manajemen Tanda Tangan

    Fitur ini memungkinkan setiap pengguna menyimpan gambar tanda tangan digital ke dalam akunnya. Tanda tangan yang tersimpan digunakan secara otomatis oleh sistem saat menerbitkan dokumen-dokumen resmi sepanjang alur skripsi, seperti formulir pengajuan, kartu konsultasi, halaman persetujuan, dan berita acara sidang. Pengguna juga dapat memperbarui atau menghapus tanda tangan yang telah tersimpan.
