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

### UC-PO-01: Mengajukan Outline

- **Actor:** Mahasiswa
- **Precondition:** Periode pengajuan outline sedang dibuka dan mahasiswa belum memiliki outline aktif
- **Summary:** Mahasiswa mengajukan outline skripsi dengan mengunggah berkas outline. Sistem menyimpan pengajuan dan mengirimkannya ke Kaprodi untuk direview.
- **Postcondition:** Pengajuan outline tersimpan dengan status SUBMITTED dan menunggu review Kaprodi.

### UC-PO-02: Mengajukan Disposisi Pembimbing

- **Actor:** Mahasiswa
- **Precondition:** Mahasiswa belum memiliki pengajuan disposisi pembimbing yang aktif
- **Summary:** Mahasiswa mengajukan disposisi pembimbing dengan mengisi data diri, judul skripsi, usulan calon pembimbing 1 dan 2, serta mengunggah berkas pendukung (KRS, transkrip, metodologi). Mahasiswa juga menandatangani formulir secara digital menggunakan tanda tangan yang tersimpan di akun. Sistem men-generate formulir pengajuan disposisi pembimbing secara otomatis dan mengirimkan pengajuan ke Kaprodi.
- **Postcondition:** Pengajuan disposisi pembimbing tersimpan dengan status SUBMITTED dan menunggu review Kaprodi.

### UC-PO-03: Mereview Pengajuan Disposisi Pembimbing

- **Actor:** Kaprodi
- **Precondition:** Mahasiswa telah mengajukan disposisi pembimbing (status SUBMITTED atau NEED_REVISION setelah resubmit)
- **Summary:** Kaprodi memeriksa formulir dan berkas pendukung pengajuan disposisi pembimbing. Kaprodi memverifikasi kelengkapan syarat (transkrip, KRS, metodologi) lalu mengambil keputusan: menyetujui pengajuan (APPROVED), meminta revisi (NEED_REVISION), atau menolak (REJECTED). Kaprodi juga menetapkan dosen pembimbing 1 dan 2 yang definitif. Sistem men-generate ulang formulir pengajuan dengan hasil keputusan dan tanda tangan Kaprodi.
- **Postcondition:** Status pengajuan diperbarui. Jika APPROVED, mahasiswa dapat melanjutkan ke konsultasi outline dengan dosen pembimbing yang telah ditetapkan.

### UC-PO-04: Mereview Pengajuan Outline

- **Actor:** Kaprodi
- **Precondition:** Mahasiswa telah mengajukan outline (status SUBMITTED atau NEED_REVISION setelah resubmit)
- **Summary:** Kaprodi memeriksa berkas outline yang diunggah mahasiswa dan mengambil keputusan: menerima outline (ACCEPTED), meminta revisi (NEED_REVISION), atau menolak (REJECTED).
- **Postcondition:** Status pengajuan outline diperbarui. Jika ACCEPTED, mahasiswa dapat melanjutkan ke konsultasi outline.

---

## Activity Diagrams

### UC-PO-01: Mengajukan Outline

**Swimlanes:** Mahasiswa | Sistem Skripsi

START

[Mahasiswa] Membuka halaman pengajuan outline
[Sistem] Mengecek status pengajuan outline mahasiswa

[Decision 1] Status pengajuan?

→ Menunggu review / disetujui: [Sistem] Menampilkan detail pengajuan outline → END

→ Belum ada pengajuan / ditolak / perlu revisi: lanjut

[Sistem] Menampilkan detail pengajuan outline dan tombol navigasi ke halaman submit pengajuan outline
[Mahasiswa] Memilih tombol navigasi
[Sistem] Menampilkan halaman submit pengajuan outline

[Mahasiswa] Mengisi atau memperbarui data pengajuan outline (judul, latar belakang, file outline skripsi)
[Mahasiswa] Mengirim pengajuan outline
[Sistem] Memvalidasi data
[Decision 2] Data valid?

→ Tidak valid: [Sistem] Menampilkan pesan gagal → kembali ke Mengirim pengajuan outline
→ Valid: lanjut

[Sistem] Menyimpan data pengajuan outline
[Sistem] Menampilkan pesan sukses

END

### UC-PO-02: Mengajukan Disposisi Pembimbing

**Swimlanes:** Mahasiswa | Sistem Skripsi

START

[Mahasiswa] Membuka halaman pengajuan disposisi pembimbing
[Sistem] Mengecek status pengajuan outline mahasiswa

[Decision 1] Status outline?

→ Belum disetujui: [Sistem] Menampilkan pesan bahwa outline belum disetujui → END
→ Disetujui: lanjut

[Sistem] Mengecek status pengajuan disposisi pembimbing mahasiswa

[Decision 2] Status pengajuan disposisi?

→ Menunggu review / disetujui: [Sistem] Menampilkan detail pengajuan disposisi pembimbing → END

→ Belum ada pengajuan / ditolak / perlu revisi: lanjut

[Sistem] Menampilkan detail pengajuan disposisi pembimbing dan tombol navigasi ke halaman submit pengajuan disposisi pembimbing
[Mahasiswa] Memilih tombol navigasi
[Sistem] Menampilkan halaman submit pengajuan disposisi pembimbing

[Mahasiswa] Mengisi atau memperbarui data pengajuan (nomor telepon, jumlah SKS, usulan dosen pembimbing pertama dan kedua, nama perusahaan (opsional), serta file transkrip nilai, KRS, bukti nilai Metodologi Penelitian minimal C, dan tanda tangan)
[Mahasiswa] Mengirim pengajuan disposisi pembimbing
[Sistem] Memvalidasi data
[Decision 3] Data valid?

→ Tidak valid: [Sistem] Menampilkan pesan gagal → kembali ke Mengirim pengajuan disposisi pembimbing
→ Valid: lanjut

[Sistem] Menyimpan data pengajuan disposisi pembimbing
[Sistem] Menampilkan pesan sukses

END

### UC-PO-03: Mereview Pengajuan Disposisi Pembimbing

**Swimlanes:** Kaprodi | Sistem Skripsi

START

[Kaprodi] Membuka halaman daftar pengajuan disposisi pembimbing
[Sistem] Menampilkan daftar pengajuan disposisi pembimbing beserta aksi yang dapat dilakukan pada tiap pengajuan

[Decision 1] Status pengajuan disposisi pembimbing?

→ Ditolak / sedang direvisi: [Sistem] Menampilkan tombol detail → [Kaprodi] Memilih tombol detail → [Sistem] Menampilkan detail pengajuan disposisi pembimbing → END

→ Disetujui: lanjut ke blok Disetujui

→ Menunggu review: lanjut ke blok Review

[Blok Disetujui]
[Sistem] Menampilkan pengajuan disposisi pembimbing dengan tombol detail dan download
[Decision 2] Aksi yang dipilih?

→ Detail: [Kaprodi] Memilih tombol detail → [Sistem] Menampilkan detail pengajuan disposisi pembimbing → END
→ Download: [Kaprodi] Memilih tombol download → [Sistem] Mengirimkan file formulir disposisi pembimbing → END

[Blok Review]
[Sistem] Menampilkan pengajuan disposisi pembimbing dengan tombol review
[Kaprodi] Memilih tombol review
[Sistem] Menampilkan halaman detail pengajuan disposisi pembimbing dengan bagian review

[Kaprodi] Melakukan review (memeriksa dokumen persyaratan, menetapkan dosen pembimbing, menentukan status, dan memberi komentar)
[Decision 3] Status yang ditetapkan?

→ Ditolak / perlu revisi: lanjut ke blok Kirim Review
→ Disetujui: [Kaprodi] Mengunggah tanda tangan → lanjut ke blok Kirim Review

[Blok Kirim Review]
[Kaprodi] Mengirim hasil review
[Sistem] Memvalidasi data
[Decision 4] Data valid?

→ Tidak valid: [Sistem] Menampilkan pesan gagal → kembali ke Mengirim hasil review
→ Valid: lanjut

[Sistem] Menyimpan data pengajuan disposisi pembimbing
[Sistem] Menampilkan pesan sukses

END

### UC-PO-04: Mereview Pengajuan Outline

**Swimlanes:** Kaprodi | Sistem Skripsi

START

[Kaprodi] Membuka halaman daftar pengajuan outline
[Sistem] Menampilkan daftar pengajuan outline beserta aksi yang dapat dilakukan pada tiap pengajuan

[Decision 1] Status pengajuan outline?

→ Disetujui / ditolak / sedang direvisi: [Sistem] Menampilkan tombol detail → [Kaprodi] Memilih tombol detail → [Sistem] Menampilkan detail pengajuan outline → END

→ Menunggu review: lanjut

[Sistem] Menampilkan pengajuan outline dengan tombol review
[Kaprodi] Memilih tombol review
[Sistem] Menampilkan halaman detail pengajuan outline dengan bagian review

[Kaprodi] Melakukan review (menentukan status, memberi komentar, dan opsional mengunggah file hasil review)
[Kaprodi] Mengirim hasil review
[Sistem] Memvalidasi data
[Decision 2] Data valid?

→ Tidak valid: [Sistem] Menampilkan pesan gagal → kembali ke Mengirim hasil review
→ Valid: lanjut

[Sistem] Menyimpan hasil review pengajuan outline
[Sistem] Menampilkan pesan sukses

END

---
## Activity Diagrams

### UC-KO-01: Mengajukan Konsultasi Outline dengan Dosen Pembimbing

**Swimlanes:** Mahasiswa | Sistem Skripsi

START

[Mahasiswa] Membuka halaman konsultasi outline
[Sistem] Menampilkan halaman konsultasi outline

[Mahasiswa] Melihat detail outline
[Sistem] Menampilkan halaman detail konsultasi

[Mahasiswa] Mengunggah file outline
[Sistem] Memvalidasi file
[Decision 1] File valid?

→ Tidak Valid: [Sistem] Menampilkan pesan gagal → kembali ke Mengunggah file outline
→ Valid: lanjut

[Sistem] Menyimpan file dan mengubah status menjadi DIAJUKAN
[Sistem] Menampilkan pesan sukses

END

### UC-KO-02: Mengunduh Kartu Konsultasi Outline

**Swimlanes:** User | Sistem Skripsi

START

[User] Membuka halaman detail konsultasi outline
[Sistem] Menampilkan halaman detail konsultasi outline

[User] Memilih tombol unduh pada halaman detail konsultasi outline
[Sistem] Memproses unduhan dokumen
[Decision 1] Hasil proses unduhan?

→ Gagal: [Sistem] Menampilkan pesan gagal → END
→ Sukses: lanjut

[Sistem] Mengunduh file ke perangkat pengguna
[User] Menerima file dokumen

END

### UC-KO-03: Memantau Konsultasi Outline

**Swimlanes:** Kaprodi | Sistem Skripsi

START

[Kaprodi] Membuka halaman pemantauan konsultasi outline
[Sistem] Menampilkan daftar konsultasi outline seluruh mahasiswa

[Kaprodi] Memilih konsultasi outline mahasiswa
[Sistem] Menampilkan detail konsultasi outline mahasiswa beserta status tahapan dan riwayat review

END

### UC-KO-04: Mereview Outline Mahasiswa

**Swimlanes:** Dosen Pembimbing | Sistem Skripsi

START

[Dosen Pembimbing] Membuka halaman review outline mahasiswa
[Sistem] Mengecek status tahapan outline mahasiswa bimbingan

[Decision 1] Ada yang perlu direview?

→ Tidak ada: [Sistem] Menampilkan pesan tidak ada outline yang perlu direview → END
→ Ada: lanjut

[Sistem] Menampilkan halaman review outline beserta file outline
[Dosen Pembimbing] Melihat file outline
[Dosen Pembimbing] Mengisi keputusan

[Decision 2] Keputusan?

→ Perlu revisi: lanjut ke blok Revisi
→ Lanjut / Diterima: lanjut ke blok Lanjut

[Blok Revisi]
[Dosen Pembimbing] Mengisi catatan revisi
[Dosen Pembimbing] Mengirim hasil review
[Sistem] Memvalidasi data
[Decision 3] Data valid?
→ Tidak valid: [Sistem] Menampilkan pesan gagal → kembali ke Mengisi keputusan
→ Valid: [Sistem] Mengubah status tahapan outline → [Sistem] Menampilkan pesan sukses → END

[Blok Lanjut]
[Dosen Pembimbing] Mengisi catatan
[Dosen Pembimbing] Mengunggah tanda tangan
[Dosen Pembimbing] Mengirim hasil review
[Sistem] Memvalidasi data
[Decision 3] Data valid?
→ Tidak valid: [Sistem] Menampilkan pesan gagal → kembali ke Mengisi keputusan
→ Valid: [Sistem] Mengubah status tahapan outline → [Sistem] Menampilkan pesan sukses → END

END

---

## Use Cases

### UC-KO-01: Mengajukan Konsultasi Outline dengan Dosen Pembimbing

- **Actor:** Mahasiswa
- **Precondition:** Outline telah diterima (status ACCEPTED) dan disposisi pembimbing telah disetujui (status APPROVED)
- **Summary:** Mahasiswa menginisialisasi kartu konsultasi outline. Sistem membuat kartu baru dan membuka stage pertama (Pembimbing 2) secara otomatis. Mahasiswa kemudian mengunggah berkas outline untuk direview oleh pembimbing. Jika sebelumnya mendapat catatan revisi, mahasiswa mengunggah ulang berkas yang sudah diperbaiki.
- **Postcondition:** Berkas outline terkirim ke pembimbing terkait untuk direview.

### UC-KO-02: Mengunduh Kartu Konsultasi Outline

- **Actor:** Mahasiswa, Dosen Pembimbing, Kaprodi
- **Precondition:** Kartu konsultasi outline telah dibuat
- **Summary:** Aktor mengunduh kartu konsultasi outline dalam format DOCX. Jika konsultasi belum selesai, yang tersedia adalah versi preview yang mencerminkan progres terkini. Jika konsultasi sudah selesai, yang tersedia adalah versi final yang telah tersimpan di sistem.
- **Postcondition:** Berkas DOCX kartu konsultasi outline terunduh.

### UC-KO-03: Memantau Konsultasi Outline

- **Actor:** Kaprodi
- **Precondition:** Terdapat mahasiswa di program studi Kaprodi yang sedang atau telah menjalani konsultasi outline
- **Summary:** Kaprodi melihat daftar seluruh konsultasi outline di program studinya beserta status progres masing-masing. Kaprodi dapat membuka detail konsultasi milik mahasiswa tertentu untuk melihat riwayat pengumpulan dan review.
- **Postcondition:** Kaprodi memperoleh informasi progres konsultasi outline mahasiswa.

### UC-KO-04: Mereview Outline Mahasiswa

- **Actor:** Dosen Pembimbing
- **Precondition:** Mahasiswa telah mengunggah berkas outline pada stage milik dosen yang bersangkutan
- **Summary:** Dosen memeriksa berkas outline yang diunggah mahasiswa dan memberikan keputusan. Pembimbing 2 memilih antara melanjutkan ke Pembimbing 1 (CONTINUE) atau meminta revisi (NEED_REVISION). Pembimbing 1 memilih antara menerima (ACCEPTED) atau meminta revisi (NEED_REVISION). Jika keputusan adalah CONTINUE atau ACCEPTED, tanda tangan dosen tersimpan otomatis ke kartu konsultasi.
- **Postcondition:** Status stage diperbarui. Jika Pembimbing 1 menerima outline, konsultasi outline selesai dan kartu konsultasi outline di-generate otomatis. Halaman Persetujuan Judul Desain Skripsi juga di-generate otomatis apabila seluruh prasyarat terpenuhi.

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
## Use Cases

### UC-ADM-01: Mengelola Data Mahasiswa

- **Actor:** Admin
- **Precondition:** Admin telah login
- **Summary:** Admin melakukan sinkronisasi data mahasiswa dari sistem eksternal. Sistem mengambil data terbaru dan menyimpannya ke dalam Sistem Skripsi secara otomatis.
- **Postcondition:** Data mahasiswa di Sistem Skripsi diperbarui sesuai data dari sistem eksternal.

### UC-ADM-02: Mengelola Data Dosen

- **Actor:** Admin
- **Precondition:** Admin telah login
- **Summary:** Admin melakukan sinkronisasi data dosen dari sistem eksternal. Sistem mengambil data terbaru dan menyimpannya ke dalam Sistem Skripsi secara otomatis.
- **Postcondition:** Data dosen di Sistem Skripsi diperbarui sesuai data dari sistem eksternal.

---

## Activity Diagrams

### UC-ADM-01: Mengelola Data Mahasiswa

**Swimlanes:** Admin | Sistem Skripsi

START

[Admin] Membuka halaman sinkronisasi data mahasiswa
[Sistem] Menampilkan halaman sinkronisasi data mahasiswa

[Admin] Memilih tombol sinkronisasi
[Sistem] Melakukan sinkronisasi dengan sistem eksternal dan menyimpan data mahasiswa ke dalam Sistem Skripsi

[Decision 1] Hasil sinkronisasi?

→ Sukses: [Sistem] Menampilkan pesan sukses → END
→ Gagal: [Sistem] Menampilkan pesan gagal → END

### UC-ADM-02: Mengelola Data Dosen

**Swimlanes:** Admin | Sistem Skripsi

START

[Admin] Membuka halaman sinkronisasi data dosen
[Sistem] Menampilkan halaman sinkronisasi data dosen

[Admin] Memilih tombol sinkronisasi
[Sistem] Melakukan sinkronisasi dengan sistem eksternal dan menyimpan data dosen ke dalam Sistem Skripsi

[Decision 1] Hasil sinkronisasi?

→ Sukses: [Sistem] Menampilkan pesan sukses → END
→ Gagal: [Sistem] Menampilkan pesan gagal → END

---

## Use Cases

### UC-ADM-04: Mengelola Jadwal Pengajuan Sidang
- **Actor:** Admin
- **Precondition:** Admin telah login
- **Summary:** Admin mengelola periode buka dan tutup pengajuan sidang skripsi. Admin dapat menambah periode baru, mengedit periode yang ada, atau menghapus periode. Setiap periode memiliki tahun akademik, periode akademik (GANJIL/GENAP), tanggal buka, dan tanggal tutup. Sistem menampilkan status aktif setiap periode (Sedang Buka / Sudah Tutup) secara otomatis berdasarkan waktu saat ini.
- **Postcondition:** Daftar periode pengajuan sidang diperbarui sesuai aksi yang dilakukan Admin.

---

## Activity Diagrams

### UC-ADM-04: Mengelola Jadwal Pengajuan Sidang
**Swimlanes:** Admin | Sistem Skripsi

START

[Admin] Membuka halaman Manajemen Periode Pengajuan Sidang
[Sistem] Menampilkan daftar periode beserta status masing-masing

[Decision 1] Aksi yang dipilih?

→ Tambah Periode Baru: lanjut ke blok Tambah
→ Edit Periode: lanjut ke blok Edit
→ Hapus Periode: lanjut ke blok Hapus

[Blok Tambah]
[Admin] Menekan tombol Tambah Periode
[Sistem] Menampilkan form tambah periode
[Admin] Mengisi form dan menekan tombol Simpan
[Sistem] Memvalidasi input
[Decision 2] Input valid?
→ Tidak Valid: [Sistem] Menampilkan pesan validasi → kembali ke Admin mengisi form
→ Valid: [Sistem] Menyimpan periode baru → END

[Blok Edit]
[Admin] Menekan tombol Edit pada salah satu periode
[Sistem] Menampilkan form dengan data periode yang dipilih
[Admin] Mengubah field yang ingin diperbarui dan menekan tombol Simpan
[Sistem] Memvalidasi input
[Decision 2] Input valid?
→ Tidak Valid: [Sistem] Menampilkan pesan validasi → kembali ke Admin mengubah field
→ Valid: [Sistem] Memperbarui data periode → END

[Blok Hapus]
[Admin] Menekan tombol Hapus pada salah satu periode
[Sistem] Memeriksa apakah periode sudah digunakan oleh pengajuan sidang
[Decision 2] Periode sudah digunakan?
→ Ada: [Sistem] Menampilkan pesan periode tidak dapat dihapus → END
→ Tidak Ada: [Sistem] Menghapus periode → END

END

---
## Use Cases

### UC-ADM-03: Mengelola Jadwal Pengajuan Outline
- **Actor:** Admin
- **Precondition:** Admin telah login
- **Summary:** Admin mengelola periode buka dan tutup pengajuan outline skripsi. Admin dapat menambah periode baru, mengedit periode yang ada, atau menghapus periode. Setiap periode memiliki tahun akademik, periode akademik (GANJIL/GENAP), tanggal buka, dan tanggal tutup. Sistem menampilkan status aktif setiap periode (Sedang Buka / Sudah Tutup) secara otomatis berdasarkan waktu saat ini. Periode yang sudah digunakan oleh pengajuan outline tidak dapat dihapus.
- **Postcondition:** Daftar periode pengajuan outline diperbarui sesuai aksi yang dilakukan Admin.

---

## Activity Diagrams

### UC-ADM-03: Mengelola Jadwal Pengajuan Outline
**Swimlanes:** Admin | Sistem Skripsi

START

[Admin] Membuka halaman jadwal pengumpulan outline
[Sistem] Menampilkan daftar periode beserta status masing-masing

[Decision 1] Aksi yang dipilih?

→ Tambah Periode Baru: lanjut ke blok Tambah
→ Edit Periode: lanjut ke blok Edit
→ Hapus Periode: lanjut ke blok Hapus

[Blok Tambah]
[Admin] Menekan tombol Tambah Periode
[Sistem] Menampilkan form tambah periode
[Admin] Mengisi form dan menekan tombol Simpan
[Sistem] Memvalidasi input
[Decision 2] Input valid?
→ Tidak Valid: [Sistem] Menampilkan pesan validasi → kembali ke Admin mengisi form
→ Valid: [Sistem] Menyimpan periode baru → END

[Blok Edit]
[Admin] Menekan tombol Edit pada salah satu periode
[Sistem] Menampilkan form dengan data periode yang dipilih
[Admin] Mengubah field yang ingin diperbarui dan menekan tombol Simpan
[Sistem] Memvalidasi input
[Decision 2] Input valid?
→ Tidak Valid: [Sistem] Menampilkan pesan validasi → kembali ke Admin mengubah field
→ Valid: [Sistem] Memperbarui data periode → END

[Blok Hapus]
[Admin] Menekan tombol Hapus pada salah satu periode
[Sistem] Memeriksa apakah periode sudah digunakan oleh pengajuan outline
[Decision 2] Periode sudah digunakan?
→ Ada: [Sistem] Menampilkan pesan periode tidak dapat dihapus → END
→ Tidak Ada: [Sistem] Menghapus periode → END

END

---