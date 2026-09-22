-- Run only after the backend and frontend no longer read or write this column.
-- This permanently deletes historical latar belakang data from outline.
ALTER TABLE outline
  DROP COLUMN latar_belakang;
