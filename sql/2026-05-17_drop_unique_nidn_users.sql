-- Allow multiple users rows to share the same nidn (e.g. lecturer + kaprodi accounts).
-- The dosen table remains the single source of truth for the dosen profile.
--
-- If the index name below doesn't match, run:
--   SHOW INDEX FROM users WHERE Column_name = 'nidn';
-- and replace 'nidn' in the ALTER TABLE below with the actual Key_name.

ALTER TABLE users DROP INDEX uq_users_npm;
