-- PERPUSTAKAAN_STAFF and SEKPRODI already exist in the roles table.
-- Insert LPPM if not present.
INSERT INTO roles (code, name, description, is_active)
SELECT 'LPPM', 'LPPM', 'Lembaga Penelitian dan Pengabdian Masyarakat', 1
WHERE NOT EXISTS (SELECT 1 FROM roles WHERE code = 'LPPM');
