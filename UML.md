# UML Documentation: Sistem Skripsi

## Style Guide

This section defines how Use Cases, Activity Diagrams, and Sequence Diagrams should be written for this project. Follow these rules strictly when producing new UML artifacts.

---

### Use Case Style

- Written as a structured document, not a diagram
- Each use case has: **Actor**, **Precondition**, **Summary**, **Postcondition**
- Use Cases should map to **user goals**, not individual endpoint calls
- Keep the number of use cases minimal — sub-steps that belong to the same goal should be folded into one use case
- Avoid including rare/edge cases (e.g. REJECT) unless they represent a meaningful user goal
- Use Bahasa Indonesia for all labels and descriptions
- Use case relationships (<<include>>, <<extend>>) are noted at the end of the use case section if needed

---

### Activity Diagram Style

- Written as numbered text steps with actor labels in brackets, e.g. `[Mahasiswa]`, `[Sistem]`, `[Sekretariat]`
- Always starts with `START` and ends with `END`
- Declare **Swimlanes** at the top, e.g. `Swimlanes: Mahasiswa | Sistem Skripsi`
- Decision points use `[Decision]` label with branching arrows `→`; when multiple decision points exist in one diagram, number them sequentially: `[Decision 1]`, `[Decision 2]`, etc.
- Keep steps **high-level** — do not include specific method names, HTTP endpoints, or database field names; those belong in the Sequence Diagram
- Notifications are **excluded** from all diagrams
- Each swimlane actor should only appear in steps that belong to them
- File upload steps always include a `[Sistem] Memvalidasi berkas` step followed by a `[Decision]` with a loop-back arrow to the upload step on failure, e.g. `→ Tidak valid: [Sistem] Menampilkan pesan gagal → kembali ke <upload step>`
- Preconditions stated in the use case (e.g. record sudah terbuat, status sudah memenuhi syarat) are **not repeated** as decision nodes in the activity diagram — assume they are already satisfied when the diagram starts

---

### Sequence Diagram Style

- Written as arrow-based message flows, not a visual diagram
- Declare **Lifelines** at the top, e.g. `Lifelines: Mahasiswa | Halaman SK Penelitian | Database`
- Always starts with the actor opening a page and ends with `END`
- **Lifeline naming conventions:**
  - Actor lifelines: `Mahasiswa`, `Sekretariat`, `Dosen`, etc.
  - Page lifelines: `Halaman [Nama Halaman]` — one lifeline per distinct page; if a flow navigates between two pages, use two separate page lifelines
  - Always include `Database` as the last lifeline
- **Message conventions:**
  - Actor → Page: plain Bahasa Indonesia action description, e.g. `Membuka halaman SK Penelitian`
  - Page → Database: method call with parameters, e.g. `getSKPenelitian(pengajuanDisposisiPembimbingId)`
  - Database → Page: specific return properties, e.g. `statusSKPenelitian, catatanRevisi, berkasYangPerluDilengkapi` — never use vague terms like "Return data" or "berkas"
  - Page → Actor: display or feedback calls, e.g. `viewHalamanSKPenelitian()`, `showSuccessMessage()`, `showErrorMessage()`
  - Page → Page (self-call): used for validation, e.g. `validateData()`
  - Navigation between pages: `navigateTo[NamaHalaman](params)` — always include route parameters needed by the target page, e.g. `navigateToHalamanDetailSKPenelitian(pengajuanDisposisiPembimbingId)`, `navigateToHalamanDetailKonsultasiSkripsi(stageId)`
- **Alt frames:**
  - Used for branching conditions, written as `alt [Condition]`
  - Failed preconditions branch to `showErrorMessage()` then `END`
  - Each branch ends with `showSuccessMessage()` if it is a successful action from the actor's perspective
- **Exclusions:**
  - No notification-related calls (insertNotifikasi, etc.)
  - No raw HTTP endpoints (GET /..., POST /...)
  - No generic return messages ("Return sukses", "Return data")

---

## Use Cases

### UC-KS-01: Memulai Konsultasi Skripsi

- **Actor:** Mahasiswa
- **Precondition:** SK Penelitian telah diterbitkan (status COMPLETED)
- **Summary:** Mahasiswa menginisialisasi kartu konsultasi skripsi. Sistem membuat kartu baru dan membuka tahap pertama (Bab 1 & 2, Pembimbing 2) secara otomatis.
- **Postcondition:** Kartu konsultasi skripsi terbuat dan mahasiswa dapat mulai mengumpulkan berkas bab.

### UC-KS-02: Mengumpulkan Berkas Bab

- **Actor:** Mahasiswa
- **Precondition:** Kartu konsultasi skripsi telah dibuat dan terdapat stage aktif yang menunggu pengumpulan atau perbaikan
- **Summary:** Mahasiswa mengunggah berkas bab sesuai stage yang sedang aktif. Jika sebelumnya mendapat catatan revisi dari pembimbing, mahasiswa mengunggah ulang berkas yang sudah diperbaiki pada stage yang sama.
- **Postcondition:** Berkas terkirim ke pembimbing terkait untuk direview.

### UC-KS-03: Mereview Berkas Bab

- **Actor:** Dosen Pembimbing
- **Precondition:** Mahasiswa telah mengumpulkan berkas bab pada stage milik dosen yang bersangkutan
- **Summary:** Dosen memeriksa berkas bab yang dikumpulkan mahasiswa dan memberikan keputusan. Pembimbing 2 memilih antara melanjutkan ke Pembimbing 1 atau meminta revisi. Pembimbing 1 memilih antara menerima atau meminta revisi. Jika keputusan final (lanjut atau diterima), tanda tangan dosen tersimpan otomatis ke kartu.
- **Postcondition:** Status stage diperbarui. Jika Pembimbing 1 menerima bab terakhir (Bab 5), konsultasi selesai dan kartu penulisan skripsi di-generate otomatis.

### UC-KS-04: Mengunduh Kartu Penulisan Skripsi

- **Actor:** Mahasiswa, Dosen Pembimbing, Kaprodi
- **Precondition:** Kartu konsultasi skripsi telah dibuat
- **Summary:** Aktor mengunduh kartu penulisan skripsi dalam format DOCX. Jika konsultasi belum selesai, yang tersedia adalah versi preview yang mencerminkan progres terkini. Jika konsultasi sudah selesai, yang tersedia adalah versi final yang telah tersimpan di sistem.
- **Postcondition:** Berkas DOCX kartu penulisan skripsi terunduh.

### UC-KS-05: Memantau Konsultasi Skripsi

- **Actor:** Kaprodi
- **Precondition:** Terdapat mahasiswa di program studi Kaprodi yang sedang atau telah menjalani konsultasi skripsi
- **Summary:** Kaprodi melihat daftar seluruh konsultasi skripsi di program studinya beserta status progres masing-masing. Kaprodi dapat membuka detail konsultasi milik mahasiswa tertentu untuk melihat riwayat pengumpulan dan review per bab.
- **Postcondition:** Kaprodi memperoleh informasi progres konsultasi skripsi mahasiswa.

---

## Use Cases

### UC-SS-01: Memulai Sidang

- **Actor:** Pembimbing 1
- **Precondition:** Record sidang telah terbuat (status `SCHEDULED`), dipicu oleh penerbitan Surat Undangan Sidang
- **Summary:** Pembimbing 1 membuka halaman sidang dan memulai sesi sidang. Sistem mengubah status sidang menjadi `ONGOING` sehingga seluruh peserta dapat mengisi penilaian dan notulen.
- **Postcondition:** Sidang berstatus `ONGOING` dan formulir penilaian/notulen dapat diisi.

### UC-SS-02: Mengisi Penilaian dan Notulen

- **Actor:** Dosen Peserta Sidang (Pembimbing 1, Pembimbing 2, Penguji 1, Penguji 2)
- **Precondition:** Sidang berstatus `ONGOING`
- **Summary:** Setiap dosen peserta sidang mengisi formulir penilaian (nilai komponen: isi, bahasa, TSP, penguasaan, penunjang). Sistem menghitung total nilai berbobot dan men-generate dokumen formulir penilaian secara otomatis; jika dosen mengisi ulang, dokumen sebelumnya di-overwrite. Penguji juga mengisi notulen berupa catatan ujian; catatan tersebut disimpan tanpa generate dokumen pada tahap ini. Dosen dapat mengisi ulang selama sidang masih `ONGOING`.
- **Postcondition:** Penilaian dan/atau notulen tersimpan. Dokumen formulir penilaian ter-generate (atau di-overwrite) untuk setiap peserta yang telah mengisi.

### UC-SS-03: Menyimpan Hasil Penilaian Akhir

- **Actor:** Pembimbing 1
- **Precondition:** Sidang berstatus `ONGOING` dan semua 4 peserta telah mengisi penilaian
- **Summary:** Pembimbing 1 mengisi hasil akhir sidang (LULUS/TIDAK_LULUS) beserta satu catatan penguji gabungan. Sistem menghitung rata-rata nilai dari keempat peserta, menentukan grade, men-generate dokumen Notulen untuk setiap penguji yang telah mengisi catatan (masing-masing dengan catatan dan tanda tangan kosong yang akan diisi saat Revisi Pasca Sidang) menggunakan hasil akhir dari Pembimbing 1, men-generate dokumen Hasil Penilaian Akhir dan Berita Acara, lalu menandai sidang sebagai `COMPLETED`.
- **Postcondition:** Sidang selesai. Dokumen Notulen (per penguji yang sudah submit), Hasil Penilaian Akhir, dan Berita Acara ter-generate. Revisi Pasca Sidang diinisialisasi otomatis oleh sistem.

### UC-SS-04: Mengunduh Dokumen Sidang

- **Actor:** Mahasiswa, Dosen Peserta Sidang, Sekretariat, Kaprodi
- **Precondition:** Sidang telah terbuat; dokumen yang diminta sudah ter-generate
- **Summary:** Aktor mengunduh dokumen sidang sesuai hak aksesnya. Terdapat empat jenis dokumen: Formulir Penilaian (per peserta), Notulen Penguji (per penguji), Hasil Penilaian Akhir, dan Berita Acara. Sekretariat dan Kaprodi dapat mengunduh semua jenis dokumen. Dosen peserta sidang (diidentifikasi via kecocokan NIDN) dapat mengunduh semua jenis dokumen. Mahasiswa hanya dapat mengunduh Notulen Penguji; Formulir Penilaian, Hasil Penilaian Akhir, dan Berita Acara tidak dapat diakses oleh Mahasiswa.
- **Postcondition:** Berkas DOCX terunduh.

### UC-SS-05: Memantau Sidang Skripsi

- **Actor:** Sekretariat, Kaprodi
- **Precondition:** Terdapat sidang yang telah terjadwal, sedang berlangsung, atau selesai
- **Summary:** Aktor membuka daftar sidang dan dapat memfilter berdasarkan status. Sekretariat melihat seluruh sidang lintas program studi. Kaprodi melihat sidang di program studinya. Aktor dapat membuka detail sidang untuk melihat data peserta, nilai, dan hasil.
- **Postcondition:** Aktor memperoleh informasi status dan hasil sidang.

---

## Use Cases

### UC-RPS-01: Menginisiasi Revisi Pasca Sidang

- **Actor:** Mahasiswa
- **Precondition:** Sidang telah selesai (status `COMPLETED`), dipicu oleh penyelesaian Hasil Penilaian Akhir
- **Summary:** Mahasiswa membuka halaman Revisi Pasca Sidang. Sistem memastikan tahap pertama (Penguji 2) sudah terbuka — jika belum, sistem membuatnya secara otomatis — lalu menampilkan status revisi dan instruksi pengumpulan berkas.
- **Postcondition:** Tahap pertama terbuka dan mahasiswa dapat mulai mengunggah berkas revisi ke Penguji 2.

### UC-RPS-02: Mengumpulkan Berkas Revisi

- **Actor:** Mahasiswa
- **Precondition:** Revisi pasca sidang telah diinisiasi dan terdapat tahap aktif yang menunggu pengumpulan atau perbaikan
- **Summary:** Mahasiswa mengunggah berkas revisi skripsi ke tahap yang sedang aktif. Jika sebelumnya mendapat catatan revisi dari penandatangan aktif, mahasiswa mengunggah ulang berkas yang sudah diperbaiki pada tahap yang sama.
- **Postcondition:** Berkas terkirim ke penandatangan aktif untuk diperiksa.

### UC-RPS-03: Mereview Berkas Revisi

- **Actor:** Dosen (Penguji 2, Penguji 1, Pembimbing 2, atau Pembimbing 1 — sesuai urutan aktif)
- **Precondition:** Mahasiswa telah mengunggah berkas revisi pada tahap milik dosen yang bersangkutan
- **Summary:** Dosen memeriksa berkas revisi yang diunggah mahasiswa dan memberikan keputusan: menyetujui (APPROVED) atau meminta revisi ulang (NEED_REVISION). Jika disetujui, tahap berikutnya dibuka secara otomatis. Jika Penguji 2 atau Penguji 1 menyetujui, dokumen notulen penguji tersebut di-generate ulang dengan tanda tangan yang diambil dari data signature dosen yang tersimpan di sistem dan dirender otomatis ke dalam dokumen DOCX. Jika Pembimbing 1 menyetujui (tahap terakhir) dan hasil sidang LULUS, sistem men-generate Halaman Pengesahan Majelis Penguji dan Halaman Pengesahan Dekan secara otomatis.
- **Postcondition:** Status tahap diperbarui. Jika semua tahap selesai, revisi pasca sidang ditandai selesai.

### UC-RPS-04: Mengunduh Dokumen Pengesahan

- **Actor:** Mahasiswa, Dosen Peserta Sidang, Sekretariat, Kaprodi
- **Precondition:** Revisi pasca sidang telah selesai dan hasil sidang LULUS (sehingga dokumen pengesahan telah ter-generate)
- **Summary:** Aktor mengunduh Halaman Pengesahan Majelis Penguji dan/atau Halaman Pengesahan Dekan dalam format DOCX. Semua aktor yang berhak mengakses dapat mengunduh kedua jenis dokumen tanpa pembatasan.
- **Postcondition:** Berkas DOCX halaman pengesahan terunduh.

### UC-RPS-05: Memantau Revisi Pasca Sidang

- **Actor:** Dosen Peserta Sidang
- **Precondition:** Terdapat mahasiswa yang sedang atau telah menjalani revisi pasca sidang dengan dosen yang bersangkutan sebagai salah satu penandatangan
- **Summary:** Dosen membuka daftar revisi pasca sidang yang melibatkan dirinya, melihat status progres masing-masing, dan dapat membuka detail revisi mahasiswa tertentu untuk melihat tahap aktif, riwayat pengumpulan, dan riwayat review.
- **Postcondition:** Dosen memperoleh informasi progres revisi pasca sidang mahasiswa.

---

## Activity Diagrams

### UC-RPS-01: Menginisiasi Revisi Pasca Sidang

**Swimlanes:** Mahasiswa | Sistem Skripsi

START

[Mahasiswa] Membuka halaman Revisi Pasca Sidang

[Sistem] Memeriksa status sidang
[Decision 1] Sidang berstatus COMPLETED?

→ Belum: [Sistem] Menampilkan pesan prasyarat belum terpenuhi → END
→ Sudah: lanjut

[Sistem] Memeriksa status tahap pertama (Penguji 2)
[Decision 2] Tahap pertama sudah terbuka?

→ Belum: [Sistem] Membuka tahap pertama (Penguji 2) secara otomatis → lanjut
→ Sudah: lanjut

[Sistem] Menampilkan status revisi dan instruksi pengumpulan berkas

END

### UC-RPS-02: Mengumpulkan Berkas Revisi

**Swimlanes:** Mahasiswa | Sistem Skripsi

START

[Mahasiswa] Membuka halaman Revisi Pasca Sidang
[Sistem] Menampilkan status revisi dan tahap aktif

[Mahasiswa] Mengunggah berkas revisi untuk tahap aktif
[Sistem] Memvalidasi berkas
[Decision 1] Berkas valid?

→ Tidak valid: [Sistem] Menampilkan pesan gagal → kembali ke Mengunggah berkas revisi
→ Valid: lanjut

[Sistem] Menyimpan berkas pengumpulan
[Sistem] Menampilkan pesan berkas berhasil dikirim

END

### UC-RPS-03: Mereview Berkas Revisi

**Swimlanes:** Dosen | Sistem Skripsi

START

[Dosen] Membuka daftar revisi pasca sidang
[Sistem] Menampilkan daftar mahasiswa yang berkasnya menunggu review
[Dosen] Memilih mahasiswa dan membuka detail berkas

[Sistem] Menampilkan berkas revisi yang diunggah mahasiswa
[Dosen] Memeriksa berkas dan mengisi catatan
[Dosen] Memilih keputusan
[Decision 1] Keputusan?

→ NEED_REVISION: [Sistem] Memperbarui status tahap menjadi NEED_REVISION → [Sistem] Menampilkan pesan sukses → END
→ APPROVED: lanjut

[Sistem] Memperbarui status tahap menjadi APPROVED
[Decision 2] Dosen adalah Penguji 2 atau Penguji 1?

→ Ya: [Sistem] Mengambil tanda tangan dosen dari data akun → [Sistem] Men-generate ulang dokumen notulen penguji dengan tanda tangan → lanjut
→ Tidak (Pembimbing): lanjut

[Decision 3] Masih ada tahap berikutnya?

→ Ya: [Sistem] Membuka tahap berikutnya secara otomatis → [Sistem] Menampilkan pesan sukses → END
→ Tidak (Pembimbing 1, tahap terakhir): lanjut

[Decision 4] Hasil sidang LULUS?

→ Tidak (TIDAK_LULUS): [Sistem] Menandai revisi sebagai selesai → [Sistem] Menampilkan pesan sukses → END
→ Ya (LULUS): lanjut

[Sistem] Men-generate Halaman Pengesahan Majelis Penguji
[Sistem] Men-generate Halaman Pengesahan Dekan
[Sistem] Menandai revisi sebagai selesai
[Sistem] Menampilkan pesan sukses

END

### UC-RPS-04: Mengunduh Dokumen Pengesahan

**Swimlanes:** Aktor | Sistem Skripsi

START

[Aktor] Membuka halaman Revisi Pasca Sidang dan memilih dokumen yang ingin diunduh

[Sistem] Memeriksa ketersediaan dokumen
[Decision 1] Dokumen tersedia?

→ Tidak: [Sistem] Menampilkan pesan dokumen belum tersedia → END
→ Ya: lanjut

[Sistem] Mengirimkan berkas DOCX

END

### UC-RPS-05: Memantau Revisi Pasca Sidang

**Swimlanes:** Dosen | Sistem Skripsi

START

[Dosen] Membuka halaman daftar revisi pasca sidang
[Sistem] Menampilkan daftar mahasiswa yang revisinya melibatkan dosen tersebut beserta status progres masing-masing

[Dosen] Memilih mahasiswa untuk melihat detail
[Sistem] Menampilkan detail revisi beserta tahap aktif, riwayat pengumpulan, dan riwayat review

END

---

## Sequence Diagrams

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

## Use Cases

### UC-PBF-01: Menginisiasi Pengumpulan Berkas Final

- **Actor:** Mahasiswa
- **Precondition:** Revisi pasca sidang telah selesai (`is_completed = 1`) dan hasil sidang terakhir adalah `LULUS`
- **Summary:** Mahasiswa menginisiasi pengumpulan berkas final skripsi. Sistem membuat record pengumpulan baru berstatus DRAFT. Jika record sudah ada sebelumnya (karena init sebelumnya), sistem mengembalikan record yang ada tanpa membuat duplikat.
- **Postcondition:** Record pengumpulan berkas final berstatus DRAFT terbuat dan mahasiswa dapat mengunggah berkas.

### UC-PBF-02: Mengunggah dan Mengirim Berkas Final

- **Actor:** Mahasiswa
- **Precondition:** Pengumpulan berkas final telah diinisiasi (status DRAFT atau SUBMITTED)
- **Summary:** Mahasiswa mengunggah berkas skripsi final (FILE_SKRIPSI) dan artikel penelitian (ARTIKEL_PENELITIAN), lalu mengirimkan untuk dikonfirmasi. Sistem menghapus berkas lama (jika ada) dan menyimpan berkas baru, menghapus seluruh baris konfirmasi sebelumnya dan membuat ulang 6 baris konfirmasi baru (Perpustakaan, LPPM, Pembimbing 1 & 2, Penguji 1 & 2) dengan status belum dikonfirmasi, lalu mengubah status menjadi SUBMITTED. Submit ulang diperbolehkan selama status belum COMPLETED.
- **Postcondition:** Berkas tersimpan, status SUBMITTED, dan 6 penerima dapat mulai mengkonfirmasi penerimaan.

### UC-PBF-03: Mengkonfirmasi Penerimaan Berkas

- **Actor:** Perpustakaan, LPPM, Dosen Pembimbing/Penguji (salah satu dari 6 penerima)
- **Precondition:** Mahasiswa telah mengirimkan berkas (status SUBMITTED) dan aktor adalah salah satu dari 6 penerima yang belum mengkonfirmasi
- **Summary:** Penerima mengkonfirmasi bahwa berkas telah diterima. Sistem mencatat waktu konfirmasi. Jika seluruh 6 penerima telah mengkonfirmasi, sistem secara otomatis men-generate Surat Pernyataan Penyerahan Skripsi (DOCX) menggunakan tanda tangan semua pihak (tanpa tanda tangan Sekretaris Prodi) dan mengubah status menjadi WAITING_SIGNATURE sehingga Sekretaris Prodi dapat menandatangani.
- **Postcondition:** Konfirmasi penerima tersimpan. Jika semua sudah konfirmasi, Surat Pernyataan Penyerahan ter-generate (tanpa ttd Sekprodi) dan status berubah ke WAITING_SIGNATURE.

### UC-PBF-04: Menandatangani Surat Penyerahan

- **Actor:** Sekretaris Prodi (SEKPRODI)
- **Precondition:** Status pengumpulan adalah WAITING_SIGNATURE (semua 6 penerima telah konfirmasi)
- **Summary:** Sekretaris Prodi menandatangani Surat Pernyataan Penyerahan Skripsi. Sistem men-generate ulang dokumen dengan tanda tangan Sekretaris Prodi ditambahkan, mengubah status menjadi COMPLETED, dan menandai is_completed = 1.
- **Postcondition:** Surat Pernyataan Penyerahan final ter-generate dengan tanda tangan Sekretaris Prodi. Pengumpulan berkas final selesai.

### UC-PBF-05: Mengunduh Surat Pernyataan Penyerahan

- **Actor:** Mahasiswa, Dosen Peserta Sidang, Perpustakaan, LPPM, Sekretaris Prodi, Sekretariat, Kaprodi
- **Precondition:** Surat Pernyataan Penyerahan telah ter-generate (status minimal WAITING_SIGNATURE)
- **Summary:** Aktor mengunduh Surat Pernyataan Penyerahan Skripsi dalam format DOCX. Dokumen yang tersedia saat status WAITING_SIGNATURE belum memuat tanda tangan Sekretaris Prodi; dokumen saat COMPLETED sudah memuat tanda tangan lengkap.
- **Postcondition:** Berkas DOCX terunduh.

### UC-PBF-06: Memantau Pengumpulan Berkas Final

- **Actor:** Dosen Peserta Sidang, Perpustakaan, LPPM, Sekretaris Prodi
- **Precondition:** Terdapat pengumpulan berkas final yang melibatkan aktor sebagai salah satu penerima atau berada dalam lingkup program studi aktor
- **Summary:** Aktor membuka daftar pengumpulan berkas final yang relevan baginya. Dosen melihat entri di mana dirinya adalah Pembimbing atau Penguji beserta status konfirmasinya sendiri. Perpustakaan dan LPPM melihat semua pengumpulan lintas prodi yang sudah SUBMITTED ke atas (institution-wide). Sekretaris Prodi melihat semua pengumpulan di program studinya.
- **Postcondition:** Aktor memperoleh informasi status pengumpulan berkas final mahasiswa.

---

## Activity Diagrams

### UC-PBF-01: Menginisiasi Pengumpulan Berkas Final

**Swimlanes:** Mahasiswa | Sistem Skripsi

START

[Mahasiswa] Membuka halaman Pengumpulan Berkas Final

[Sistem] Memeriksa prasyarat (revisi pasca sidang selesai dan sidang terakhir LULUS)
[Decision 1] Prasyarat terpenuhi?

→ Tidak: [Sistem] Menampilkan pesan prasyarat belum terpenuhi → END
→ Ya: lanjut

[Sistem] Memeriksa apakah record pengumpulan sudah ada
[Decision 2] Record sudah ada?

→ Belum ada: [Sistem] Membuat record pengumpulan baru berstatus DRAFT → lanjut
→ Sudah ada: lanjut

[Sistem] Menampilkan halaman pengumpulan

END

### UC-PBF-02: Mengunggah dan Mengirim Berkas Final

**Swimlanes:** Mahasiswa | Sistem Skripsi

START

[Mahasiswa] Membuka halaman Pengumpulan Berkas Final
[Sistem] Menampilkan form unggah berkas dan status pengumpulan

[Mahasiswa] Mengunggah FILE_SKRIPSI dan ARTIKEL_PENELITIAN, lalu menekan tombol Kirim
[Sistem] Memvalidasi kelengkapan berkas (keduanya wajib ada)
[Decision 1] Berkas lengkap dan valid?

→ Tidak: [Sistem] Menampilkan pesan gagal → END
→ Ya: lanjut

[Sistem] Menghapus berkas lama (jika ada) dan menyimpan berkas baru
[Sistem] Menghapus seluruh baris konfirmasi sebelumnya (jika ada) dan membuat ulang 6 baris konfirmasi baru
[Sistem] Mengubah status menjadi SUBMITTED
[Sistem] Menampilkan pesan berkas berhasil dikirim

END

### UC-PBF-03: Mengkonfirmasi Penerimaan Berkas

**Swimlanes:** Penerima | Sistem Skripsi

START

[Penerima] Membuka halaman Pengumpulan Berkas Final
[Sistem] Menampilkan status pengumpulan dan status konfirmasi masing-masing penerima

[Penerima] Menekan tombol Konfirmasi
[Sistem] Memverifikasi bahwa aktor adalah salah satu dari 6 penerima yang belum mengkonfirmasi
[Decision 1] Aktor valid dan belum konfirmasi?

→ Tidak: [Sistem] Menampilkan pesan error → END
→ Ya: lanjut

[Sistem] Mencatat waktu konfirmasi untuk penerima tersebut
[Decision 2] Semua 6 penerima sudah mengkonfirmasi?

→ Belum: [Sistem] Menampilkan pesan konfirmasi berhasil → END
→ Sudah: lanjut

[Sistem] Men-generate Surat Pernyataan Penyerahan Skripsi (tanpa tanda tangan Sekretaris Prodi)
[Sistem] Mengubah status menjadi WAITING_SIGNATURE
[Sistem] Menampilkan pesan konfirmasi berhasil

END

### UC-PBF-04: Menandatangani Surat Penyerahan

**Swimlanes:** Sekretaris Prodi | Sistem Skripsi

START

[Sekretaris Prodi] Membuka halaman Pengumpulan Berkas Final
[Sistem] Menampilkan status pengumpulan dan tombol tanda tangan

[Sekretaris Prodi] Menekan tombol Tandatangani
[Sistem] Memverifikasi bahwa aktor adalah Sekretaris Prodi yang sesuai dengan program studi mahasiswa
[Decision 1] Aktor valid?

→ Tidak: [Sistem] Menampilkan pesan error → END
→ Ya: lanjut

[Sistem] Mengambil tanda tangan Sekretaris Prodi dari data akun
[Sistem] Men-generate ulang Surat Pernyataan Penyerahan Skripsi dengan tanda tangan Sekretaris Prodi
[Sistem] Mengubah status menjadi COMPLETED dan menandai is_completed = 1
[Sistem] Menampilkan pesan penandatanganan berhasil

END

### UC-PBF-05: Mengunduh Surat Pernyataan Penyerahan

**Swimlanes:** Aktor | Sistem Skripsi

START

[Aktor] Membuka halaman Pengumpulan Berkas Final dan menekan tombol unduh Surat Pernyataan Penyerahan

[Sistem] Memeriksa ketersediaan dokumen (status minimal WAITING_SIGNATURE)
[Decision 1] Dokumen tersedia?

→ Tidak: [Sistem] Menampilkan pesan dokumen belum tersedia → END
→ Ya: lanjut

[Sistem] Mengirimkan berkas DOCX

END

### UC-PBF-06: Memantau Pengumpulan Berkas Final

**Swimlanes:** Aktor | Sistem Skripsi

START

[Aktor] Membuka halaman daftar Pengumpulan Berkas Final
[Decision 1] Peran aktor?

→ Dosen (Pembimbing/Penguji): [Sistem] Menampilkan daftar pengumpulan di mana aktor adalah penerima (NIDN match), beserta status konfirmasi aktor sendiri → END
→ Perpustakaan / LPPM: [Sistem] Menampilkan semua pengumpulan lintas prodi dengan status minimal SUBMITTED → END
→ Sekretaris Prodi: [Sistem] Menampilkan semua pengumpulan di program studi aktor → END

END

---

## Sequence Diagrams

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

---

## Activity Diagrams

### UC-SS-01: Memulai Sidang

**Swimlanes:** Pembimbing 1 | Sistem Skripsi

START

[Pembimbing 1] Membuka halaman sidang

[Sistem] Memeriksa status sidang
[Decision 1] Record sidang ditemukan?

→ Tidak: [Sistem] Menampilkan pesan sidang tidak ditemukan → END
→ Ya: lanjut

[Sistem] Menampilkan informasi sidang beserta status sidang saat ini dan tombol Mulai Sidang

[Pembimbing 1] Menekan tombol Mulai Sidang

[Sistem] Mengubah status sidang menjadi ONGOING
[Sistem] Menampilkan formulir penilaian dan notulen yang dapat diisi oleh peserta sidang

END

### UC-SS-02: Mengisi Penilaian dan Notulen

**Swimlanes:** Dosen Peserta Sidang | Sistem Skripsi

START

[Dosen] Membuka halaman sidang
[Sistem] Menampilkan formulir yang tersedia sesuai peran dosen

[Dosen] Mengisi formulir penilaian (nilai isi, bahasa, TSP, penguasaan, penunjang beserta keterangan)
[Dosen] Menekan tombol Simpan Penilaian
[Sistem] Memvalidasi kelengkapan dan rentang nilai
[Decision 1] Nilai valid?

→ Tidak valid: [Sistem] Menampilkan pesan gagal → kembali ke Mengisi formulir penilaian
→ Valid: lanjut

[Sistem] Menghitung total nilai berbobot
[Sistem] Men-generate dokumen formulir penilaian
[Sistem] Menyimpan penilaian dan dokumen
[Sistem] Menampilkan pesan penilaian berhasil disimpan

[Decision 2] Dosen adalah Penguji?

→ Tidak (Pembimbing): END
→ Ya (Penguji): lanjut

[Dosen] Mengisi formulir notulen (catatan ujian)
[Dosen] Menekan tombol Simpan Notulen
[Sistem] Memvalidasi kelengkapan notulen
[Decision 3] Notulen valid?

→ Tidak valid: [Sistem] Menampilkan pesan gagal → kembali ke Mengisi formulir notulen
→ Valid: lanjut

[Sistem] Menyimpan notulen
[Sistem] Menampilkan pesan notulen berhasil disimpan

END

### UC-SS-03: Menyimpan Hasil Penilaian Akhir

**Swimlanes:** Pembimbing 1 | Sistem Skripsi

START

[Pembimbing 1] Membuka halaman sidang
[Sistem] Menampilkan status penilaian seluruh peserta dan formulir hasil penilaian akhir

[Pembimbing 1] Mengisi hasil akhir sidang (LULUS/TIDAK_LULUS) dan catatan penguji
[Pembimbing 1] Menekan tombol Simpan Hasil Penilaian Akhir

[Sistem] Memvalidasi kelengkapan formulir dan status penilaian seluruh peserta
[Decision 1] Formulir lengkap dan semua penilaian sudah disubmit?

→ Tidak: [Sistem] Menampilkan pesan validasi → END
→ Ya: lanjut

[Sistem] Menghitung rata-rata nilai dan menentukan grade
[Sistem] Men-generate dokumen Hasil Penilaian Akhir
[Sistem] Men-generate dokumen Notulen per Penguji yang sudah mengisi catatan
[Sistem] Men-generate dokumen Berita Acara
[Sistem] Menandai sidang sebagai COMPLETED
[Sistem] Menginisialisasi Revisi Pasca Sidang secara otomatis
[Sistem] Menampilkan pesan hasil penilaian berhasil disimpan dan sidang selesai

END

### UC-SS-04: Mengunduh Dokumen Sidang

**Swimlanes:** Aktor | Sistem Skripsi

START

[Aktor] Membuka halaman sidang dan memilih dokumen yang ingin diunduh

[Sistem] Memeriksa hak akses aktor terhadap dokumen yang dipilih
[Decision 1] Aktor memiliki hak akses?

→ Tidak: [Sistem] Menampilkan pesan akses ditolak → END
→ Ya: lanjut

[Sistem] Mengirimkan berkas DOCX

END

### UC-SS-05: Memantau Sidang Skripsi

**Swimlanes:** Sekretariat / Kaprodi | Sistem Skripsi

START

[Aktor] Membuka halaman daftar sidang
[Sistem] Menampilkan daftar sidang beserta status masing-masing

[Aktor] Memilih sidang dan membuka detail
[Sistem] Menampilkan detail sidang beserta data peserta, nilai, dan hasil

END

---

## Use Cases

### UC-PS-01: Mengajukan Berkas Sidang ke Kaprodi

- **Actor:** Mahasiswa
- **Precondition:** Konsultasi skripsi telah selesai (status COMPLETED)
- **Summary:** Mahasiswa menginisialisasi pengajuan sidang, mengunggah berkas isi skripsi (judul luar/dalam, abstrak, bab, daftar pustaka, dll.), mengisi data diri dan data ujian (termasuk nama usulan penguji), lalu mengajukan ke Kaprodi. Sistem secara otomatis men-generate empat dokumen: Lembar Permohonan Ujian, Surat Pernyataan Perbaikan, Surat Pernyataan Kelengkapan, dan Lembar Usulan Penguji.
- **Postcondition:** Pengajuan sidang terkirim ke Kaprodi untuk diperiksa.

### UC-PS-02: Memverifikasi Berkas Sidang oleh Kaprodi

- **Actor:** Kaprodi
- **Precondition:** Mahasiswa telah mengajukan berkas sidang ke Kaprodi
- **Summary:** Kaprodi memeriksa berkas isi skripsi satu per satu dan memberikan status verifikasi per berkas. Setelah semua berkas wajib dinyatakan valid, Kaprodi mengambil keputusan akhir: menyetujui pengajuan (VALID) atau meminta mahasiswa memperbaiki (NEED_REVISION).
- **Postcondition:** Pengajuan dinyatakan VALID sehingga mahasiswa dapat melanjutkan ke pengajuan ke Sekretariat, atau mahasiswa diminta memperbaiki data dan berkas.

### UC-PS-03: Mengajukan Berkas Sidang ke Sekretariat

- **Actor:** Mahasiswa
- **Precondition:** Kaprodi telah menyatakan pengajuan VALID, atau Sekretariat mengembalikan pengajuan dengan catatan revisi
- **Summary:** Mahasiswa mengunggah berkas administrasi (pas foto, KTM, bukti pembayaran, rekap nilai, KHS, dan berkas pendukung lainnya) lalu mengajukan ke Sekretariat. Jika sebelumnya mendapat catatan revisi dari Sekretariat, mahasiswa mengunggah ulang berkas yang diminta pada pengajuan yang sama.
- **Postcondition:** Pengajuan sidang terkirim ke Sekretariat untuk diperiksa.

### UC-PS-04: Memverifikasi Berkas Sidang oleh Sekretariat

- **Actor:** Sekretariat
- **Precondition:** Mahasiswa telah mengajukan berkas sidang ke Sekretariat
- **Summary:** Sekretariat memeriksa seluruh berkas administrasi satu per satu dan memberikan status verifikasi per berkas. Setelah semua berkas wajib dinyatakan valid, Sekretariat mengambil keputusan akhir: memverifikasi pengajuan atau mengembalikan ke mahasiswa untuk dilengkapi.
- **Postcondition:** Pengajuan berstatus WAITING_FOR_DISPOSISI dan menunggu disposisi dari Kaprodi, atau mahasiswa diminta melengkapi berkas.

### UC-PS-05: Mengirim Disposisi

- **Actor:** Kaprodi
- **Precondition:** Sekretariat telah memverifikasi pengajuan sidang (status WAITING_FOR_DISPOSISI)
- **Summary:** Kaprodi mengisi jadwal sidang (tanggal, waktu, tempat) dan menetapkan dosen penguji, kemudian mengirim disposisi ke Sekretariat.
- **Postcondition:** Pengajuan berstatus WAITING_FOR_SURAT dan Sekretariat dapat menerbitkan Surat Undangan Sidang.

### UC-PS-06: Menerbitkan Surat Undangan Sidang

- **Actor:** Sekretariat
- **Precondition:** Kaprodi telah mengirim disposisi (status WAITING_FOR_SURAT)
- **Summary:** Sekretariat menerbitkan Surat Undangan Sidang. Sistem secara otomatis men-generate dokumen undangan, membuat record sidang beserta data penilaian awal, dan mengirim surat undangan via email ke mahasiswa, pembimbing, dan penguji.
- **Postcondition:** Surat Undangan Sidang diterbitkan, record sidang terbuat, dan seluruh peserta menerima undangan.

---

## Use Cases

### UC-01: Mengajukan SK Penelitian

- **Actor:** Mahasiswa
- **Precondition:** Halaman Persetujuan Judul telah selesai ditandatangani semua pihak
- **Summary:** Mahasiswa mengajukan SK Penelitian. Sistem secara otomatis mengumpulkan berkas-berkas yang dibutuhkan dari pengajuan sebelumnya (KRS, Rekap Nilai, Kartu Konsultasi, File Outline, Halaman Persetujuan).
- **Postcondition:** Berkas SK terkirim ke Sekretariat untuk diperiksa.

### UC-02: Memverifikasi Berkas SK Penelitian

- **Actor:** Sekretariat
- **Precondition:** Mahasiswa telah mengajukan SK Penelitian
- **Summary:** Sekretariat memeriksa setiap berkas satu per satu. Jika semua berkas lengkap dan valid, Sekretariat menerbitkan SK. Jika ada berkas yang kurang atau tidak sesuai, Sekretariat mengembalikan pengajuan ke mahasiswa.
- **Postcondition:** SK Penelitian diterbitkan, atau mahasiswa diminta melengkapi berkas.

### UC-03: Melengkapi Berkas SK Penelitian

- **Actor:** Mahasiswa
- **Precondition:** Sekretariat mengembalikan pengajuan dengan catatan revisi
- **Summary:** Mahasiswa mengunggah ulang hanya berkas yang diminta oleh Sekretariat, kemudian mengajukan kembali.
- **Postcondition:** Berkas SK kembali terkirim ke Sekretariat untuk diperiksa ulang.

---

## Activity Diagrams

### UC-KS-01: Memulai Konsultasi Skripsi

**Swimlanes:** Mahasiswa | Sistem Skripsi

START

[Mahasiswa] Membuka halaman Konsultasi Skripsi
[Sistem] Memeriksa status SK Penelitian
[Decision 1] SK Penelitian COMPLETED?

→ Belum: [Sistem] Menampilkan pesan prasyarat belum terpenuhi → END
→ Sudah: lanjut

[Sistem] Memeriksa status kartu konsultasi skripsi
[Decision 2] Kartu konsultasi sudah dibuat?

→ Sudah: [Sistem] Menampilkan pesan konsultasi sudah berjalan → END
→ Belum: lanjut

[Mahasiswa] Menekan tombol Mulai Konsultasi Skripsi
[Sistem] Membuat kartu konsultasi skripsi
[Sistem] Membuka stage pertama: Bab 1 & 2 — Pembimbing 2
[Sistem] Menampilkan halaman konsultasi dengan stage aktif

END

### UC-KS-02: Mengumpulkan Berkas Bab

**Swimlanes:** Mahasiswa | Sistem Skripsi

START

[Mahasiswa] Membuka halaman Konsultasi Skripsi
[Sistem] Menampilkan status kartu konsultasi dan stage aktif
[Decision 1] Terdapat stage aktif yang menunggu pengumpulan?

→ Tidak: [Sistem] Menampilkan pesan tidak ada stage aktif → END
→ Ya: lanjut

[Mahasiswa] Mengunggah berkas bab untuk stage aktif
[Sistem] Memvalidasi berkas
[Decision 2] Berkas valid?

→ Tidak valid: [Sistem] Menampilkan pesan gagal → kembali ke Mengunggah berkas bab untuk stage aktif
→ Valid: lanjut

[Sistem] Menyimpan berkas pengumpulan
[Sistem] Memperbarui status stage menjadi SUBMITTED

END

### UC-KS-03: Mereview Berkas Bab

**Swimlanes:** Dosen Pembimbing | Sistem Skripsi

START

[Dospem] Membuka daftar konsultasi skripsi yang perlu direview
[Sistem] Menampilkan daftar mahasiswa yang berkasnya menunggu review
[Dospem] Memilih mahasiswa dan membuka detail berkas
[Sistem] Menampilkan berkas yang dikumpulkan mahasiswa
[Dospem] Memeriksa berkas dan mengisi catatan
[Dospem] Memilih keputusan
[Decision 1] Keputusan?

→ NEED_REVISION: [Sistem] Memperbarui status stage menjadi NEED_REVISION → [Sistem] Menampilkan pesan sukses → END
→ CONTINUE/ACCEPTED: lanjut

[Sistem] Mengambil tanda tangan dosen dari data akun
[Decision 2] Tanda tangan tersedia?

→ Tidak: [Sistem] Menampilkan pesan tanda tangan belum diunggah → END
→ Ya: lanjut

[Sistem] Menyimpan review dan catatan
[Sistem] Menyimpan tanda tangan dosen ke kartu konsultasi
[Sistem] Memperbarui status stage menjadi CONTINUE/ACCEPTED
[Decision 3] Keputusan CONTINUE (Pembimbing 2)?

→ Ya: [Sistem] Membuka stage Pembimbing 1 untuk bab yang sama → [Sistem] Menampilkan pesan sukses → END
→ Tidak (ACCEPTED oleh Pembimbing 1): lanjut

[Decision 4] Masih ada bab berikutnya?

→ Ya: [Sistem] Membuka stage Pembimbing 2 untuk bab berikutnya → [Sistem] Menampilkan pesan sukses → END
→ Tidak (Bab 5 selesai): lanjut

[Sistem] Menandai kartu konsultasi sebagai selesai
[Sistem] Membuat dokumen Kartu Penulisan Skripsi
[Sistem] Menampilkan pesan sukses

END

### UC-KS-04: Mengunduh Kartu Penulisan Skripsi

**Swimlanes:** Mahasiswa / Dosen Pembimbing / Kaprodi | Sistem Skripsi

START

[Mahasiswa / Dosen Pembimbing / Kaprodi] Membuka halaman Konsultasi Skripsi
[Sistem] Menampilkan halaman konsultasi beserta tombol unduh kartu
[Mahasiswa / Dosen Pembimbing / Kaprodi] Menekan tombol unduh kartu
[Sistem] Memproses unduhan dokumen
[Decision] Berhasil?

→ Ya: [Sistem] Mengirimkan berkas DOCX → END
→ Tidak: [Sistem] Menampilkan pesan gagal → END

### UC-KS-05: Memantau Konsultasi Skripsi

**Swimlanes:** Kaprodi | Sistem Skripsi

START

[Kaprodi] Membuka halaman daftar konsultasi skripsi
[Sistem] Menampilkan daftar konsultasi skripsi mahasiswa di program studi Kaprodi beserta status progres masing-masing
[Kaprodi] Memilih mahasiswa untuk melihat detail
[Sistem] Menampilkan detail konsultasi beserta riwayat pengumpulan dan review per bab

END

---

## Activity Diagrams

### UC-PS-01: Mengajukan Berkas Sidang ke Kaprodi

**Swimlanes:** Mahasiswa | Sistem Skripsi

START

[Mahasiswa] Membuka halaman Pengajuan Sidang

[Sistem] Memeriksa status konsultasi skripsi
[Decision 1] Konsultasi skripsi COMPLETED?

→ Belum: [Sistem] Menampilkan pesan prasyarat belum terpenuhi → END
→ Sudah: lanjut

[Sistem] Memeriksa status pengajuan sidang ke Kaprodi
[Decision 2] Pengajuan ke Kaprodi sudah ada?

→ Belum: [Mahasiswa] Menekan tombol Mulai Pengajuan Sidang → [Sistem] Menginisialisasi pengajuan sidang ke Kaprodi dengan status DRAFT → lanjut
→ Sudah: lanjut

[Sistem] Menampilkan formulir pengajuan beserta status terkini

[Mahasiswa] Mengunggah berkas isi skripsi (judul, bab, abstrak, daftar pustaka, dll.)
[Sistem] Memvalidasi berkas
[Decision 3] Berkas valid?

→ Tidak valid: [Sistem] Menampilkan pesan gagal → kembali ke Mengunggah berkas isi skripsi
→ Valid: [Sistem] Menyimpan berkas → lanjut

[Mahasiswa] Mengisi data diri dan data ujian (termasuk nama dan NIDN usulan penguji)
[Sistem] Menyimpan data formulir sementara

[Mahasiswa] Menekan tombol Ajukan ke Kaprodi
[Sistem] Memvalidasi kelengkapan formulir dan berkas wajib
[Decision 4] Formulir dan berkas lengkap?

→ Tidak lengkap: [Sistem] Menampilkan pesan validasi → kembali ke Mengisi data diri dan data ujian
→ Lengkap: lanjut

[Sistem] Mengubah status pengajuan menjadi SUBMITTED
[Sistem] Men-generate Lembar Permohonan Ujian
[Sistem] Men-generate Surat Pernyataan Perbaikan
[Sistem] Men-generate Surat Pernyataan Kelengkapan
[Sistem] Men-generate Lembar Usulan Penguji (nama penguji di-highlight kuning)
[Sistem] Menampilkan pesan pengajuan berhasil dikirim ke Kaprodi

[Decision 5] Keputusan Kaprodi?

→ NEED_REVISION: [Sistem] Menampilkan catatan revisi dari Kaprodi → [Mahasiswa] Memperbaiki data dan berkas → kembali ke Mengunggah berkas isi skripsi
→ VALID: lanjut

[Sistem] Menandai pengajuan ke Kaprodi sebagai VALID
[Sistem] Menampilkan informasi pengajuan ke Sekretariat dapat dilanjutkan

END

### UC-PS-02: Memverifikasi Berkas Sidang oleh Kaprodi

**Swimlanes:** Kaprodi | Sistem Skripsi

START

[Kaprodi] Membuka daftar pengajuan sidang mahasiswa

[Sistem] Menampilkan daftar pengajuan sidang di program studi Kaprodi
[Kaprodi] Memilih pengajuan milik mahasiswa dan membuka detail

[Sistem] Menampilkan data mahasiswa, data ujian yang diisi mahasiswa, dan berkas isi skripsi

[Kaprodi] Mengunduh dan memeriksa berkas
[Kaprodi] Memberikan status verifikasi per berkas
[Decision 1] Status per berkas?

→ Terverifikasi: [Sistem] Mencatat status verifikasi berkas menjadi VERIFIED → lanjut
→ Perlu Upload Ulang: [Sistem] Mencatat status verifikasi berkas menjadi NEED_REUPLOAD → lanjut

[Decision 2 — Kaprodi] Masih ada berkas yang belum diperiksa?

→ Ya: kembali ke Mengunduh dan memeriksa berkas
→ Tidak: lanjut

[Kaprodi] Mengambil keputusan akhir
[Decision 3] Keputusan?

→ NEED_REVISION: [Kaprodi] Mengisi catatan revisi → [Sistem] Mengubah status pengajuan menjadi NEED_REVISION → [Sistem] Menampilkan pesan pengajuan dikembalikan ke mahasiswa → END
→ VALID: lanjut

[Sistem] Mengubah status pengajuan menjadi VALID
[Sistem] Menampilkan pesan pengajuan berhasil disetujui

END

### UC-PS-03: Mengajukan Berkas Sidang ke Sekretariat

**Swimlanes:** Mahasiswa | Sistem Skripsi

START

[Mahasiswa] Membuka halaman Pengajuan Sidang

[Sistem] Memeriksa status pengajuan ke Kaprodi
[Decision 1] Pengajuan ke Kaprodi berstatus VALID?

→ Belum: [Sistem] Menampilkan pesan prasyarat belum terpenuhi → END
→ Ya: lanjut

[Sistem] Menampilkan formulir pengajuan ke Sekretariat beserta berkas yang sudah diunggah sebelumnya dan berkas yang di-generate otomatis

[Decision 2] Status pengajuan ke Sekretariat?

→ NEED_REVISION: [Sistem] Menampilkan catatan revisi dari Sekretariat dan menandai berkas yang perlu diunggah ulang → lanjut
→ DRAFT: lanjut

[Mahasiswa] Mengunggah berkas administrasi (pas foto, KTM, bukti pembayaran, KHS, rekap nilai, dll.)
[Sistem] Memvalidasi berkas
[Decision 3] Berkas valid?

→ Tidak valid: [Sistem] Menampilkan pesan gagal → kembali ke Mengunggah berkas administrasi
→ Valid: [Sistem] Menyimpan berkas → lanjut

[Decision 4 — Mahasiswa] Masih ada berkas yang perlu diunggah?

→ Ya: kembali ke Mengunggah berkas administrasi
→ Tidak: lanjut

[Mahasiswa] Menekan tombol Ajukan ke Sekretariat
[Sistem] Memvalidasi kelengkapan seluruh berkas wajib
[Decision 5] Semua berkas wajib tersedia?

→ Tidak lengkap: [Sistem] Menampilkan pesan validasi → kembali ke Mengunggah berkas administrasi
→ Lengkap: lanjut

[Sistem] Mengubah status pengajuan menjadi SUBMITTED
[Sistem] Menampilkan pesan pengajuan berhasil dikirim ke Sekretariat

END

### UC-PS-04: Memverifikasi Berkas Sidang oleh Sekretariat

**Swimlanes:** Sekretariat | Sistem Skripsi

START

[Sekretariat] Membuka daftar pengajuan sidang

[Sistem] Menampilkan daftar pengajuan sidang yang masuk
[Sekretariat] Memilih pengajuan milik mahasiswa dan membuka detail

[Sistem] Menampilkan data mahasiswa dan seluruh berkas pengajuan

[Sekretariat] Mengunduh dan memeriksa berkas
[Sekretariat] Memberikan status verifikasi per berkas
[Decision 1] Status per berkas?

→ Terverifikasi: [Sistem] Mencatat status verifikasi berkas menjadi VERIFIED → lanjut
→ Perlu Upload Ulang: [Sistem] Mencatat status verifikasi berkas menjadi NEED_REUPLOAD → lanjut

[Decision 2 — Sekretariat] Masih ada berkas yang belum diperiksa?

→ Ya: kembali ke Mengunduh dan memeriksa berkas
→ Tidak: lanjut

[Sekretariat] Mengambil keputusan akhir
[Decision 3] Keputusan?

→ NEED_REVISION: [Sekretariat] Mengisi catatan revisi → [Sistem] Mengubah status pengajuan menjadi NEED_REVISION → [Sistem] Menampilkan pesan pengajuan dikembalikan ke mahasiswa → END
→ VERIFY: lanjut

[Sistem] Mengubah status pengajuan menjadi WAITING_FOR_DISPOSISI
[Sistem] Menampilkan pesan pengajuan berhasil diverifikasi

END

### UC-PS-05: Mengirim Disposisi

**Swimlanes:** Kaprodi | Sistem Skripsi

START

[Kaprodi] Membuka daftar pengajuan sidang

[Sistem] Menampilkan daftar pengajuan sidang di program studi Kaprodi
[Kaprodi] Memilih pengajuan yang sudah diverifikasi Sekretariat dan membuka formulir disposisi

[Sistem] Menampilkan formulir disposisi beserta usulan penguji dari mahasiswa sebagai referensi

[Kaprodi] Mengisi jadwal sidang (tanggal, waktu, tempat) dan menetapkan dosen penguji

[Kaprodi] Menekan tombol Kirim Disposisi
[Sistem] Memvalidasi kelengkapan formulir disposisi
[Decision 1] Formulir lengkap?

→ Tidak lengkap: [Sistem] Menampilkan pesan validasi → kembali ke Mengisi jadwal sidang
→ Lengkap: lanjut

[Sistem] Men-generate ulang Lembar Usulan Penguji dengan jadwal dan penguji yang telah ditetapkan
[Sistem] Mengubah status pengajuan menjadi WAITING_FOR_SURAT
[Sistem] Menampilkan pesan disposisi berhasil dikirim ke Sekretariat

END

### UC-PS-06: Menerbitkan Surat Undangan Sidang

**Swimlanes:** Sekretariat | Sistem Skripsi

START

[Sekretariat] Membuka halaman disposisi sidang

[Sistem] Menampilkan daftar pengajuan yang menunggu surat undangan
[Sekretariat] Memilih pengajuan dan menekan tombol Buat Surat Undangan

[Sistem] Mengumpulkan data mahasiswa, jadwal sidang, pembimbing, dan penguji dari pengajuan sebelumnya
[Sistem] Men-generate nomor surat
[Sistem] Men-generate dokumen Surat Undangan Sidang
[Sistem] Mengubah status pengajuan menjadi COMPLETED
[Sistem] Membuat record sidang beserta data penilaian awal untuk seluruh peserta
[Sistem] Mengirim surat undangan via email ke mahasiswa, pembimbing, dan penguji
[Sistem] Menampilkan pesan surat undangan berhasil diterbitkan

END

---

## Sequence Diagrams

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

## Activity Diagrams

### UC-01: Mengajukan SK Penelitian

**Swimlanes:** Mahasiswa | Sistem Skripsi

START

[Mahasiswa] Membuka halaman SK Penelitian
[Sistem] Memeriksa prasyarat pengajuan

- Jika belum terpenuhi: tampilkan pesan prasyarat belum terpenuhi → END
- Jika terpenuhi: lanjut
  [Mahasiswa] Mengajukan SK Penelitian
  [Sistem] Mengumpulkan berkas dari pengajuan sebelumnya secara otomatis
  [Sistem] Mengirim pengajuan ke Sekretariat → END

---

### UC-02: Memverifikasi Berkas SK Penelitian

**Swimlanes:** Sekretariat | Sistem Skripsi

START

[Sekretariat] Membuka daftar pengajuan SK Penelitian
[Sistem] Menampilkan daftar pengajuan SK Penelitian
[Sekretariat] Memilih pengajuan milik Mahasiswa
[Sistem] Menampilkan detail pengajuan beserta berkas
[Sekretariat] Memeriksa setiap berkas satu per satu
[Sekretariat] Mengambil keputusan
[Decision] Keputusan?

→ VERIFY: [Sistem] Menerbitkan SK Penelitian & mengirim notifikasi ke Mahasiswa → END
→ NEED_REVISION: [Sistem] Mengirim notifikasi beserta catatan revisi ke Mahasiswa → END

---

### UC-03: Melengkapi Berkas SK Penelitian

**Swimlanes:** Mahasiswa | Sistem Skripsi

START

[Mahasiswa] Membuka halaman SK Penelitian
[Sistem] Menampilkan status pengajuan beserta catatan revisi dan berkas yang perlu dilengkapi
[Mahasiswa] Mengunggah ulang berkas yang diminta
[Mahasiswa] Mengajukan kembali SK Penelitian
[Sistem] Memperbarui status pengajuan dan mengirim notifikasi ke Sekretariat

END

---

## Sequence Diagrams

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

## Sequence Diagrams

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

## Sequence Diagrams

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
