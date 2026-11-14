-- Keeps the penguji the STUDENT proposed, separate from the final committee. Kaprodi's disposisi
-- overwrites penguji1_nidn / penguji2_nidn, so the Lembar Usulan Penguji highlight (which shows the
-- student's picks) used to move to Kaprodi's choice when it was regenerated at disposisi.
-- Set at Kaprodi submit; NULL for Bisnis Digital (Kaprodi assigns the penguji there).

ALTER TABLE pengajuan_sidang_kaprodi
  ADD COLUMN usulan_penguji1_nidn VARCHAR(50) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NULL AFTER penguji2_nidn,
  ADD COLUMN usulan_penguji2_nidn VARCHAR(50) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NULL AFTER usulan_penguji1_nidn;

-- Rows where Kaprodi already changed the penguji at disposisi can't be recovered: the student's
-- original picks were overwritten, so they backfill with the final penguji. Bisnis Digital rows
-- stay NULL: those students never propose penguji.
UPDATE pengajuan_sidang_kaprodi psk
JOIN pengajuan_sidang ps ON ps.id = psk.pengajuan_sidang_id
JOIN skripsi s ON s.id = ps.skripsi_id
JOIN program_studi prog ON prog.id = s.program_studi_id
SET psk.usulan_penguji1_nidn = psk.penguji1_nidn,
    psk.usulan_penguji2_nidn = psk.penguji2_nidn
WHERE psk.status <> 'DRAFT'
  AND prog.kode <> 'BD';
