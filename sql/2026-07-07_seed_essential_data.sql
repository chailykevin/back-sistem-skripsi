-- Essential seed data for a fresh deployment.
-- Run this AFTER the database structure (all tables, no data) has been migrated/imported.
-- Covers only the rows required for the app to boot and for an operator to log in:
--   roles, fakultas, program_studi, one ADMIN user + its role assignment.
-- All other tables (mahasiswa, dosen, outline, skripsi, sidang, ...) are left empty —
-- they are populated by the app itself as students/lecturers are onboarded.

-- 1. Roles (fixed set used throughout the codebase)
INSERT INTO roles (code, name, description, is_active) VALUES
  ('STUDENT', 'Student', 'Mahasiswa', 1),
  ('LECTURER', 'Lecturer', 'Dosen umum', 1),
  ('KAPRODI', 'Kaprodi', 'Kepala program studi', 1),
  ('PEMBIMBING', 'Pembimbing', 'Dosen pembimbing skripsi', 1),
  ('SEKRETARIAT', 'Sekretariat', 'Petugas sekretariat', 1),
  ('PERPUSTAKAAN_STAFF', 'Staf Perpustakaan', 'Petugas perpustakaan', 1),
  ('SEKPRODI', 'Sekretaris Prodi', 'Sekretaris program studi', 1),
  ('ADMIN', 'admin', 'admin', 1),
  ('DEKAN', 'Dekan', NULL, 1),
  ('LPPM', 'LPPM', 'Lembaga Penelitian dan Pengabdian Masyarakat', 1)
ON DUPLICATE KEY UPDATE
  name = VALUES(name),
  description = VALUES(description),
  is_active = VALUES(is_active);

-- 2. Fakultas
INSERT INTO fakultas (nama, kode, dekan_nidn) VALUES
  ('Fakultas Teknologi Informasi', 'UWDP-FTI', NULL)
ON DUPLICATE KEY UPDATE
  nama = VALUES(nama);

-- 3. Program Studi (kaprodi_nidn / sekprodi_nidn left NULL — assign once dosen accounts exist)
-- Note: program_studi has no UNIQUE key on `kode`, so idempotency is guarded via NOT EXISTS
-- instead of ON DUPLICATE KEY UPDATE.
INSERT INTO program_studi (nama, kode, fakultas_id, kaprodi_nidn, sekprodi_nidn)
SELECT 'Informatika', 'INF', f.id, NULL, NULL
FROM fakultas f
WHERE f.kode = 'UWDP-FTI'
  AND NOT EXISTS (SELECT 1 FROM program_studi WHERE kode = 'INF');

INSERT INTO program_studi (nama, kode, fakultas_id, kaprodi_nidn, sekprodi_nidn)
SELECT 'Sistem Informasi', 'SI', f.id, NULL, NULL
FROM fakultas f
WHERE f.kode = 'UWDP-FTI'
  AND NOT EXISTS (SELECT 1 FROM program_studi WHERE kode = 'SI');

INSERT INTO program_studi (nama, kode, fakultas_id, kaprodi_nidn, sekprodi_nidn)
SELECT 'Bisnis Digital', 'BD', f.id, NULL, NULL
FROM fakultas f
WHERE f.kode = 'UWDP-FTI'
  AND NOT EXISTS (SELECT 1 FROM program_studi WHERE kode = 'BD');

-- 4. Admin user
-- username: admin / password: admin123 (bcrypt hash below) — CHANGE THIS PASSWORD after first login.
INSERT INTO users (username, password_hash, npm, nidn, is_active)
VALUES ('admin', '$2b$10$FqVX/iE1VSg28q3sI4n9F.YhWI4.4cKMBinZxobLHfvT3fGn9nhSi', NULL, NULL, 1)
ON DUPLICATE KEY UPDATE
  password_hash = VALUES(password_hash),
  is_active = 1;

-- 5. Assign ADMIN role to the admin user
INSERT INTO user_roles (user_id, role_id, program_studi_id, is_active)
SELECT u.id, r.id, NULL, 1
FROM users u, roles r
WHERE u.username = 'admin' AND r.code = 'ADMIN'
ON DUPLICATE KEY UPDATE is_active = 1;
