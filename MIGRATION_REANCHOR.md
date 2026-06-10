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

### ⬜ Pending: Konsultasi Skripsi

| Table | Current anchor | Target |
|-------|---------------|--------|
| `kartu_konsultasi_skripsi` | `pengajuan_disposisi_pembimbing_id` BIGINT UNIQUE FK | `outline_id` BIGINT UNIQUE FK |
| `konsultasi_skripsi_stage` | `pengajuan_disposisi_pembimbing_id` BIGINT | `outline_id` BIGINT FK |

Controller: `skripsiConsultation.controller.js`.

---

### ✅ Done: Skripsi record (`2026-06-10_reanchor_skripsi.sql`)

| Table | Before | After |
|-------|--------|-------|
| `skripsi` | `pengajuan_disposisi_pembimbing_id` BIGINT UNIQUE (nullable, no FK) | `outline_id` BIGINT UNSIGNED NOT NULL UNIQUE FK → `outline(id)` |

`skripsiSource` query in `skPenelitian.controller.js` now pulls directly from `kartu_konsultasi_outline` (no JOIN to `pengajuan_sk_penelitian`); INSERT uses `outline_id`.

`pengajuanSidang.controller.js` (`initPengajuanSidang`, `initKaprodi`): `pjRow` query now also fetches `outline_id`; `skripsi` lookup uses `pjRow.outline_id`.

`pengumpulanBerkasFinal.controller.js` (`generateSuratDoc`): `skripsi` lookup joins through `pengajuan_disposisi_pembimbing` to resolve `outline_id`.

Bridge columns dropped in the same migration:
- `kartu_konsultasi_outline.pengajuan_disposisi_pembimbing_id` — gone
- `pengajuan_sk_penelitian.pengajuan_disposisi_pembimbing_id` — gone

---

### ⬜ Pending: Pengajuan Sidang Kaprodi + Sekretariat

| Table | Current anchor | Target |
|-------|---------------|--------|
| `pengajuan_sidang_kaprodi` | `pengajuan_disposisi_pembimbing_id` BIGINT | `outline_id` BIGINT |
| `pengajuan_sidang` | `pengajuan_disposisi_pembimbing_id` BIGINT | `outline_id` BIGINT |
| `pengajuan_sidang_files` | via `pengajuan_sidang_id` FK | no change needed |

Controllers: `pengajuanSidangKaprodi.controller.js`, `pengajuanSidang.controller.js`.

---

### ⬜ Pending: Sidang

| Table | Current anchor | Target |
|-------|---------------|--------|
| `sidang` | `pengajuan_disposisi_pembimbing_id` BIGINT UNIQUE | `outline_id` BIGINT UNIQUE |
| `sidang_penilaian` | via `sidang_id` FK | no change needed |
| `sidang_notulen` | via `sidang_id` FK | no change needed |
| `sidang_hasil_penilaian` | via `sidang_id` FK | no change needed |
| `sidang_files` | via `sidang_id` FK | no change needed |

Controller: `sidang.controller.js`.

---

### ⬜ Pending: Revisi Pasca Sidang

| Table | Current anchor | Target |
|-------|---------------|--------|
| `revisi_pasca_sidang` | `pengajuan_disposisi_pembimbing_id` BIGINT UNIQUE FK | `outline_id` BIGINT UNIQUE FK |
| `revisi_pasca_sidang_stages` | via `revisi_id` FK | no change needed |
| `revisi_pasca_sidang_submissions` | via `stage_id` FK | no change needed |
| `revisi_pasca_sidang_reviews` | via `stage_id` FK | no change needed |
| `revisi_pasca_sidang_files` | via `revisi_id` FK | no change needed |

Controller: `revisiPascaSidang.controller.js`.

---

### ⬜ Pending: Pengumpulan Berkas Final

| Table | Current anchor | Target |
|-------|---------------|--------|
| `pengumpulan_berkas_final` | `pengajuan_disposisi_pembimbing_id` BIGINT UNIQUE FK | `outline_id` BIGINT UNIQUE FK |
| `pengumpulan_berkas_final_files` | via `pengumpulan_id` FK | no change needed |
| `pengumpulan_berkas_final_confirmations` | via `pengumpulan_id` FK | no change needed |

Controller: `pengumpulanBerkasFinal.controller.js`.

---

## Final cleanup

Bridge columns (`kartu_konsultasi_outline.pengajuan_disposisi_pembimbing_id` and `pengajuan_sk_penelitian.pengajuan_disposisi_pembimbing_id`) were dropped as part of `2026-06-10_reanchor_skripsi.sql`.

After all remaining features (Konsultasi Skripsi → Pengumpulan Berkas Final) are re-anchored to `skripsi_id`, `pengajuan_disposisi_pembimbing` will no longer be an FK anchor for anything downstream. The `pengajuan_disposisi_pembimbing.outline_id` back-reference remains (it's how you find which title submission produced a given outline approval).
