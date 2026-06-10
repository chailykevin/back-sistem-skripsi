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

### ⬜ Pending: Halaman Persetujuan Judul

| Table | Current anchor | Target |
|-------|---------------|--------|
| `halaman_persetujuan_judul` | `pengajuan_disposisi_pembimbing_id` BIGINT UNIQUE FK | `outline_id` BIGINT UNIQUE FK |
| `halaman_persetujuan_judul_signatures` | via `halaman_id` FK | no change needed |
| `halaman_persetujuan_judul_file` | via `halaman_id` FK | no change needed |

Controller: `halamanPersetujuan.controller.js` + `autoGenerateHalamanPersetujuan` in `outlineConsultation.controller.js`.

---

### ⬜ Pending: SK Penelitian

| Table | Current anchor | Target |
|-------|---------------|--------|
| `pengajuan_sk_penelitian` | `pengajuan_disposisi_pembimbing_id` BIGINT UNIQUE FK | `outline_id` BIGINT UNIQUE FK |
| `pengajuan_sk_penelitian_files` | via `pengajuan_sk_penelitian_id` FK | no change needed |

Controller: `skPenelitian.controller.js` + `autoSubmitSkPenelitian` in `outlineConsultation.controller.js`.

---

### ⬜ Pending: Konsultasi Skripsi

| Table | Current anchor | Target |
|-------|---------------|--------|
| `kartu_konsultasi_skripsi` | `pengajuan_disposisi_pembimbing_id` BIGINT UNIQUE FK | `outline_id` BIGINT UNIQUE FK |
| `konsultasi_skripsi_stage` | `pengajuan_disposisi_pembimbing_id` BIGINT | `outline_id` BIGINT FK |

Controller: `skripsiConsultation.controller.js`.

---

### ⬜ Pending: Skripsi record

| Table | Current anchor | Target |
|-------|---------------|--------|
| `skripsi` | `pengajuan_disposisi_pembimbing_id` BIGINT UNIQUE FK (nullable) | `outline_id` BIGINT UNIQUE FK |

Controller: auto-inserted inside SK Penelitian VERIFY transaction.

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

## Final cleanup (after all features re-anchored)

```sql
ALTER TABLE kartu_konsultasi_outline
  DROP COLUMN pengajuan_disposisi_pembimbing_id;
```

At this point `pengajuan_disposisi_pembimbing` is no longer an FK anchor for anything downstream.
The `pengajuan_disposisi_pembimbing` → `outline_id` back-reference remains (it's how you find
which title submission produced a given outline approval).
