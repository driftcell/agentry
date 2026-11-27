-- 0004_short_codes.sql
-- Add human- and LLM-friendly two-word short codes (2-3 tokens in o200k_base)
-- scoped per project while keeping internal UUID primary keys intact.

ALTER TABLE revisions ADD COLUMN short_code text;
UPDATE revisions
SET short_code = left(replace(id::text, '-', ''), 8)
WHERE short_code IS NULL;
ALTER TABLE revisions ALTER COLUMN short_code SET NOT NULL;
CREATE UNIQUE INDEX revisions_project_short_code_idx
    ON revisions (project_id, short_code);

ALTER TABLE transfer_sessions ADD COLUMN short_code text;
UPDATE transfer_sessions
SET short_code = left(replace(id::text, '-', ''), 8)
WHERE short_code IS NULL;
ALTER TABLE transfer_sessions ALTER COLUMN short_code SET NOT NULL;
CREATE UNIQUE INDEX transfer_sessions_project_short_code_idx
    ON transfer_sessions (project_id, short_code);
