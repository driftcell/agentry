-- Soft-delete projects. Row data, revisions, memberships, content blobs and
-- audit events are retained so a project can be restored later; live queries
-- filter on `deleted_at IS NULL`.

ALTER TABLE projects ADD COLUMN deleted_at timestamptz;
