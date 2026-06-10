# Re-anchoring: `pengajuan_disposisi_pembimbing_id` → `outline_id`

## Goal

All features currently anchor their FK to `pengajuan_disposisi_pembimbing.id`. The goal is to
re-anchor them to `outline.id` instead, since `outline` is the more natural parent entity.

When a title submission (`pengajuan_disposisi_pembimbing`) is APPROVED, the approved data
(pembimbing1/2 nidn+nama, judul_final) is written back to the `outline` row. From that point
on, every downstream table can source everything it needs from `outline` directly.

This migration is done **one feature at a time**. The column
`kartu_konsultasi_outline.pengajuan_disposisi_pembimbing_id` acts as a temporary bridge for
features not yet re-anchored; it will be dropped in the final cleanup step.

---

## `outline` — new columns (migration: `2026-06-10_reanchor_konsultasi_outline.sql`)

Written on every APPROVE in `titleSubmissionKaprodi.controller.js`:

| Column | Type | Purpose |
|--------|------|---------|
| `pembimbing1_nidn` | VARCHAR(20) NULL | Assigned Pembimbing 1 NIDN |
| `pembimbing1_nama` | VARCHAR(255) NULL | Assigned Pembimbing 1 name |
| `pembimbing2_nidn` | VARCHAR(20) NULL | Assigned Pembimbing 2 NIDN |
| `pembimbing2_nama` | VARCHAR(255) NULL | Assigned Pembimbing 2 name |
| `judul_final` | VARCHAR(500) NULL | Approved title (may differ from original `judul`) |
| `approved_at` | DATETIME NULL | Timestamp of approval |

NULL = title submission not yet approved.

---

## Feature migration status

### ✅ Done: Konsultasi Outline (`2026-06-10_reanchor_konsultasi_outline.sql`)

| Table | Before | After |
|-------|--------|-------|
| `kartu_konsultasi_outline` | `pengajuan_disposisi_pembimbing_id` BIGINT UNIQUE FK | `outline_id` BIGINT UNIQUE FK (new anchor); `pengajuan_disposisi_pembimbing_id` kept as plain column (bridge — drop when all downstream features re-anchored) |
| `konsultasi_outline_stage` | `pengajuan_disposisi_pembimbing_id` BIGINT | `outline_id` BIGINT FK |

Routes renamed: `:pengajuanDisposisiPembimbingId` → `:outlineId` on all outline consultation endpoints.

---

### ✅ Done: Halaman Persetujuan Judul (`2026-06-10_reanchor_halaman_persetujuan.sql`)

| Table | Before | After |
|-------|--------|-------|
| `halaman_persetujuan_judul` | `pengajuan_disposisi_pembimbing_id` BIGINT UNIQUE FK | `outline_id` BIGINT UNIQUE FK; `pengajuan_disposisi_pembimbing_id` kept as plain column |
| `halaman_persetujuan_judul_signatures` | via `halaman_id` FK | no change |
| `halaman_persetujuan_judul_file` | via `halaman_id` FK | no change |

Routes renamed: `:pengajuanDisposisiPembimbingId` → `:outlineId` on all halaman persetujuan endpoints.

---

### ✅ Done: SK Penelitian (`2026-06-10_reanchor_sk_penelitian.sql`)

| Table | Before | After |
|-------|--------|-------|
| `pengajuan_sk_penelitian` | `pengajuan_disposisi_pembimbing_id` BIGINT UNIQUE FK | `outline_id` BIGINT UNIQUE FK; `pengajuan_disposisi_pembimbing_id` kept as plain column (bridge for `skripsi` INSERT until skripsi is re-anchored) |
| `pengajuan_sk_penelitian_files` | via `pengajuan_sk_penelitian_id` FK | no change |

Routes renamed: `:pengajuanDisposisiPembimbingId` → `:outlineId` on all SK penelitian endpoints.

`autoSubmitSkPenelitian` in `outlineConsultation.controller.js` now uses `outlineId` — the bridge column `kartu_konsultasi_outline.pengajuan_disposisi_pembimbing_id` is no longer read by any outline-side code.

---

### ✅ Done: Konsultasi Skripsi (`2026-06-10_reanchor_konsultasi_skripsi.sql`)

| Table | Before | After |
|-------|--------|-------|
| `kartu_konsultasi_skripsi` | `pengajuan_disposisi_pembimbing_id` BIGINT UNIQUE FK | `skripsi_id` BIGINT UNSIGNED NOT NULL UNIQUE FK → `skripsi(id)` |
| `konsultasi_skripsi_stage` | `pengajuan_disposisi_pembimbing_id` BIGINT non-FK index | `skripsi_id` BIGINT UNSIGNED NOT NULL FK → `skripsi(id)` |

Routes renamed: `:pengajuanDisposisiPembimbingId` → `:skripsiId` on all 5 student routes + 1 kaprodi route.

`fetchKartuExtra` now queries `pengajuan_sk_penelitian` via JOIN through `skripsi.outline_id`.

`initKartu` now sources all kartu data directly from `skripsi` row — no JOIN to `pengajuan_disposisi_pembimbing`.

`reviewStageByLecturer` auto-create sidang: resolves `pengajuan_disposisi_pembimbing_id` bridge via `JOIN skripsi → pengajuan_disposisi_pembimbing` for `pengajuan_sidang` / `pengajuan_sidang_kaprodi` inserts (those tables not yet re-anchored).

---

### ✅ Done: Skripsi record (`2026-06-10_reanchor_skripsi.sql`)

| Table | Before | After |
|-------|--------|-------|
| `skripsi` | `pengajuan_disposisi_pembimbing_id` BIGINT UNIQUE (nullable, no FK) | `outline_id` BIGINT UNSIGNED NOT NULL UNIQUE FK → `outline(id)` |

`skripsiSource` query in `skPenelitian.controller.js` now pulls directly from `kartu_konsultasi_outline` (no JOIN to `pengajuan_sk_penelitian`); INSERT uses `outline_id`.

`pengumpulanBerkasFinal.controller.js` (`generateSuratDoc`): `skripsi` lookup joins through `pengajuan_disposisi_pembimbing` to resolve `outline_id`.

Bridge columns dropped in the same migration:
- `kartu_konsultasi_outline.pengajuan_disposisi_pembimbing_id` — gone
- `pengajuan_sk_penelitian.pengajuan_disposisi_pembimbing_id` — gone

---

### ✅ Done: Pengajuan Sidang Kaprodi + Sekretariat (`2026-06-10_reanchor_pengajuan_sidang.sql`)

| Table | Before | After |
|-------|--------|-------|
| `pengajuan_sidang` | `pengajuan_disposisi_pembimbing_id` BIGINT FK | `skripsi_id` BIGINT UNSIGNED NOT NULL FK → `skripsi(id)` |
| `pengajuan_sidang_kaprodi` | `pengajuan_disposisi_pembimbing_id` BIGINT FK | `skripsi_id` BIGINT UNSIGNED NOT NULL FK → `skripsi(id)` |
| `pengajuan_sidang_files` | via `pengajuan_sidang_id` FK | no change |
| `skripsi` | no `perlu_surat_pengantar` | `perlu_surat_pengantar` TINYINT(1) NOT NULL DEFAULT 0 added; backfilled from `pengajuan_disposisi_pembimbing` |

Routes renamed: `:pengajuanDisposisiPembimbingId` → `:skripsiId` on all pengajuan-sidang and pengajuan-sidang-kaprodi endpoints.

`generateSuratUndangan`: `sidang` INSERT still uses `pengajuan_disposisi_pembimbing_id` (bridge PJ lookup) until `sidang` is re-anchored; also pre-populates `sidang.skripsi_id` (nullable column added in this migration).

`revisiPascaSidang.controller.js`: broken `JOIN skripsi sk ON sk.pengajuan_disposisi_pembimbing_id = ...` fixed via correlated subquery; `INSERT INTO pengajuan_sidang` fixed to use `skripsi_id` (resolved via bridge).

`skripsiConsultation.controller.js`: auto-create block in `reviewStageByLecturer` now uses `skripsi_id` for both sidang + kaprodi INSERTs; bridge PJ resolution dropped.

---

### ✅ Done: Sidang (`2026-06-10_reanchor_sidang.sql`)

| Table | Before | After |
|-------|--------|-------|
| `sidang` | `pengajuan_disposisi_pembimbing_id` BIGINT FK | `skripsi_id` BIGINT UNSIGNED NOT NULL FK → `skripsi(id)` |
| `sidang_penilaian` | via `sidang_id` FK | no change |
| `sidang_notulen` | via `sidang_id` FK | no change |
| `sidang_hasil_penilaian` | via `sidang_id` FK | no change |
| `sidang_files` | via `sidang_id` FK | no change |

Routes renamed: `:pengajuanDisposisiPembimbingId` → `:skripsiId` on all sidang endpoints.

Helper `getSidangByPengajuanJudulId` → `getSidangBySkripsiId`.

`submitHasilPenilaian`: prior sidang count uses `WHERE skripsi_id = ?`; revisi lookup uses `WHERE sidang_id = ?`; new revisi INSERT uses bridge PJ lookup (revisi still anchors on `pengajuan_disposisi_pembimbing_id`).

`revisiPascaSidang.controller.js`: `initRevisi` sidang query fixed to use `skripsi_id`; `reviewRevisi` sidang count fixed to use `skripsi_id`.

`pengumpulanBerkasFinal.controller.js`: all 9 occurrences of `JOIN sidang ON pengajuan_disposisi_pembimbing_id` fixed with skripsi bridge; all 4 occurrences of `JOIN skripsi ON skripsi.pengajuan_disposisi_pembimbing_id` fixed with outline_id bridge (skripsi lost that column earlier).

---

### ✅ Done: Revisi Pasca Sidang (`2026-06-10_reanchor_revisi_pasca_sidang.sql`)

| Table | Before | After |
|-------|--------|-------|
| `revisi_pasca_sidang` | `pengajuan_disposisi_pembimbing_id` BIGINT UNIQUE FK | `skripsi_id` BIGINT UNSIGNED NOT NULL UNIQUE FK → `skripsi(id)` |
| `revisi_pasca_sidang_stages` | via `revisi_id` FK | no change |
| `revisi_pasca_sidang_submissions` | via `stage_id` FK | no change |
| `revisi_pasca_sidang_reviews` | via `stage_id` FK | no change |
| `revisi_pasca_sidang_files` | via `revisi_id` FK | no change |

Routes renamed: `:pengajuanDisposisiPembimbingId` → `:skripsiId` on all revisi pasca sidang endpoints.

`sidang.controller.js`: `submitHasilPenilaian` revisi INSERT now uses `skripsi_id` directly (bridge PJ lookup dropped).

`pengumpulanBerkasFinal.controller.js`: `getPengajuanJudulRecord` JOIN on `revisi_pasca_sidang` fixed to use `skripsi_id` bridge; `initPengumpulan` prerequisite check fixed to join via `skripsi`.

---

### ✅ Done: Pengumpulan Berkas Final (`2026-06-10_reanchor_pengumpulan_berkas_final.sql`)

| Table | Before | After |
|-------|--------|-------|
| `pengumpulan_berkas_final` | `pengajuan_disposisi_pembimbing_id` BIGINT UNIQUE FK | `skripsi_id` BIGINT UNSIGNED NOT NULL UNIQUE FK → `skripsi(id)` |
| `pengumpulan_berkas_final_files` | via `pengumpulan_id` FK | no change |
| `pengumpulan_berkas_final_confirmations` | via `pengumpulan_id` FK | no change |

Routes renamed: `:pengajuanDisposisiPembimbingId` → `:skripsiId` on all 6 pengumpulan endpoints.

All SQL in `pengumpulanBerkasFinal.controller.js` simplified — correlated subquery bridges replaced with direct `JOIN skripsi sk ON sk.id = pbf.skripsi_id` and `JOIN sidang s ON s.skripsi_id = pbf.skripsi_id`.

Response shape: `pengajuanDisposisiPembimbingId` field replaced with `skripsiId` in all list and GET responses.

`pengajuanSidang.controller.js` (`generateSuratUndangan`): stale bridge PJ lookup and `pengajuan_disposisi_pembimbing_id` column in `sidang` INSERT removed (column was already dropped in Step 7).

---

## Final cleanup

Bridge columns (`kartu_konsultasi_outline.pengajuan_disposisi_pembimbing_id` and `pengajuan_sk_penelitian.pengajuan_disposisi_pembimbing_id`) were dropped as part of `2026-06-10_reanchor_skripsi.sql`.

After all remaining features (Konsultasi Skripsi → Pengumpulan Berkas Final) are re-anchored to `skripsi_id`, `pengajuan_disposisi_pembimbing` will no longer be an FK anchor for anything downstream. The `pengajuan_disposisi_pembimbing.outline_id` back-reference remains (it's how you find which title submission produced a given outline approval).
