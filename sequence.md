# Sequence Diagrams — Sistem Skripsi

---

## ADM — Admin

### UC-ADM-01: Mengelola Data Mahasiswa
**Lifelines:** Admin | Halaman Sinkronisasi Data Mahasiswa | Sistem Eksternal | Database

Admin → Halaman Sinkronisasi Data Mahasiswa: Membuka halaman sinkronisasi data mahasiswa

Halaman Sinkronisasi Data Mahasiswa → Admin: viewHalamanSinkronisasiDataMahasiswa()

Admin → Halaman Sinkronisasi Data Mahasiswa: Memilih tombol sinkronisasi

Halaman Sinkronisasi Data Mahasiswa → Sistem Eksternal: syncDataMahasiswa()

Sistem Eksternal → Halaman Sinkronisasi Data Mahasiswa: daftarMahasiswa

Halaman Sinkronisasi Data Mahasiswa → Database: saveData(dataMahasiswa)

alt [Gagal]

Database → Halaman Sinkronisasi Data Mahasiswa: error

Halaman Sinkronisasi Data Mahasiswa → Admin: showErrorMessage()

alt [Sukses]

Database → Halaman Sinkronisasi Data Mahasiswa: daftarMahasiswa

Halaman Sinkronisasi Data Mahasiswa → Admin: showSuccessMessage()

END

---

### UC-ADM-02: Mengelola Data Dosen
**Lifelines:** Admin | Halaman Sinkronisasi Data Dosen | Sistem Eksternal | Database

Admin → Halaman Sinkronisasi Data Dosen: Membuka halaman sinkronisasi data dosen

Halaman Sinkronisasi Data Dosen → Admin: viewHalamanSinkronisasiDataDosen()

Admin → Halaman Sinkronisasi Data Dosen: Memilih tombol sinkronisasi

Halaman Sinkronisasi Data Dosen → Sistem Eksternal: syncDataDosen()

Sistem Eksternal → Halaman Sinkronisasi Data Dosen: daftarDosen

Halaman Sinkronisasi Data Dosen → Database: saveData(dataDosen)

alt [Gagal]

Database → Halaman Sinkronisasi Data Dosen: error

Halaman Sinkronisasi Data Dosen → Admin: showErrorMessage()

alt [Sukses]

Database → Halaman Sinkronisasi Data Dosen: daftarDosen

Halaman Sinkronisasi Data Dosen → Admin: showSuccessMessage()

END

---

### UC-ADM-03: Mengelola Jadwal Pengajuan Outline
**Lifelines:** User | Halaman Manajemen Periode Outline | Database

User → Halaman Manajemen Periode Outline: Membuka halaman jadwal pengajuan outline

Halaman Manajemen Periode Outline → Database: getDaftarPeriodePengajuanOutline()

Database → Halaman Manajemen Periode Outline: daftarPeriode

Halaman Manajemen Periode Outline → User: viewHalamanManajemenPeriodeOutline(daftarPeriode)

alt [Tambah periode baru]

User → Halaman Manajemen Periode Outline: Menekan tombol Tambah Periode

User → Halaman Manajemen Periode Outline: Mengisi tahun akademik, periode akademik, dibuka pada, ditutup pada

Halaman Manajemen Periode Outline → Halaman Manajemen Periode Outline: validateData()

alt [Tidak Valid]

Halaman Manajemen Periode Outline → User: showErrorMessage()

alt [Valid]

Halaman Manajemen Periode Outline → Database: createPeriode(tahunAkademik, periodeAkademik, openAt, closeAt)

Database → Halaman Manajemen Periode Outline: periodeId

Halaman Manajemen Periode Outline → User: showSuccessMessage()

alt [Edit Periode]

User → Halaman Manajemen Periode Outline: Menekan tombol Edit

User → Halaman Manajemen Periode Outline: Mengubah field pada form

Halaman Manajemen Periode Outline → Halaman Manajemen Periode Outline: validateData()

alt [Tidak Valid]

Halaman Manajemen Periode Outline → User: showErrorMessage()

alt [Valid]

Halaman Manajemen Periode Outline → Database: updatePeriode(periodeId, tahunAkademik, periodeAkademik, openAt, closeAt)

Database → Halaman Manajemen Periode Outline: periodeId

Halaman Manajemen Periode Outline → User: showSuccessMessage()

alt [Hapus periode]

User → Halaman Manajemen Periode Outline: Menekan tombol Hapus

Halaman Manajemen Periode Outline → Database: deletePeriode(periodeId)

alt [Periode sudah digunakan oleh pengajuan outline]

Database → Halaman Manajemen Periode Outline: error

Halaman Manajemen Periode Outline → User: showErrorMessage()

alt [Sukses]

Database → Halaman Manajemen Periode Outline: ok

Halaman Manajemen Periode Outline → User: showSuccessMessage()

END

---

### UC-ADM-04: Mengelola Jadwal Pengajuan Sidang
**Lifelines:** Admin | Halaman Manajemen Periode Pengajuan Sidang | Database

Admin → Halaman Manajemen Periode Pengajuan Sidang: Membuka halaman Manajemen Periode Pengajuan Sidang
Halaman Manajemen Periode Pengajuan Sidang → Database: getDaftarPeriodePengajuanSidang()
Database → Halaman Manajemen Periode Pengajuan Sidang: daftarPeriode (id, tahunAkademik, periodeAkademik, openAt, closeAt, isOpenNow)
Halaman Manajemen Periode Pengajuan Sidang → Admin: viewHalamanManajemenPeriode(daftarPeriode)

alt [Tambah periode baru]
Admin → Halaman Manajemen Periode Pengajuan Sidang: Menekan tombol Tambah Periode dan mengisi form (tahunAkademik, periodeAkademik, openAt, closeAt)
Halaman Manajemen Periode Pengajuan Sidang → Halaman Manajemen Periode Pengajuan Sidang: validateData()

alt [Tidak valid]
Halaman Manajemen Periode Pengajuan Sidang → Admin: showErrorMessage() → END

alt [Valid]
Halaman Manajemen Periode Pengajuan Sidang → Database: createPeriode(tahunAkademik, periodeAkademik, openAt, closeAt)
Database → Halaman Manajemen Periode Pengajuan Sidang: periodeId

alt [Edit periode]
Admin → Halaman Manajemen Periode Pengajuan Sidang: Menekan tombol Edit dan mengubah field pada form
Halaman Manajemen Periode Pengajuan Sidang → Halaman Manajemen Periode Pengajuan Sidang: validateData()

alt [Tidak valid]
Halaman Manajemen Periode Pengajuan Sidang → Admin: showErrorMessage() → END

alt [Valid]
Halaman Manajemen Periode Pengajuan Sidang → Database: updatePeriode(periodeId, tahunAkademik?, periodeAkademik?, openAt, closeAt)
Database → Halaman Manajemen Periode Pengajuan Sidang: periodeId

alt [Hapus periode]
Admin → Halaman Manajemen Periode Pengajuan Sidang: Menekan tombol Hapus
Halaman Manajemen Periode Pengajuan Sidang → Admin: showDeleteConfirmation()
Admin → Halaman Manajemen Periode Pengajuan Sidang: Mengkonfirmasi penghapusan
Halaman Manajemen Periode Pengajuan Sidang → Database: deletePeriode(periodeId)

alt [Periode sudah digunakan oleh pengajuan sidang]
Database → Halaman Manajemen Periode Pengajuan Sidang: error (409)
Halaman Manajemen Periode Pengajuan Sidang → Admin: showErrorMessage() → END

alt [Berhasil]
Database → Halaman Manajemen Periode Pengajuan Sidang: ok

Halaman Manajemen Periode Pengajuan Sidang → Database: getDaftarPeriodePengajuanSidang()
Database → Halaman Manajemen Periode Pengajuan Sidang: daftarPeriode (diperbarui)
Halaman Manajemen Periode Pengajuan Sidang → Admin: viewHalamanManajemenPeriode(daftarPeriode)

END

---

## PO — Pengajuan Outline

### UC-PO-01: Mengajukan Outline Skripsi
**Lifelines:** Mahasiswa | Halaman Pengajuan Outline | Halaman Submit Pengajuan Outline | Database

Mahasiswa → Halaman Pengajuan Outline: Membuka halaman pengajuan outline

Halaman Pengajuan Outline → Database: getPengajuanOutline(mahasiswa_id)

Database → Halaman Pengajuan Outline: judulOutline, latarBelakangOutline, statusPengajuan, catatanKaprodi, fileOutline, fileReviewKaprodi

alt [Status Pengajuan Outline adalah Menunggu Review/Disetujui]

Halaman Pengajuan Outline → Mahasiswa: viewHalamanPengajuanOutline(false)

alt [Status Pengajuan Outline adalah Belum ada/Ditolak/Perlu revisi]

Halaman Pengajuan Outline → Mahasiswa: viewHalamanPengajuanOutline(true)

Mahasiswa → Halaman Pengajuan Outline: Memilih tombol navigasi

Halaman Pengajuan Outline → Halaman Submit Pengajuan Outline: navigateToHalamanSubmitPengajuanOutline()

Halaman Submit Pengajuan Outline → Mahasiswa: viewHalamanSubmitPengajuanOutline()

Mahasiswa → Halaman Submit Pengajuan Outline: Mengisi/memperbarui judul, latar belakang, dan mengunggah file outline

Mahasiswa → Halaman Submit Pengajuan Outline: submitOutline(judul, latarBelakang, fileOutline)

Halaman Submit Pengajuan Outline → Halaman Submit Pengajuan Outline: validateData()

alt [Tidak Valid]

Halaman Submit Pengajuan Outline → Mahasiswa: showErrorMessage() → END

alt [Valid]

Halaman Submit Pengajuan Outline → Database: saveData(judul, latarBelakang, fileOutline)

Database → Halaman Submit Pengajuan Outline: judulOutline, latarBelakangOutline, statusPengajuan

Halaman Submit Pengajuan Outline → Mahasiswa: showSuccessMessage()

END

---

### UC-PO-02: Pengajuan Disposisi Pembimbing
**Lifelines:** Mahasiswa | Halaman Pengajuan Disposisi Pembimbing | Halaman Submit Pengajuan Disposisi Pembimbing | Database

Mahasiswa → Halaman Pengajuan Disposisi Pembimbing: Membuka halaman pengajuan disposisi pembimbing

Halaman Pengajuan Disposisi Pembimbing → Database: getPengajuanOutline(mahasiswa_id)

Database → Halaman Pengajuan Disposisi Pembimbing: statusOutline

alt [Status Pengajuan Outline adalah Belum Disetujui]

Halaman Pengajuan Disposisi Pembimbing → Mahasiswa: showErrorMessage()

alt [Status Pengajuan Outline adalah Disetujui]

Halaman Pengajuan Disposisi Pembimbing → Database: getPengajuanDisposisiPembimbing(mahasiswa_id)

Database → Halaman Pengajuan Disposisi Pembimbing: judulOutline, pembimbing1Diajukan, pembimbing2Diajukan, pembimbing1Ditetapkan, pembimbing2Ditetapkan, statusPengajuan, catatanKaprodi

alt [Status Pengajuan Disposisi Pembimbing adalah Disetujui]

Halaman Pengajuan Disposisi Pembimbing → Mahasiswa: viewHalamanPengajuanDisposisiPembimbing(false)

alt [Status Pengajuan Disposisi Pembimbing adalah Belum ada/Ditolak/Perlu revisi]

Halaman Pengajuan Disposisi Pembimbing → Mahasiswa: viewHalamanPengajuanDisposisiPembimbing(true)

Mahasiswa → Halaman Pengajuan Disposisi Pembimbing: Memilih tombol navigasi

Halaman Pengajuan Disposisi Pembimbing → Halaman Submit Pengajuan Disposisi Pembimbing: navigateToHalamanSubmitPengajuanDisposisiPembimbing()

Halaman Submit Pengajuan Disposisi Pembimbing → Mahasiswa: viewHalamanSubmitPengajuanDisposisiPembimbing()

Mahasiswa → Halaman Submit Pengajuan Disposisi Pembimbing: Mengisi/memperbarui data pengajuan meliputi nomor telepon, jumlah SKS, usulan dosen pembimbing, nama perusahaan (opsional), serta mengunggah file transkrip nilai, KRS, bukti nilai Metodologi Penelitian minimal C, dan tanda tangan

Mahasiswa → Halaman Submit Pengajuan Disposisi Pembimbing: submitPengajuanDisposisiPembimbing(nomorTelepon, sks, dosenPembimbing1, dosenPembimbing2, namaPerusahaan, fileTranskrip, fileKRS, fileMetpen, fileTandaTangan)

Halaman Submit Pengajuan Disposisi Pembimbing → Halaman Submit Pengajuan Disposisi Pembimbing: validateData()

alt [Tidak Valid]

Halaman Submit Pengajuan Disposisi Pembimbing → Mahasiswa: showErrorMessage()

alt [Valid]

Halaman Submit Pengajuan Disposisi Pembimbing → Database: saveData()

Database → Halaman Submit Pengajuan Disposisi Pembimbing: judulOutline, statusPengajuan

Halaman Submit Pengajuan Disposisi Pembimbing → Mahasiswa: showSuccessMessage()

END

---

### UC-PO-03: Mereview Pengajuan Outline
**Lifelines:** Ketua Program Studi | Halaman Daftar Pengajuan Outline | Halaman Detail Pengajuan Outline | Database

Ketua Program Studi → Halaman Daftar Pengajuan Outline: Membuka halaman daftar pengajuan outline
Halaman Daftar Pengajuan Outline → Database: getPengajuanOutline()
Database → Halaman Daftar Pengajuan Outline: daftarPengajuanOutline
Halaman Daftar Pengajuan Outline → Ketua Program Studi: viewHalamanDaftarPengajuanOutline()

alt [Memilih Tombol Detail]
Ketua Program Studi → Halaman Daftar Pengajuan Outline: Memilih tombol detail
Halaman Daftar Pengajuan Outline → Halaman Detail Pengajuan Outline: navigateToHalamanDetailPengajuanOutline(pengajuanId)
Halaman Detail Pengajuan Outline → Database: getPengajuanOutlineDetail(pengajuanId)
Database → Halaman Detail Pengajuan Outline: judulOutline, latarBelakangOutline, fileOutline, statusPengajuan

alt [canReview = false]
Halaman Detail Pengajuan Outline → Ketua Program Studi: viewHalamanDetailPengajuanOutline(false)

alt [canReview = true]
Halaman Detail Pengajuan Outline → Ketua Program Studi: viewHalamanDetailPengajuanOutline(true)
Ketua Program Studi → Halaman Detail Pengajuan Outline: Melakukan review dengan menentukan status, memberi komentar, dan secara opsional mengunggah file hasil review
Ketua Program Studi → Halaman Detail Pengajuan Outline: submitReview(status, komentar, fileReview)
Halaman Detail Pengajuan Outline → Halaman Detail Pengajuan Outline: validateData()

alt [Tidak Valid]
Halaman Detail Pengajuan Outline → Ketua Program Studi: showErrorMessage()

alt [Valid]
Halaman Detail Pengajuan Outline → Database: saveReview(status, komentar, fileReview)
Database → Halaman Detail Pengajuan Outline: judulOutline, statusPengajuan
Halaman Detail Pengajuan Outline → Ketua Program Studi: showSuccessMessage()

alt [Memilih Tombol Review]
Ketua Program Studi → Halaman Daftar Pengajuan Outline: Memilih tombol review
Halaman Daftar Pengajuan Outline → Halaman Detail Pengajuan Outline: navigateToHalamanDetailPengajuanOutline(pengajuanId, canReview=true)

END

---

### UC-PO-04: Mereview Pengajuan Disposisi Pembimbing
**Lifelines:** Ketua Program Studi | Halaman Daftar Pengajuan Disposisi Pembimbing | Halaman Detail Pengajuan Disposisi Pembimbing | Database

Ketua Program Studi → Halaman Daftar Pengajuan Disposisi Pembimbing: Membuka halaman daftar pengajuan disposisi pembimbing

Halaman Daftar Pengajuan Disposisi Pembimbing → Database: getPengajuanDisposisiPembimbing()

Database → Halaman Daftar Pengajuan Disposisi Pembimbing: daftarPengajuanDisposisiPembimbing

Halaman Daftar Pengajuan Disposisi Pembimbing → Ketua Program Studi: viewHalamanDaftarPengajuanDisposisiPembimbing()

alt [Memilih Tombol Detail]

Ketua Program Studi → Halaman Daftar Pengajuan Disposisi Pembimbing: Memilih tombol detail

Halaman Daftar Pengajuan Disposisi Pembimbing → Halaman Detail Pengajuan Disposisi Pembimbing: navigateToHalamanDetailPengajuanDisposisiPembimbing(pengajuanId)

Halaman Detail Pengajuan Disposisi Pembimbing → Database: getPengajuanDisposisiPembimbingDetail(pengajuanId)

Database → Halaman Detail Pengajuan Disposisi Pembimbing: judulOutline, pembimbing1Diajukan, pembimbing2Diajukan, pembimbing1Ditetapkan, pembimbing2Ditetapkan, fileKRS, fileTranskrip, fileMetodologi, statusPengajuan, catatanKaprodi

alt [canReview = false]

Halaman Detail Pengajuan Disposisi Pembimbing → Ketua Program Studi: viewHalamanDetailPengajuanDisposisiPembimbing(false)

alt [canReview = true]

Halaman Detail Pengajuan Disposisi Pembimbing → Ketua Program Studi: viewHalamanDetailPengajuanDisposisiPembimbing(true)

Ketua Program Studi → Halaman Detail Pengajuan Disposisi Pembimbing: Melakukan review dengan memeriksa dokumen persyaratan, menetapkan dosen, menentukan status, dan memberi komentar

Halaman Detail Pengajuan Disposisi Pembimbing → Halaman Detail Pengajuan Disposisi Pembimbing: validateData()

alt [Tidak Valid]

Halaman Detail Pengajuan Disposisi Pembimbing → Ketua Program Studi: showErrorMessage()

alt [Valid]

alt [Status Disetujui]

Ketua Program Studi → Halaman Detail Pengajuan Disposisi Pembimbing: Mengunggah tanda tangan

Ketua Program Studi → Halaman Detail Pengajuan Disposisi Pembimbing: submitReview(status, komentar, dosenPembimbing1, dosenPembimbing2, fileTandaTangan)

Halaman Detail Pengajuan Disposisi Pembimbing → Database: saveReview(status, komentar)

Database → Halaman Detail Pengajuan Disposisi Pembimbing: judulOutline, statusPengajuan

Halaman Detail Pengajuan Disposisi Pembimbing → Ketua Program Studi: showSuccessMessage()

alt [Status Ditolak/Perlu Revisi]

Ketua Program Studi → Halaman Detail Pengajuan Disposisi Pembimbing: submitReview(status, komentar, dosenPembimbing1, dosenPembimbing2)

Halaman Detail Pengajuan Disposisi Pembimbing → Database: saveReview(status, komentar)

Database → Halaman Detail Pengajuan Disposisi Pembimbing: judulOutline, statusPengajuan

Halaman Detail Pengajuan Disposisi Pembimbing → Ketua Program Studi: showSuccessMessage()

alt [Memilih Tombol Download]

Ketua Program Studi → Halaman Daftar Pengajuan Disposisi Pembimbing: Memilih tombol download

Halaman Daftar Pengajuan Disposisi Pembimbing → Database: downloadFormulir(pengajuanId)

Database → Halaman Daftar Pengajuan Disposisi Pembimbing: fileFormulir

Halaman Daftar Pengajuan Disposisi Pembimbing → Ketua Program Studi: Mengirimkan file formulir

Ketua Program Studi → Ketua Program Studi: Mengunduh file formulir

alt [Memilih Tombol Review]

Ketua Program Studi → Halaman Daftar Pengajuan Disposisi Pembimbing: Memilih tombol review

Halaman Daftar Pengajuan Disposisi Pembimbing → Halaman Detail Pengajuan Disposisi Pembimbing: navigateToHalamanDetailPengajuanDisposisiPembimbing(pengajuanId, canReview=true)

END

---

## KO — Konsultasi Outline

### UC-KO-01: Konsultasi Outline
**Lifelines:** Mahasiswa | Halaman Konsultasi Outline | Halaman Detail Konsultasi Outline | Database

Mahasiswa → Halaman Konsultasi Outline: Membuka halaman konsultasi outline

Halaman Konsultasi Outline → Database: getKonsultasiOutline()

Database → Halaman Konsultasi Outline: judulOutline, tahapPengajuan, tanggalDibuat, statusKonsultasi

Halaman Konsultasi Outline → Mahasiswa: viewHalamanKonsultasiOutline()

Mahasiswa → Halaman Konsultasi Outline: Memilih tombol detail

Halaman Konsultasi Outline → Halaman Detail Konsultasi Outline: navigateToHalamanDetailKonsultasiOutline(konsultasiId)

Halaman Detail Konsultasi Outline → Database: getDetailKonsultasiOutline(konsultasiId)

Database → Halaman Detail Konsultasi Outline: judulOutline, catatanPembimbing, dataMahasiswa, namaPembimbing1, namaPembimbing2, statusKonsultasi, riwayatKonsultasi

alt [Status outline diajukan/sedang direview]

Halaman Detail Konsultasi Outline → Mahasiswa: viewHalamanDetailKonsultasiOutline(false)

alt [Status outline perlu revisi/belum diajukan]

Halaman Detail Konsultasi Outline → Mahasiswa: viewHalamanDetailKonsultasiOutline(true)

Mahasiswa → Halaman Detail Konsultasi Outline: submitFileOutline(konsultasiId, file)

Halaman Detail Konsultasi Outline → Halaman Detail Konsultasi Outline: validateData()

alt [Tidak valid]

Halaman Detail Konsultasi Outline → Mahasiswa: showErrorMessage()

alt [Valid]

Halaman Detail Konsultasi Outline → Database: saveData()

Database → Halaman Detail Konsultasi Outline: statusKonsultasi

Halaman Detail Konsultasi Outline → Mahasiswa: showSuccessMessage()

END

---

### UC-KO-02: Mengunduh Dokumen Konsultasi Outline
**Lifelines:** User | Halaman Detail Konsultasi Outline | Database

User → Halaman Detail Konsultasi Outline: Membuka halaman detail konsultasi outline

Halaman Detail Konsultasi Outline → Database: getDetailKonsultasi(konsultasiId)

Database → Halaman Detail Konsultasi Outline: judulOutline, catatanPembimbing, dataMahasiswa, namaPembimbing1, namaPembimbing2, statusKonsultasi, riwayatKonsultasi

Halaman Detail Konsultasi Outline → User: viewHalamanDetailKonsultasiOutline()

User → Halaman Detail Konsultasi Outline: Klik tombol unduh

Halaman Detail Konsultasi Outline → Database: downloadKonsultasiOutline()

Database → Halaman Detail Konsultasi Outline: kartuKonsultasiOutline

alt [Sukses]

Halaman Detail Konsultasi Outline → User: showSuccessMessage()

alt [Gagal]

Halaman Detail Konsultasi Outline → User: showErrorMessage()

END

---

### UC-KO-03: Pemantauan Konsultasi Outline (Kaprodi)
**Lifelines:** Ketua Program Studi | Halaman Daftar Konsultasi Outline | Halaman Detail Konsultasi Outline | Database

Ketua Program Studi → Halaman Daftar Konsultasi Outline: Membuka halaman konsultasi outline

Halaman Daftar Konsultasi Outline → Database: getOutlineByProgramStudi(programStudiId)

Database → Halaman Daftar Konsultasi Outline: daftarKonsultasiOutlineMahasiswa

Halaman Daftar Konsultasi Outline → Ketua Program Studi: viewHalamanDaftarKonsultasiOutline()

Ketua Program Studi → Halaman Daftar Konsultasi Outline: Memilih tombol detail

Halaman Daftar Konsultasi Outline → Halaman Detail Konsultasi Outline: navigateToHalamanDetailKonsultasiOutline(outlineId)

Halaman Detail Konsultasi Outline → Database: getDetailKonsultasiOutline(outlineId)

Database → Halaman Detail Konsultasi Outline: judulOutline, catatanPembimbing, dataMahasiswa, namaPembimbing1, namaPembimbing2, statusKonsultasi, riwayatKonsultasi

Halaman Detail Konsultasi Outline → Ketua Program Studi: viewHalamanDetailKonsultasiOutline()

END

---

### UC-KO-04a: Mereview Outline Mahasiswa (Dosen Pembimbing 2)
**Lifelines:** Dosen Pembimbing | Halaman Daftar Konsultasi Outline | Halaman Detail Konsultasi Outline | Database

Dosen Pembimbing → Halaman Daftar Konsultasi Outline: Membuka halaman konsultasi outline

Halaman Daftar Konsultasi Outline → Database: getOutlineByPembimbing(nidn)

Database → Halaman Daftar Konsultasi Outline: daftarOutlineMahasiswa

Halaman Daftar Konsultasi Outline → Dosen Pembimbing: viewHalamanDaftarKonsultasiOutline()

Dosen Pembimbing → Halaman Daftar Konsultasi Outline: Memilih tombol review

Halaman Daftar Konsultasi Outline → Halaman Detail Konsultasi Outline: navigateToHalamanDetailKonsultasiOutline(outlineId)

Halaman Detail Konsultasi Outline → Database: getDetailKonsultasiOutline(outlineId)

Database → Halaman Detail Konsultasi Outline: judulOutline, catatanPembimbing, dataMahasiswa, namaPembimbing1, namaPembimbing2, statusKonsultasi, riwayatKonsultasi

Halaman Detail Konsultasi Outline → Dosen Pembimbing: viewHalamanDetailKonsultasiOutline()

alt [Status outline 'perlu revisi']

Dosen Pembimbing → Halaman Detail Konsultasi Outline: Melihat outline dan mengisi keputusan

Dosen Pembimbing → Halaman Detail Konsultasi Outline: submitReview(outlineId, keputusan, catatan)

Halaman Detail Konsultasi Outline → Halaman Detail Konsultasi Outline: validateData()

alt [Tidak valid]

Halaman Detail Konsultasi Outline → Dosen Pembimbing: showErrorMessage()

alt [Valid]

Halaman Detail Konsultasi Outline → Database: saveData()

Database → Halaman Detail Konsultasi Outline: statusKonsultasi

Halaman Detail Konsultasi Outline → Dosen Pembimbing: showSuccessMessage()

alt [Status outline 'lanjut']

Dosen Pembimbing → Halaman Detail Konsultasi Outline: Melihat outline dan mengisi keputusan serta mengunggah tanda tangan

Dosen Pembimbing → Halaman Detail Konsultasi Outline: submitReview(outlineId, keputusan, catatan, fileTandaTangan)

Halaman Detail Konsultasi Outline → Halaman Detail Konsultasi Outline: validateData()

alt [Tidak valid]

Halaman Detail Konsultasi Outline → Dosen Pembimbing: showErrorMessage()

alt [Valid]

Halaman Detail Konsultasi Outline → Database: saveData()

Database → Halaman Detail Konsultasi Outline: statusKonsultasi

Halaman Detail Konsultasi Outline → Dosen Pembimbing: showSuccessMessage()

END

---

### UC-KO-04b: Mereview Outline Mahasiswa (Dosen Pembimbing 1)
**Lifelines:** Dosen Pembimbing 1 | Halaman Daftar Konsultasi Outline | Halaman Detail Konsultasi Outline | Database

Dosen Pembimbing 1 → Halaman Daftar Konsultasi Outline: Membuka halaman konsultasi outline

Halaman Daftar Konsultasi Outline → Database: getOutlineByPembimbing(nidn)

Database → Halaman Daftar Konsultasi Outline: daftarOutlineMahasiswa

Halaman Daftar Konsultasi Outline → Dosen Pembimbing 1: viewHalamanDaftarKonsultasiOutline()

Dosen Pembimbing 1 → Halaman Daftar Konsultasi Outline: Memilih tombol review

Halaman Daftar Konsultasi Outline → Halaman Detail Konsultasi Outline: navigateToHalamanDetailKonsultasiOutline(outlineId)

Halaman Detail Konsultasi Outline → Database: getDetailKonsultasiOutline(outlineId)

Database → Halaman Detail Konsultasi Outline: judulOutline, catatanPembimbing, dataMahasiswa, namaPembimbing1, namaPembimbing2, statusKonsultasi, riwayatKonsultasi

Halaman Detail Konsultasi Outline → Dosen Pembimbing 1: viewHalamanDetailKonsultasiOutline()

alt [Status outline 'perlu revisi']

Dosen Pembimbing 1 → Halaman Detail Konsultasi Outline: Melihat outline dan mengisi keputusan

Dosen Pembimbing 1 → Halaman Detail Konsultasi Outline: submitReview(outlineId, keputusan, catatan)

Halaman Detail Konsultasi Outline → Halaman Detail Konsultasi Outline: validateData()

alt [Tidak valid]

Halaman Detail Konsultasi Outline → Dosen Pembimbing 1: showErrorMessage()

alt [Valid]

Halaman Detail Konsultasi Outline → Database: saveData()

Database → Halaman Detail Konsultasi Outline: statusKonsultasi

Halaman Detail Konsultasi Outline → Dosen Pembimbing 1: showSuccessMessage()

alt [Status outline 'diterima']

Dosen Pembimbing 1 → Halaman Detail Konsultasi Outline: Melihat outline dan mengisi keputusan serta mengunggah tanda tangan

Dosen Pembimbing 1 → Halaman Detail Konsultasi Outline: submitReview(outlineId, keputusan, catatan, fileTandaTangan)

Halaman Detail Konsultasi Outline → Halaman Detail Konsultasi Outline: validateData()

alt [Tidak valid]

Halaman Detail Konsultasi Outline → Dosen Pembimbing 1: showErrorMessage()

alt [Valid]

Halaman Detail Konsultasi Outline → Database: saveData()

Halaman Detail Konsultasi Outline → Halaman Detail Konsultasi Outline: generateKartuKonsultasi()

Database → Halaman Detail Konsultasi Outline: statusKonsultasi, kartuKonsultasi

Halaman Detail Konsultasi Outline → Dosen Pembimbing 1: showSuccessMessage()

END

---

## SK — SK Penelitian

### UC-01: Mengajukan SK Penelitian
**Lifelines:** Mahasiswa | Halaman SK Penelitian | Database

Mahasiswa → Halaman SK Penelitian: Membuka halaman SK Penelitian
Halaman SK Penelitian → Database: getStatusPrasyarat(pengajuanDisposisiPembimbingId)
Database → Halaman SK Penelitian: statusHalamanPersetujuan

alt [Prasyarat belum terpenuhi]
Halaman SK Penelitian → Mahasiswa: showErrorMessage() → END

alt [Prasyarat terpenuhi]
Halaman SK Penelitian → Mahasiswa: viewHalamanSKPenelitian()
Mahasiswa → Halaman SK Penelitian: Menekan tombol Ajukan SK Penelitian
Halaman SK Penelitian → Database: getBerkasPengajuan(pengajuanDisposisiPembimbingId)
Database → Halaman SK Penelitian: krs, rekapNilai, kartuKonsultasiOutline, fileOutline, halamanPersetujuan
Halaman SK Penelitian → Database: saveSKPenelitian(berkasSkPenelitian)
Database → Halaman SK Penelitian: statusSKPenelitian
Halaman SK Penelitian → Mahasiswa: showSuccessMessage()

END

---

### UC-02: Memverifikasi Berkas SK Penelitian
**Lifelines:** Sekretariat | Halaman Daftar SK Penelitian | Halaman Detail SK Penelitian | Database

Sekretariat → Halaman Daftar SK Penelitian: Membuka daftar pengajuan SK Penelitian
Halaman Daftar SK Penelitian → Database: getDaftarSKPenelitian()
Database → Halaman Daftar SK Penelitian: daftarSKPenelitian
Halaman Daftar SK Penelitian → Sekretariat: viewDaftarSKPenelitian()

Sekretariat → Halaman Daftar SK Penelitian: Memilih pengajuan milik Mahasiswa
Halaman Daftar SK Penelitian → Halaman Detail SK Penelitian: navigateToHalamanDetailSKPenelitian()
Halaman Detail SK Penelitian → Database: getDetailSKPenelitian(pengajuanDisposisiPembimbingId)
Database → Halaman Detail SK Penelitian: namaMahasiswa, npm, statusSKPenelitian, krs, rekapNilai, kartuKonsultasiOutline, fileOutline, halamanPersetujuan
Halaman Detail SK Penelitian → Sekretariat: viewDetailSKPenelitian()

Sekretariat → Halaman Detail SK Penelitian: Memeriksa berkas dan mengambil keputusan

alt [VERIFY]
Halaman Detail SK Penelitian → Database: verifySKPenelitian(pengajuanDisposisiPembimbingId)
Database → Halaman Detail SK Penelitian: statusSKPenelitian
Halaman Detail SK Penelitian → Database: generateSKPenelitian(pengajuanDisposisiPembimbingId)
Database → Halaman Detail SK Penelitian: statusSKPenelitian, fileSKPenelitian
Halaman Detail SK Penelitian → Sekretariat: showSuccessMessage()

alt [NEED_REVISION]
Halaman Detail SK Penelitian → Database: updateSKPenelitian(pengajuanDisposisiPembimbingId, catatan)
Database → Halaman Detail SK Penelitian: statusSKPenelitian
Halaman Detail SK Penelitian → Sekretariat: showSuccessMessage()

END

---

### UC-03: Melengkapi Berkas SK Penelitian
**Lifelines:** Mahasiswa | Halaman SK Penelitian | Database

Mahasiswa → Halaman SK Penelitian: Membuka halaman SK Penelitian
Halaman SK Penelitian → Database: getSKPenelitian(pengajuanDisposisiPembimbingId)
Database → Halaman SK Penelitian: statusSKPenelitian, catatanRevisi, berkasYangPerluDilengkapi
Halaman SK Penelitian → Mahasiswa: viewHalamanSKPenelitian()

Mahasiswa → Halaman SK Penelitian: Mengunggah ulang berkas yang diminta
Mahasiswa → Halaman SK Penelitian: Menekan tombol Ajukan Kembali
Halaman SK Penelitian → Halaman SK Penelitian: validateData()

alt [Tidak Valid]
Halaman SK Penelitian → Mahasiswa: showErrorMessage()

alt [Valid]
Halaman SK Penelitian → Database: resubmitSKPenelitian(pengajuanDisposisiPembimbingId, berkas)
Database → Halaman SK Penelitian: statusSKPenelitian
Halaman SK Penelitian → Mahasiswa: showSuccessMessage()

END

---

## KS — Konsultasi Skripsi

### UC-KS-01: Memulai Konsultasi Skripsi
**Lifelines:** Mahasiswa | Halaman Konsultasi Skripsi | Database

Mahasiswa → Halaman Konsultasi Skripsi: Membuka halaman Konsultasi Skripsi
Halaman Konsultasi Skripsi → Database: getStatusSKPenelitian(pengajuanDisposisiPembimbingId)
Database → Halaman Konsultasi Skripsi: statusSKPenelitian

alt [SK Penelitian belum COMPLETED]
Halaman Konsultasi Skripsi → Mahasiswa: showErrorMessage() → END

alt [SK Penelitian COMPLETED]
Halaman Konsultasi Skripsi → Database: getKartuKonsultasiSkripsi(pengajuanDisposisiPembimbingId)
Database → Halaman Konsultasi Skripsi: kartuData | null

alt [Kartu sudah dibuat]
Halaman Konsultasi Skripsi → Mahasiswa: showErrorMessage() → END

alt [Kartu belum dibuat]
Halaman Konsultasi Skripsi → Mahasiswa: viewHalamanKonsultasiSkripsi()
Mahasiswa → Halaman Konsultasi Skripsi: Menekan tombol Mulai Konsultasi Skripsi
Halaman Konsultasi Skripsi → Database: getPengajuanJudulData(pengajuanDisposisiPembimbingId)
Database → Halaman Konsultasi Skripsi: namaMahasiswa, judulSkripsi, programStudiId, programStudiNama, pembimbing1Nidn, pembimbing1Nama, pembimbing2Nidn, pembimbing2Nama
Halaman Konsultasi Skripsi → Database: saveKartuKonsultasiSkripsi(pengajuanDisposisiPembimbingId, namaMahasiswa, judulSkripsi, programStudiId, programStudiNama, pembimbing1Nidn, pembimbing1Nama, pembimbing2Nidn, pembimbing2Nama)
Database → Halaman Konsultasi Skripsi: kartuId
Halaman Konsultasi Skripsi → Database: saveStageAwal(kartuId, pengajuanDisposisiPembimbingId, pembimbing2Nidn)
Database → Halaman Konsultasi Skripsi: stageId
Halaman Konsultasi Skripsi → Mahasiswa: showSuccessMessage()

END

---

### UC-KS-02: Mengumpulkan Berkas Bab
**Lifelines:** Mahasiswa | Halaman Konsultasi Skripsi | Database

Mahasiswa → Halaman Konsultasi Skripsi: Membuka halaman Konsultasi Skripsi
Halaman Konsultasi Skripsi → Database: getKartuKonsultasiSkripsi(pengajuanDisposisiPembimbingId)
Database → Halaman Konsultasi Skripsi: kartuId, isCompleted, stageAktif (untuk ditampilkan ke pengguna)
Halaman Konsultasi Skripsi → Mahasiswa: viewHalamanKonsultasiSkripsi()

Mahasiswa → Halaman Konsultasi Skripsi: Mengunggah berkas bab dan menekan tombol Kumpulkan
Halaman Konsultasi Skripsi → Halaman Konsultasi Skripsi: validateData()

alt [Tidak valid]
Halaman Konsultasi Skripsi → Mahasiswa: showErrorMessage() → END

alt [Valid]
Halaman Konsultasi Skripsi → Database: getStageAktif(kartuId)
Database → Halaman Konsultasi Skripsi: stageId, chapterGroup, stage, currentStatus

alt [Tidak ada stage aktif atau konsultasi sudah selesai]
Halaman Konsultasi Skripsi → Mahasiswa: showErrorMessage() → END

alt [Stage aktif tersedia]
Halaman Konsultasi Skripsi → Database: saveSubmission(stageId, submissionNo, fileContent, fileName)
Database → Halaman Konsultasi Skripsi: submissionId
Halaman Konsultasi Skripsi → Database: updateStageStatus(stageId, status: SUBMITTED, submissionNo)
Database → Halaman Konsultasi Skripsi: ok
Halaman Konsultasi Skripsi → Mahasiswa: showSuccessMessage()

END

---

### UC-KS-03: Mereview Berkas Bab
**Lifelines:** Dospem | Halaman Daftar Konsultasi Skripsi | Halaman Detail Konsultasi Skripsi | Database

Dospem → Halaman Daftar Konsultasi Skripsi: Membuka daftar konsultasi skripsi
Halaman Daftar Konsultasi Skripsi → Database: getDaftarKonsultasiSkripsi(nidn)
Database → Halaman Daftar Konsultasi Skripsi: daftarKartu, activeStage, canReview
Halaman Daftar Konsultasi Skripsi → Dospem: viewDaftarKonsultasiSkripsi()

Dospem → Halaman Daftar Konsultasi Skripsi: Memilih mahasiswa yang berkasnya menunggu review
Halaman Daftar Konsultasi Skripsi → Halaman Detail Konsultasi Skripsi: navigateToHalamanDetailKonsultasiSkripsi(stageId)
Halaman Detail Konsultasi Skripsi → Database: getDetailStage(stageId, nidn)
Database → Halaman Detail Konsultasi Skripsi: stageId, chapterGroup, stage, currentStatus, kartuId, latestSubmission
Halaman Detail Konsultasi Skripsi → Dospem: viewDetailKonsultasiSkripsi()

Dospem → Halaman Detail Konsultasi Skripsi: Mengisi catatan dan memilih keputusan, lalu menekan tombol Simpan Review
Halaman Detail Konsultasi Skripsi → Halaman Detail Konsultasi Skripsi: validateData()

alt [Tidak valid]
Halaman Detail Konsultasi Skripsi → Dospem: showErrorMessage() → END

alt [Valid]

alt [Keputusan NEED_REVISION]
Halaman Detail Konsultasi Skripsi → Database: saveReview(stageId, submissionNo, decisionStatus, catatanKartu)
Database → Halaman Detail Konsultasi Skripsi: reviewId
Halaman Detail Konsultasi Skripsi → Database: saveLogKartu(kartuId, stageId, reviewId, chapterGroup, stage, submissionNo, reviewerNidn, reviewerNama, decisionStatus, catatanKartu)
Database → Halaman Detail Konsultasi Skripsi: ok
Halaman Detail Konsultasi Skripsi → Database: updateStageStatus(stageId, status: NEED_REVISION)
Database → Halaman Detail Konsultasi Skripsi: ok
Halaman Detail Konsultasi Skripsi → Dospem: showSuccessMessage() → END

alt [Keputusan CONTINUE / ACCEPTED]
Halaman Detail Konsultasi Skripsi → Database: getSignatureDosen(userId)
Database → Halaman Detail Konsultasi Skripsi: signatureImage | null

alt [Tanda tangan belum tersedia]
Halaman Detail Konsultasi Skripsi → Dospem: showErrorMessage() → END

alt [Tanda tangan tersedia]
Halaman Detail Konsultasi Skripsi → Database: saveReview(stageId, submissionNo, decisionStatus, catatanKartu)
Database → Halaman Detail Konsultasi Skripsi: reviewId
Halaman Detail Konsultasi Skripsi → Database: saveLogKartu(kartuId, stageId, reviewId, chapterGroup, stage, submissionNo, reviewerNidn, reviewerNama, decisionStatus, catatanKartu)
Database → Halaman Detail Konsultasi Skripsi: ok
Halaman Detail Konsultasi Skripsi → Database: updateStageStatus(stageId, status: CONTINUE / ACCEPTED)
Database → Halaman Detail Konsultasi Skripsi: ok
Halaman Detail Konsultasi Skripsi → Database: updateSignatureDospem(kartuId, signatureImage)
Database → Halaman Detail Konsultasi Skripsi: ok

alt [Keputusan CONTINUE — Pembimbing 2]
Halaman Detail Konsultasi Skripsi → Database: saveStageBaruPembimbing1(kartuId, pengajuanDisposisiPembimbingId, chapterGroup, pembimbing1Nidn)
Database → Halaman Detail Konsultasi Skripsi: stageId
Halaman Detail Konsultasi Skripsi → Dospem: showSuccessMessage() → END

alt [Keputusan ACCEPTED — Pembimbing 1, masih ada bab berikutnya]
Halaman Detail Konsultasi Skripsi → Database: saveStageBaruPembimbing2(kartuId, pengajuanDisposisiPembimbingId, nextChapterGroup, pembimbing2Nidn)
Database → Halaman Detail Konsultasi Skripsi: stageId
Halaman Detail Konsultasi Skripsi → Dospem: showSuccessMessage() → END

alt [Keputusan ACCEPTED — Pembimbing 1, Bab 5 selesai]
Halaman Detail Konsultasi Skripsi → Database: updateKartuSelesai(kartuId)
Database → Halaman Detail Konsultasi Skripsi: ok
Halaman Detail Konsultasi Skripsi → Database: generateAndSaveKartuDocx(kartuId, pengajuanDisposisiPembimbingId)
Database → Halaman Detail Konsultasi Skripsi: fileName
Halaman Detail Konsultasi Skripsi → Database: updateSkripsiCompleted(npm)
Database → Halaman Detail Konsultasi Skripsi: ok
Halaman Detail Konsultasi Skripsi → Dospem: showSuccessMessage()

END

---

### UC-KS-04: Mengunduh Kartu Penulisan Skripsi
**Lifelines:** Mahasiswa / Dospem / Kaprodi | Halaman Konsultasi Skripsi | Database

Mahasiswa / Dospem / Kaprodi → Halaman Konsultasi Skripsi: Membuka halaman Konsultasi Skripsi
Halaman Konsultasi Skripsi → Database: getKartuKonsultasiSkripsi(pengajuanDisposisiPembimbingId)
Database → Halaman Konsultasi Skripsi: kartuId, isCompleted, stageAktif
Halaman Konsultasi Skripsi → Mahasiswa / Dospem / Kaprodi: viewHalamanKonsultasiSkripsi()

Mahasiswa / Dospem / Kaprodi → Halaman Konsultasi Skripsi: Menekan tombol unduh kartu
Halaman Konsultasi Skripsi → Database: getKartuDocx(kartuId, pengajuanDisposisiPembimbingId)
Database → Halaman Konsultasi Skripsi: fileContent, fileName | null

alt [Dokumen tidak ditemukan]
Halaman Konsultasi Skripsi → Mahasiswa / Dospem / Kaprodi: showErrorMessage() → END

alt [Dokumen tersedia]
Halaman Konsultasi Skripsi → Mahasiswa / Dospem / Kaprodi: downloadFile(fileName)
Halaman Konsultasi Skripsi → Mahasiswa / Dospem / Kaprodi: showSuccessMessage()

END

---

### UC-KS-05: Memantau Konsultasi Skripsi
**Lifelines:** Kaprodi | Halaman Daftar Konsultasi Skripsi | Halaman Detail Konsultasi Skripsi | Database

Kaprodi → Halaman Daftar Konsultasi Skripsi: Membuka halaman daftar konsultasi skripsi
Halaman Daftar Konsultasi Skripsi → Database: getDaftarKonsultasiSkripsiByProdi(programStudiId)
Database → Halaman Daftar Konsultasi Skripsi: daftarKartu, activeChapterGroup, activeStage, activeStatus, isCompleted
Halaman Daftar Konsultasi Skripsi → Kaprodi: viewDaftarKonsultasiSkripsi()

Kaprodi → Halaman Daftar Konsultasi Skripsi: Memilih mahasiswa untuk melihat detail
Halaman Daftar Konsultasi Skripsi → Halaman Detail Konsultasi Skripsi: navigateToHalamanDetailKonsultasiSkripsi(pengajuanDisposisiPembimbingId)
Halaman Detail Konsultasi Skripsi → Database: getDetailKonsultasiSkripsi(pengajuanDisposisiPembimbingId)
Database → Halaman Detail Konsultasi Skripsi: kartu, stages, submissions, reviews, activeStageResolution
Halaman Detail Konsultasi Skripsi → Kaprodi: viewDetailKonsultasiSkripsi()

END

---

## PS — Pengajuan Sidang

### UC-PS-01: Mengajukan Berkas Sidang ke Kaprodi
**Lifelines:** Mahasiswa | Halaman Pengajuan Sidang | Database

Mahasiswa → Halaman Pengajuan Sidang: Membuka halaman Pengajuan Sidang
Halaman Pengajuan Sidang → Database: getStatusKonsultasiSkripsi(pengajuanDisposisiPembimbingId)
Database → Halaman Pengajuan Sidang: statusSkripsi

alt [Konsultasi skripsi belum COMPLETED]
Halaman Pengajuan Sidang → Mahasiswa: showErrorMessage() → END

alt [Konsultasi skripsi COMPLETED]
Halaman Pengajuan Sidang → Database: getPengajuanSidangKaprodi(pengajuanDisposisiPembimbingId)
Database → Halaman Pengajuan Sidang: kaprodiId, statusKaprodi, catatanKaprodi, dataDiri, dataPenguji, berkas | null

alt [Belum ada pengajuan]
Halaman Pengajuan Sidang → Mahasiswa: viewHalamanPengajuanSidang(statusKaprodi: null)
Mahasiswa → Halaman Pengajuan Sidang: Menekan tombol Mulai Pengajuan Sidang
Halaman Pengajuan Sidang → Database: initPengajuanSidangKaprodi(pengajuanDisposisiPembimbingId)
Database → Halaman Pengajuan Sidang: kaprodiId, sidangId
Halaman Pengajuan Sidang → Database: getSystemFiles(sidangId)
Database → Halaman Pengajuan Sidang: kartuKonsultasiSkripsi, skPenunjukanPembimbing, suratPernyataanPenyelesaian

alt [Sudah ada pengajuan]
Halaman Pengajuan Sidang → Database: getFileBerkasSidang(sidangId)
Database → Halaman Pengajuan Sidang: daftarBerkas, statusPerBerkas

Halaman Pengajuan Sidang → Mahasiswa: viewHalamanPengajuanSidang(dataDiri, dataPenguji, daftarBerkas, statusKaprodi, catatanKaprodi)

Mahasiswa → Halaman Pengajuan Sidang: Mengunggah berkas isi skripsi
Halaman Pengajuan Sidang → Halaman Pengajuan Sidang: validateData()

alt [Tidak valid]
Halaman Pengajuan Sidang → Mahasiswa: showErrorMessage() → END

alt [Valid]
Halaman Pengajuan Sidang → Database: uploadBerkasSidang(sidangId, fileType, fileContent, fileName, mimeType)
Database → Halaman Pengajuan Sidang: fileId, fileType, fileName, status

Halaman Pengajuan Sidang → Mahasiswa: viewHalamanPengajuanSidang()

Mahasiswa → Halaman Pengajuan Sidang: Mengisi data diri dan data ujian (tempat lahir, tgl lahir, alamat, no HP, no WA, status pernikahan, IPK, semua MK lulus, penguji1, penguji2)
Halaman Pengajuan Sidang → Database: simpanDataFormulir(kaprodiId, tempatLahir, tglLahir, alamat, noHp, noWa, statusPernikahan, ipk, semuaMkLulus, penguji1Nama, penguji1Nidn, penguji2Nama, penguji2Nidn)
Database → Halaman Pengajuan Sidang: ok

Mahasiswa → Halaman Pengajuan Sidang: Menekan tombol Ajukan ke Kaprodi
Halaman Pengajuan Sidang → Halaman Pengajuan Sidang: validateData()

alt [Tidak valid — formulir atau berkas tidak lengkap]
Halaman Pengajuan Sidang → Mahasiswa: showErrorMessage() → END

alt [Valid]
Halaman Pengajuan Sidang → Database: submitPengajuanSidangKaprodi(kaprodiId)
Database → Halaman Pengajuan Sidang: statusKaprodi, lembarPermohonanUjian, suratPernyataanPerbaikan, suratPernyataanKelengkapan, lembarUsulanPenguji

Halaman Pengajuan Sidang → Mahasiswa: showSuccessMessage()

END

---

### UC-PS-02: Memverifikasi Berkas Sidang oleh Kaprodi
**Lifelines:** Kaprodi | Halaman Daftar Pengajuan Sidang | Halaman Detail Pengajuan Sidang | Database

Kaprodi → Halaman Daftar Pengajuan Sidang: Membuka halaman daftar pengajuan sidang
Halaman Daftar Pengajuan Sidang → Database: getDaftarPengajuanSidangKaprodi(programStudiId)
Database → Halaman Daftar Pengajuan Sidang: daftarPengajuan
Halaman Daftar Pengajuan Sidang → Kaprodi: viewHalamanDaftarPengajuanSidang()

Kaprodi → Halaman Daftar Pengajuan Sidang: Memilih pengajuan milik mahasiswa
Halaman Daftar Pengajuan Sidang → Halaman Detail Pengajuan Sidang: navigateToHalamanDetailPengajuanSidang(pengajuanId)
Halaman Detail Pengajuan Sidang → Database: getDetailPengajuanSidangKaprodi(pengajuanId)
Database → Halaman Detail Pengajuan Sidang: dataMahasiswa, dataUjian, statusKaprodi, catatanKaprodi, tanggalReview
Halaman Detail Pengajuan Sidang → Database: getDaftarBerkasSidang(sidangId)
Database → Halaman Detail Pengajuan Sidang: daftarBerkas, statusVerifikasiPerBerkas
Halaman Detail Pengajuan Sidang → Kaprodi: viewDetailPengajuanSidang()

Kaprodi → Halaman Detail Pengajuan Sidang: Mengunduh berkas
Halaman Detail Pengajuan Sidang → Database: getBerkasSidang(sidangId, fileType)
Database → Halaman Detail Pengajuan Sidang: fileName, fileContent
Halaman Detail Pengajuan Sidang → Kaprodi: downloadFile(fileName)

Kaprodi → Halaman Detail Pengajuan Sidang: Menetapkan status verifikasi per berkas
Halaman Detail Pengajuan Sidang → Database: updateStatusBerkas(pengajuanId, fileType, statusVerifikasi)
Database → Halaman Detail Pengajuan Sidang: statusVerifikasi
Halaman Detail Pengajuan Sidang → Kaprodi: viewDetailPengajuanSidang()

Kaprodi → Halaman Detail Pengajuan Sidang: Mengambil keputusan akhir

alt [NEED_REVISION]
Kaprodi → Halaman Detail Pengajuan Sidang: Mengisi catatan revisi dan menekan Perlu Revisi
Halaman Detail Pengajuan Sidang → Database: reviewPengajuanSidangKaprodi(pengajuanId, action: NEED_REVISION, catatanKaprodi)
Database → Halaman Detail Pengajuan Sidang: statusKaprodi
Halaman Detail Pengajuan Sidang → Kaprodi: showSuccessMessage()

alt [VALID]
Kaprodi → Halaman Detail Pengajuan Sidang: Menekan tombol Valid
Halaman Detail Pengajuan Sidang → Halaman Detail Pengajuan Sidang: validateData()

alt [Tidak valid]
Halaman Detail Pengajuan Sidang → Kaprodi: showErrorMessage() → END

alt [Valid]
Halaman Detail Pengajuan Sidang → Database: reviewPengajuanSidangKaprodi(pengajuanId, action: VALID)
Database → Halaman Detail Pengajuan Sidang: statusKaprodi
Halaman Detail Pengajuan Sidang → Kaprodi: showSuccessMessage()

END

---

### UC-PS-03: Mengajukan Berkas Sidang ke Sekretariat
**Lifelines:** Mahasiswa | Halaman Pengajuan Sidang | Database

Mahasiswa → Halaman Pengajuan Sidang: Membuka halaman Pengajuan Sidang
Halaman Pengajuan Sidang → Database: getPengajuanSidangKaprodi(pengajuanDisposisiPembimbingId)
Database → Halaman Pengajuan Sidang: statusKaprodi

alt [Kaprodi belum VALID]
Halaman Pengajuan Sidang → Mahasiswa: showErrorMessage() → END

alt [Kaprodi sudah VALID]
Halaman Pengajuan Sidang → Database: initAndGetPengajuanSidang(pengajuanDisposisiPembimbingId)
Database → Halaman Pengajuan Sidang: sidangId, statusSidang, catatanSekretariat, daftarBerkas, statusVerifikasiPerBerkas
Halaman Pengajuan Sidang → Mahasiswa: viewHalamanPengajuanSidang(statusSidang, catatanSekretariat, daftarBerkas, statusVerifikasiPerBerkas)

Mahasiswa → Halaman Pengajuan Sidang: Mengunggah berkas administrasi
Halaman Pengajuan Sidang → Halaman Pengajuan Sidang: validateData()

alt [Tidak valid]
Halaman Pengajuan Sidang → Mahasiswa: showErrorMessage() → END

alt [Valid]
Halaman Pengajuan Sidang → Database: uploadBerkasSidang(sidangId, fileType, fileContent, fileName, mimeType)
Database → Halaman Pengajuan Sidang: fileId, fileType, fileName, status
Halaman Pengajuan Sidang → Mahasiswa: viewHalamanPengajuanSidang()

Mahasiswa → Halaman Pengajuan Sidang: Menekan tombol Ajukan ke Sekretariat
Halaman Pengajuan Sidang → Halaman Pengajuan Sidang: validateData()

alt [Tidak valid — berkas wajib belum lengkap]
Halaman Pengajuan Sidang → Mahasiswa: showErrorMessage() → END

alt [Valid]
Halaman Pengajuan Sidang → Database: submitPengajuanSidang(sidangId)
Database → Halaman Pengajuan Sidang: statusSidang
Halaman Pengajuan Sidang → Mahasiswa: showSuccessMessage()

END

---

### UC-PS-04: Memverifikasi Berkas Sidang oleh Sekretariat
**Lifelines:** Sekretariat | Halaman Daftar Pengajuan Sidang | Halaman Detail Pengajuan Sidang | Database

Sekretariat → Halaman Daftar Pengajuan Sidang: Membuka halaman daftar pengajuan sidang
Halaman Daftar Pengajuan Sidang → Database: getDaftarPengajuanSidang()
Database → Halaman Daftar Pengajuan Sidang: daftarPengajuan
Halaman Daftar Pengajuan Sidang → Sekretariat: viewHalamanDaftarPengajuanSidang()

Sekretariat → Halaman Daftar Pengajuan Sidang: Memilih pengajuan milik mahasiswa
Halaman Daftar Pengajuan Sidang → Halaman Detail Pengajuan Sidang: navigateToHalamanDetailPengajuanSidang(pengajuanId)
Halaman Detail Pengajuan Sidang → Database: getDetailPengajuanSidang(pengajuanId)
Database → Halaman Detail Pengajuan Sidang: dataMahasiswa, statusSidang, catatanSekretariat, daftarBerkas, statusVerifikasiPerBerkas
Halaman Detail Pengajuan Sidang → Sekretariat: viewDetailPengajuanSidang()

Sekretariat → Halaman Detail Pengajuan Sidang: Mengunduh berkas
Halaman Detail Pengajuan Sidang → Database: getBerkasSidang(sidangId, fileType)
Database → Halaman Detail Pengajuan Sidang: fileName, fileContent
Halaman Detail Pengajuan Sidang → Sekretariat: downloadFile(fileName)

Sekretariat → Halaman Detail Pengajuan Sidang: Menetapkan status verifikasi per berkas
Halaman Detail Pengajuan Sidang → Database: updateStatusBerkas(sidangId, fileType, statusVerifikasi)
Database → Halaman Detail Pengajuan Sidang: statusVerifikasi
Halaman Detail Pengajuan Sidang → Sekretariat: viewDetailPengajuanSidang()

Sekretariat → Halaman Detail Pengajuan Sidang: Mengambil keputusan akhir

alt [NEED_REVISION]
Sekretariat → Halaman Detail Pengajuan Sidang: Mengisi catatan revisi dan menekan Perlu Revisi
Halaman Detail Pengajuan Sidang → Database: verifikasiPengajuanSidang(sidangId, catatanSekretariat, action: NEED_REVISION)
Database → Halaman Detail Pengajuan Sidang: statusSidang
Halaman Detail Pengajuan Sidang → Sekretariat: showSuccessMessage()

alt [VERIFY]
Sekretariat → Halaman Detail Pengajuan Sidang: Menekan tombol Verifikasi
Halaman Detail Pengajuan Sidang → Halaman Detail Pengajuan Sidang: validateData()

alt [Tidak valid]
Halaman Detail Pengajuan Sidang → Sekretariat: showErrorMessage() → END

alt [Valid]
Halaman Detail Pengajuan Sidang → Database: verifikasiPengajuanSidang(sidangId, catatanSekretariat, action: VERIFY)
Database → Halaman Detail Pengajuan Sidang: statusSidang
Halaman Detail Pengajuan Sidang → Sekretariat: showSuccessMessage()

END

---

### UC-PS-05: Mengirim Disposisi
**Lifelines:** Kaprodi | Halaman Daftar Pengajuan Sidang | Halaman Disposisi | Database

Kaprodi → Halaman Daftar Pengajuan Sidang: Membuka halaman daftar pengajuan sidang
Halaman Daftar Pengajuan Sidang → Database: getDaftarPengajuanSidangKaprodi(programStudiId)
Database → Halaman Daftar Pengajuan Sidang: daftarPengajuan
Halaman Daftar Pengajuan Sidang → Kaprodi: viewHalamanDaftarPengajuanSidang()

Kaprodi → Halaman Daftar Pengajuan Sidang: Memilih pengajuan yang sudah diverifikasi Sekretariat
Halaman Daftar Pengajuan Sidang → Halaman Disposisi: navigateToHalamanDisposisi(pengajuanId)
Halaman Disposisi → Database: getDetailPengajuanSidangKaprodi(pengajuanId)
Database → Halaman Disposisi: dataMahasiswa, dataUjianMahasiswa, jadwalSidang, penguji1, penguji2, statusKaprodi
Halaman Disposisi → Database: getDaftarDosen()
Database → Halaman Disposisi: daftarDosen
Halaman Disposisi → Kaprodi: viewHalamanDisposisi(dataUjianMahasiswa, jadwalSidang, penguji1, penguji2)

Kaprodi → Halaman Disposisi: Mengisi jadwal sidang (tanggal, waktu, tempat) dan menetapkan penguji
Kaprodi → Halaman Disposisi: Menekan tombol Kirim Disposisi
Halaman Disposisi → Halaman Disposisi: validateData()

alt [Tidak valid — jadwal atau penguji belum lengkap]
Halaman Disposisi → Kaprodi: showErrorMessage() → END

alt [Valid]
Halaman Disposisi → Database: simpanDataDisposisi(pengajuanId, tanggalSidang, waktuSidang, tempatSidang, penguji1Nama, penguji1Nidn, penguji2Nama, penguji2Nidn, tanggalDisposisi)
Database → Halaman Disposisi: ok
Halaman Disposisi → Database: submitDisposisi(pengajuanId)
Database → Halaman Disposisi: statusKaprodi, statusSidang
Halaman Disposisi → Kaprodi: showSuccessMessage()

END

---

### UC-PS-06: Menerbitkan Surat Undangan Sidang
**Lifelines:** Sekretariat | Halaman Disposisi Sidang | Database

Sekretariat → Halaman Disposisi Sidang: Membuka halaman disposisi sidang
Halaman Disposisi Sidang → Database: getDaftarDisposisiSidang()
Database → Halaman Disposisi Sidang: daftarPengajuan, statusKaprodi, jadwalSidang, penguji1, penguji2
Halaman Disposisi Sidang → Sekretariat: viewHalamanDisposisiSidang()

Sekretariat → Halaman Disposisi Sidang: Menekan tombol Buat Surat Undangan pada pengajuan yang sudah DISPOSISI_SENT
Halaman Disposisi Sidang → Database: generateSuratUndanganSidang(pengajuanDisposisiPembimbingId)
Database → Halaman Disposisi Sidang: statusSidang, fileSuratUndangan

Halaman Disposisi Sidang → Sekretariat: showSuccessMessage()

END

---

## SS — Sidang Skripsi

### UC-SS-01: Memulai Sidang
**Lifelines:** Pembimbing 1 | Halaman Daftar Sidang | Halaman Sidang | Database

Pembimbing 1 → Halaman Daftar Sidang: Membuka halaman daftar sidang
Halaman Daftar Sidang → Database: getDaftarSidang(nidn)
Database → Halaman Daftar Sidang: daftarSidang, callerRole, statusPenilaian, statusNotulen
Halaman Daftar Sidang → Pembimbing 1: viewHalamanDaftarSidang()

Pembimbing 1 → Halaman Daftar Sidang: Memilih sidang dan membuka detail
Halaman Daftar Sidang → Halaman Sidang: navigateToHalamanSidang(pengajuanDisposisiPembimbingId)
Halaman Sidang → Database: getSidang(pengajuanDisposisiPembimbingId)
Database → Halaman Sidang: sidangId, status, tanggalSidang, waktuSidang, tempatSidang, namaMahasiswa, npm, judulSkripsi, pembimbing1Nama, pembimbing2Nama, penguji1Nama, penguji1Nidn, penguji2Nama, penguji2Nidn, penilaian[], notulen[]

alt [Sidang tidak ditemukan]
Halaman Sidang → Pembimbing 1: showErrorMessage() → END

alt [Sidang ditemukan]
Halaman Sidang → Pembimbing 1: viewHalamanSidang(status, infoSidang, statusPenilaianPeserta)

Pembimbing 1 → Halaman Sidang: Menekan tombol Mulai Sidang
Halaman Sidang → Database: startSidang(pengajuanDisposisiPembimbingId)
Database → Halaman Sidang: ok
Halaman Sidang → Database: getSidang(pengajuanDisposisiPembimbingId)
Database → Halaman Sidang: sidangId, status, penilaian[], notulen[]
Halaman Sidang → Pembimbing 1: viewHalamanSidang(status, formulirPenilaian, formulirNotulen)

END

---

### UC-SS-02: Mengisi Penilaian dan Notulen
**Lifelines:** Dosen Peserta Sidang | Halaman Daftar Sidang | Halaman Sidang | Database

Dosen Peserta Sidang → Halaman Daftar Sidang: Membuka halaman daftar sidang
Halaman Daftar Sidang → Database: getDaftarSidang(nidn)
Database → Halaman Daftar Sidang: daftarSidang, callerRole, statusPenilaian, statusNotulen
Halaman Daftar Sidang → Dosen Peserta Sidang: viewHalamanDaftarSidang()

Dosen Peserta Sidang → Halaman Daftar Sidang: Memilih sidang dan membuka detail
Halaman Daftar Sidang → Halaman Sidang: navigateToHalamanSidang(pengajuanDisposisiPembimbingId)
Halaman Sidang → Database: getSidang(pengajuanDisposisiPembimbingId)
Database → Halaman Sidang: sidangId, status, penilaian[], notulen[]
Halaman Sidang → Dosen Peserta Sidang: viewHalamanSidang(status, formulirPenilaian, formulirNotulen)

Dosen Peserta Sidang → Halaman Sidang: Mengisi formulir penilaian dan menekan tombol Simpan Penilaian
Halaman Sidang → Halaman Sidang: validateData()

alt [Tidak valid — nilai di luar rentang atau tidak lengkap]
Halaman Sidang → Dosen Peserta Sidang: showErrorMessage() → END

alt [Valid]
Halaman Sidang → Database: savePenilaian(pengajuanDisposisiPembimbingId, nilaiIsi, keteranganIsi, nilaiBahasa, keteranganBahasa, nilaiTsp, keteranganTsp, nilaiPenguasaan, keteranganPenguasaan, nilaiPenunjang, keteranganPenunjang)
Database → Halaman Sidang: ok
Halaman Sidang → Database: getSidang(pengajuanDisposisiPembimbingId)
Database → Halaman Sidang: sidangId, status, penilaian[], notulen[]
Halaman Sidang → Dosen Peserta Sidang: showSuccessMessage()

alt [Dosen adalah Pembimbing]
END

alt [Dosen adalah Penguji]
Dosen Peserta Sidang → Halaman Sidang: Mengisi formulir notulen dan menekan tombol Simpan Notulen
Halaman Sidang → Halaman Sidang: validateData()

alt [Tidak valid — catatan kosong]
Halaman Sidang → Dosen Peserta Sidang: showErrorMessage() → END

alt [Valid]
Halaman Sidang → Database: saveNotulen(pengajuanDisposisiPembimbingId, note)
Database → Halaman Sidang: ok
Halaman Sidang → Database: getSidang(pengajuanDisposisiPembimbingId)
Database → Halaman Sidang: sidangId, status, penilaian[], notulen[]
Halaman Sidang → Dosen Peserta Sidang: showSuccessMessage()

END

---

### UC-SS-03: Menyimpan Hasil Penilaian Akhir
**Lifelines:** Pembimbing 1 | Halaman Daftar Sidang | Halaman Sidang | Database

Pembimbing 1 → Halaman Daftar Sidang: Membuka halaman daftar sidang
Halaman Daftar Sidang → Database: getDaftarSidang(nidn)
Database → Halaman Daftar Sidang: daftarSidang, callerRole, statusPenilaian, statusNotulen
Halaman Daftar Sidang → Pembimbing 1: viewHalamanDaftarSidang()

Pembimbing 1 → Halaman Daftar Sidang: Memilih sidang dan membuka detail
Halaman Daftar Sidang → Halaman Sidang: navigateToHalamanSidang(pengajuanDisposisiPembimbingId)
Halaman Sidang → Database: getSidang(pengajuanDisposisiPembimbingId)
Database → Halaman Sidang: sidangId, status, penilaian[], notulen[], hasilPenilaian
Halaman Sidang → Pembimbing 1: viewHalamanSidang(status, statusPenilaianPeserta, formulirHasilPenilaianAkhir)

Pembimbing 1 → Halaman Sidang: Mengisi hasil akhir sidang (LULUS/TIDAK_LULUS) dan catatan penguji, lalu menekan tombol Simpan Hasil Penilaian Akhir
Halaman Sidang → Halaman Sidang: validateData()

alt [Tidak valid — hasil akhir belum dipilih]
Halaman Sidang → Pembimbing 1: showErrorMessage() → END

alt [Valid]
Halaman Sidang → Database: saveHasilPenilaian(pengajuanDisposisiPembimbingId, hasilSidang, catatanPenguji)
Database → Halaman Sidang: ok
Halaman Sidang → Database: getSidang(pengajuanDisposisiPembimbingId)
Database → Halaman Sidang: sidangId, status: COMPLETED, hasilPenilaian
Halaman Sidang → Pembimbing 1: showSuccessMessage()

END

---

### UC-SS-04: Mengunduh Dokumen Sidang
**Lifelines:** Aktor | Halaman Daftar Sidang | Halaman Sidang | Database

Aktor → Halaman Daftar Sidang: Membuka halaman daftar sidang
Halaman Daftar Sidang → Database: getDaftarSidang(nidn)
Database → Halaman Daftar Sidang: daftarSidang, callerRole, statusPenilaian, statusNotulen
Halaman Daftar Sidang → Aktor: viewHalamanDaftarSidang()

Aktor → Halaman Daftar Sidang: Memilih sidang dan membuka detail
Halaman Daftar Sidang → Halaman Sidang: navigateToHalamanSidang(pengajuanDisposisiPembimbingId)
Halaman Sidang → Database: getSidang(pengajuanDisposisiPembimbingId)
Database → Halaman Sidang: sidangId, status, penilaian[], notulen[], hasilPenilaian, files[]
Halaman Sidang → Aktor: viewHalamanSidang(status, daftarDokumen)

Aktor → Halaman Sidang: Menekan tombol unduh dokumen
Halaman Sidang → Database: getFileSidang(pengajuanDisposisiPembimbingId, fileType, role?)
Database → Halaman Sidang: fileName, fileContent

alt [Dokumen belum tersedia atau aktor tidak memiliki hak akses]
Halaman Sidang → Aktor: showErrorMessage() → END

alt [Berhasil]
Halaman Sidang → Aktor: downloadFile(fileName)

END

---

### UC-SS-05: Memantau Sidang Skripsi
**Lifelines:** Sekretariat / Kaprodi | Halaman Daftar Sidang | Halaman Detail Sidang | Database

Sekretariat / Kaprodi → Halaman Daftar Sidang: Membuka halaman daftar sidang
Halaman Daftar Sidang → Database: getDaftarSidang(status?)
Database → Halaman Daftar Sidang: daftarSidang, statusSidang, rata, grade
Halaman Daftar Sidang → Sekretariat / Kaprodi: viewHalamanDaftarSidang()

Sekretariat / Kaprodi → Halaman Daftar Sidang: Memilih sidang dan membuka detail
Halaman Daftar Sidang → Halaman Detail Sidang: navigateToHalamanDetailSidang(pengajuanDisposisiPembimbingId)
Halaman Detail Sidang → Database: getSidang(pengajuanDisposisiPembimbingId)
Database → Halaman Detail Sidang: sidangId, status, infoSidang, penilaian[], notulen[], hasilPenilaian
Halaman Detail Sidang → Sekretariat / Kaprodi: viewHalamanDetailSidang(status, infoSidang, nilaiPeserta, hasilPenilaian)

END

---

## RPS — Revisi Pasca Sidang

### UC-RPS-01: Menginisiasi Revisi Pasca Sidang
**Lifelines:** Mahasiswa | Halaman Revisi Pasca Sidang | Database

Mahasiswa → Halaman Revisi Pasca Sidang: Membuka halaman Revisi Pasca Sidang
Halaman Revisi Pasca Sidang → Database: getSidangTerakhir(skripsiId)
Database → Halaman Revisi Pasca Sidang: sidangId, statusSidang, hasilSidang

alt [Sidang belum COMPLETED]
Halaman Revisi Pasca Sidang → Mahasiswa: showErrorMessage() → END

alt [Sidang COMPLETED]
Halaman Revisi Pasca Sidang → Database: initRevisi(skripsiId)
Database → Halaman Revisi Pasca Sidang: revisiId, isCompleted, stageAktif (signerRole, currentStatus)
Halaman Revisi Pasca Sidang → Mahasiswa: viewHalamanRevisiPascaSidang(stageAktif, riwayatSubmission)

END

---

### UC-RPS-02: Mengumpulkan Berkas Revisi
**Lifelines:** Mahasiswa | Halaman Revisi Pasca Sidang | Database

Mahasiswa → Halaman Revisi Pasca Sidang: Membuka halaman Revisi Pasca Sidang
Halaman Revisi Pasca Sidang → Database: getRevisiPascaSidang(skripsiId)
Database → Halaman Revisi Pasca Sidang: revisiId, isCompleted, stages, stageAktif (signerRole, currentStatus, catatan)
Halaman Revisi Pasca Sidang → Mahasiswa: viewHalamanRevisiPascaSidang(stageAktif, riwayatSubmission, catatanRevisi)

Mahasiswa → Halaman Revisi Pasca Sidang: Mengunggah berkas revisi dan menekan tombol Kumpulkan
Halaman Revisi Pasca Sidang → Halaman Revisi Pasca Sidang: validateData()

alt [Tidak valid]
Halaman Revisi Pasca Sidang → Mahasiswa: showErrorMessage() → END

alt [Valid]
Halaman Revisi Pasca Sidang → Database: submitRevisi(skripsiId, fileContent, fileName)

alt [Tidak ada tahap aktif atau revisi sudah selesai]
Database → Halaman Revisi Pasca Sidang: error
Halaman Revisi Pasca Sidang → Mahasiswa: showErrorMessage() → END

alt [Tahap aktif tersedia]
Database → Halaman Revisi Pasca Sidang: stageId, signerRole, submissionNo
Halaman Revisi Pasca Sidang → Mahasiswa: showSuccessMessage()

END

---

### UC-RPS-03: Mereview Berkas Revisi
**Lifelines:** Dosen | Halaman Daftar Revisi Pasca Sidang | Halaman Detail Revisi Pasca Sidang | Database

Dosen → Halaman Daftar Revisi Pasca Sidang: Membuka daftar revisi pasca sidang
Halaman Daftar Revisi Pasca Sidang → Database: getDaftarRevisiPascaSidang(nidn)
Database → Halaman Daftar Revisi Pasca Sidang: daftarRevisi, stageAktif, canReview
Halaman Daftar Revisi Pasca Sidang → Dosen: viewDaftarRevisiPascaSidang()

Dosen → Halaman Daftar Revisi Pasca Sidang: Memilih mahasiswa yang berkasnya menunggu review
Halaman Daftar Revisi Pasca Sidang → Halaman Detail Revisi Pasca Sidang: navigateToHalamanDetailRevisiPascaSidang(skripsiId)
Halaman Detail Revisi Pasca Sidang → Database: getDetailRevisiPascaSidang(skripsiId, nidn)
Database → Halaman Detail Revisi Pasca Sidang: revisiId, stageAktif, riwayatSubmission, latestSubmission
Halaman Detail Revisi Pasca Sidang → Dosen: viewDetailRevisiPascaSidang()

Dosen → Halaman Detail Revisi Pasca Sidang: Mengisi catatan dan memilih keputusan, lalu menekan tombol Simpan Review
Halaman Detail Revisi Pasca Sidang → Halaman Detail Revisi Pasca Sidang: validateData()

alt [Tidak valid]
Halaman Detail Revisi Pasca Sidang → Dosen: showErrorMessage() → END

alt [Valid]

alt [Keputusan NEED_REVISION]
Halaman Detail Revisi Pasca Sidang → Database: reviewRevisi(skripsiId, decision: NEED_REVISION, catatan)
Database → Halaman Detail Revisi Pasca Sidang: stageAktif, currentStatus
Halaman Detail Revisi Pasca Sidang → Dosen: showSuccessMessage() → END

alt [Keputusan APPROVED, bukan tahap terakhir]
Halaman Detail Revisi Pasca Sidang → Database: reviewRevisi(skripsiId, decision: APPROVED)
Database → Halaman Detail Revisi Pasca Sidang: stageAktif (signerRole: tahap berikutnya), notulenRegenerated (jika penguji)
Halaman Detail Revisi Pasca Sidang → Dosen: showSuccessMessage() → END

alt [Keputusan APPROVED, Pembimbing 1 — tahap terakhir, hasil TIDAK_LULUS]
Halaman Detail Revisi Pasca Sidang → Database: reviewRevisi(skripsiId, decision: APPROVED)
Database → Halaman Detail Revisi Pasca Sidang: isCompleted: true, pengajuanSidangBaruId
Halaman Detail Revisi Pasca Sidang → Dosen: showSuccessMessage() → END

alt [Keputusan APPROVED, Pembimbing 1 — tahap terakhir, hasil LULUS]
Halaman Detail Revisi Pasca Sidang → Database: reviewRevisi(skripsiId, decision: APPROVED)
Database → Halaman Detail Revisi Pasca Sidang: isCompleted: true, halamanMajelisFileName, halamanDekanFileName
Halaman Detail Revisi Pasca Sidang → Dosen: showSuccessMessage()

END

---

### UC-RPS-04: Mengunduh Dokumen Pengesahan
**Lifelines:** Aktor | Halaman Revisi Pasca Sidang | Database

Aktor → Halaman Revisi Pasca Sidang: Membuka halaman Revisi Pasca Sidang
Halaman Revisi Pasca Sidang → Database: getRevisiPascaSidang(skripsiId)
Database → Halaman Revisi Pasca Sidang: isCompleted, files (halamanMajelisAvailable, halamanDekanAvailable)
Halaman Revisi Pasca Sidang → Aktor: viewHalamanRevisiPascaSidang()

Aktor → Halaman Revisi Pasca Sidang: Menekan tombol unduh dokumen pengesahan (Majelis Penguji atau Dekan)
Halaman Revisi Pasca Sidang → Database: getDokumenPengesahan(skripsiId, fileType)
Database → Halaman Revisi Pasca Sidang: fileContent, fileName | null

alt [Dokumen belum tersedia]
Halaman Revisi Pasca Sidang → Aktor: showErrorMessage() → END

alt [Dokumen tersedia]
Halaman Revisi Pasca Sidang → Aktor: downloadFile(fileName)
Halaman Revisi Pasca Sidang → Aktor: showSuccessMessage()

END

---

### UC-RPS-05: Memantau Revisi Pasca Sidang
**Lifelines:** Dosen | Halaman Daftar Revisi Pasca Sidang | Halaman Detail Revisi Pasca Sidang | Database

Dosen → Halaman Daftar Revisi Pasca Sidang: Membuka halaman daftar revisi pasca sidang
Halaman Daftar Revisi Pasca Sidang → Database: getDaftarRevisiPascaSidang(nidn)
Database → Halaman Daftar Revisi Pasca Sidang: daftarRevisi, stageAktif per mahasiswa, isCompleted
Halaman Daftar Revisi Pasca Sidang → Dosen: viewDaftarRevisiPascaSidang()

Dosen → Halaman Daftar Revisi Pasca Sidang: Memilih mahasiswa untuk melihat detail
Halaman Daftar Revisi Pasca Sidang → Halaman Detail Revisi Pasca Sidang: navigateToHalamanDetailRevisiPascaSidang(skripsiId)
Halaman Detail Revisi Pasca Sidang → Database: getDetailRevisiPascaSidang(skripsiId, nidn)
Database → Halaman Detail Revisi Pasca Sidang: revisi, stages, submissions, reviews, stageAktif
Halaman Detail Revisi Pasca Sidang → Dosen: viewDetailRevisiPascaSidang()

END

---

## PBF — Pengumpulan Berkas Final

### UC-PBF-01: Menginisiasi Pengumpulan Berkas Final
**Lifelines:** Mahasiswa | Halaman Pengumpulan Berkas Final | Database

Mahasiswa → Halaman Pengumpulan Berkas Final: Membuka halaman Pengumpulan Berkas Final
Halaman Pengumpulan Berkas Final → Database: checkPrasyarat(skripsiId)
Database → Halaman Pengumpulan Berkas Final: revisiIsCompleted, hasilSidangTerakhir

alt [Prasyarat belum terpenuhi]
Halaman Pengumpulan Berkas Final → Mahasiswa: showErrorMessage() → END

alt [Prasyarat terpenuhi]
Halaman Pengumpulan Berkas Final → Database: initPengumpulan(skripsiId)
Database → Halaman Pengumpulan Berkas Final: pengumpulanId, status (DRAFT atau existing)
Halaman Pengumpulan Berkas Final → Mahasiswa: viewHalamanPengumpulanBerkasFinal(pengumpulanId, status)

END

---

### UC-PBF-02: Mengunggah dan Mengirim Berkas Final
**Lifelines:** Mahasiswa | Halaman Pengumpulan Berkas Final | Database

Mahasiswa → Halaman Pengumpulan Berkas Final: Membuka halaman Pengumpulan Berkas Final
Halaman Pengumpulan Berkas Final → Database: getPengumpulan(skripsiId)
Database → Halaman Pengumpulan Berkas Final: pengumpulanId, status, files
Halaman Pengumpulan Berkas Final → Mahasiswa: viewHalamanPengumpulanBerkasFinal(pengumpulanId, status, files)

Mahasiswa → Halaman Pengumpulan Berkas Final: Mengunggah FILE_SKRIPSI dan ARTIKEL_PENELITIAN, lalu menekan tombol Kirim
Halaman Pengumpulan Berkas Final → Halaman Pengumpulan Berkas Final: validateData()

alt [Tidak valid]
Halaman Pengumpulan Berkas Final → Mahasiswa: showErrorMessage() → END

alt [Valid]
Halaman Pengumpulan Berkas Final → Database: submitPengumpulan(skripsiId, fileSkripsi, artikelPenelitian)

alt [Status bukan DRAFT atau SUBMITTED]
Database → Halaman Pengumpulan Berkas Final: error
Halaman Pengumpulan Berkas Final → Mahasiswa: showErrorMessage() → END

alt [Status valid]
Database → Halaman Pengumpulan Berkas Final: pengumpulanId, status: SUBMITTED, confirmations (6 baris baru)
Halaman Pengumpulan Berkas Final → Mahasiswa: showSuccessMessage()

END

---

### UC-PBF-03: Mengkonfirmasi Penerimaan Berkas
**Lifelines:** Penerima | Halaman Pengumpulan Berkas Final | Database

Penerima → Halaman Pengumpulan Berkas Final: Membuka halaman Pengumpulan Berkas Final
Halaman Pengumpulan Berkas Final → Database: getPengumpulan(skripsiId)
Database → Halaman Pengumpulan Berkas Final: pengumpulanId, status, confirmations (termasuk status konfirmasi aktor)
Halaman Pengumpulan Berkas Final → Penerima: viewHalamanPengumpulanBerkasFinal(status, confirmations)

Penerima → Halaman Pengumpulan Berkas Final: Menekan tombol Konfirmasi
Halaman Pengumpulan Berkas Final → Database: confirmPengumpulan(skripsiId)

alt [Aktor bukan penerima atau sudah konfirmasi]
Database → Halaman Pengumpulan Berkas Final: error
Halaman Pengumpulan Berkas Final → Penerima: showErrorMessage() → END

alt [Konfirmasi berhasil, belum semua 6 konfirmasi]
Database → Halaman Pengumpulan Berkas Final: confirmedAt, totalConfirmed, status: SUBMITTED
Halaman Pengumpulan Berkas Final → Penerima: showSuccessMessage() → END

alt [Konfirmasi berhasil, semua 6 sudah konfirmasi]
Database → Halaman Pengumpulan Berkas Final: confirmedAt, totalConfirmed, status: WAITING_SIGNATURE, suratFileName
Halaman Pengumpulan Berkas Final → Penerima: showSuccessMessage()

END

---

### UC-PBF-04: Menandatangani Surat Penyerahan
**Lifelines:** Sekretaris Prodi | Halaman Pengumpulan Berkas Final | Database

Sekretaris Prodi → Halaman Pengumpulan Berkas Final: Membuka halaman Pengumpulan Berkas Final
Halaman Pengumpulan Berkas Final → Database: getPengumpulan(skripsiId)
Database → Halaman Pengumpulan Berkas Final: pengumpulanId, status, confirmations
Halaman Pengumpulan Berkas Final → Sekretaris Prodi: viewHalamanPengumpulanBerkasFinal(status, confirmations)

Sekretaris Prodi → Halaman Pengumpulan Berkas Final: Menekan tombol Tandatangani
Halaman Pengumpulan Berkas Final → Database: signPengumpulan(skripsiId)

alt [Aktor bukan Sekretaris Prodi yang sesuai atau status bukan WAITING_SIGNATURE]
Database → Halaman Pengumpulan Berkas Final: error
Halaman Pengumpulan Berkas Final → Sekretaris Prodi: showErrorMessage() → END

alt [Valid]
Database → Halaman Pengumpulan Berkas Final: status: COMPLETED, isCompleted: true, suratFileName
Halaman Pengumpulan Berkas Final → Sekretaris Prodi: showSuccessMessage()

END

---

### UC-PBF-05: Mengunduh Surat Pernyataan Penyerahan
**Lifelines:** Aktor | Halaman Pengumpulan Berkas Final | Database

Aktor → Halaman Pengumpulan Berkas Final: Membuka halaman Pengumpulan Berkas Final dan menekan tombol unduh Surat Pernyataan Penyerahan
Halaman Pengumpulan Berkas Final → Database: getFile(skripsiId, fileType: SURAT_PERNYATAAN_PENYERAHAN)
Database → Halaman Pengumpulan Berkas Final: fileContent, fileName | null

alt [Dokumen belum tersedia]
Halaman Pengumpulan Berkas Final → Aktor: showErrorMessage() → END

alt [Dokumen tersedia]
Halaman Pengumpulan Berkas Final → Aktor: downloadFile(fileName)
Halaman Pengumpulan Berkas Final → Aktor: showSuccessMessage()

END

---

### UC-PBF-06: Memantau Pengumpulan Berkas Final
**Lifelines:** Aktor | Halaman Daftar Pengumpulan Berkas Final | Database

Aktor → Halaman Daftar Pengumpulan Berkas Final: Membuka halaman daftar Pengumpulan Berkas Final
Halaman Daftar Pengumpulan Berkas Final → Database: getDaftarPengumpulan(aktorRole, nidn/userId)

alt [Aktor adalah Dosen]
Database → Halaman Daftar Pengumpulan Berkas Final: daftarPengumpulan (NIDN match), callerConfirmedAt per item

alt [Aktor adalah Perpustakaan atau LPPM]
Database → Halaman Daftar Pengumpulan Berkas Final: daftarPengumpulan (semua prodi, status >= SUBMITTED)

alt [Aktor adalah Sekretaris Prodi]
Database → Halaman Daftar Pengumpulan Berkas Final: daftarPengumpulan (prodi aktor)

Halaman Daftar Pengumpulan Berkas Final → Aktor: viewDaftarPengumpulanBerkasFinal(daftarPengumpulan)

END
