-- The outline submission period now gates the first SK Penelitian submission instead of
-- outline / disposisi submission, so the SK records the period it was submitted in.
-- outline.submission_period_id stays: an outline created while a period is open is still tagged.

ALTER TABLE pengajuan_sk_penelitian
  ADD COLUMN submission_period_id BIGINT UNSIGNED NULL AFTER outline_id,
  ADD CONSTRAINT fk_sk_penelitian_submission_period
    FOREIGN KEY (submission_period_id) REFERENCES outline_submission_period(id)
    ON DELETE SET NULL;

-- Existing SKs: every outline was created inside a period until now, so its tag is the term.
UPDATE pengajuan_sk_penelitian sk
JOIN outline o ON o.id = sk.outline_id
SET sk.submission_period_id = o.submission_period_id
WHERE sk.submission_period_id IS NULL;
