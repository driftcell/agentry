-- Preserve the original incoming side of a proposal so a stale revision can be
-- rebased in place against a newer active revision without re-proposing.

CREATE TABLE revision_inputs (
    revision_id uuid NOT NULL REFERENCES revisions(id) ON DELETE CASCADE,
    path        text NOT NULL,
    blob_id     uuid REFERENCES content_blobs(id),
    deleted     boolean NOT NULL DEFAULT false,
    PRIMARY KEY (revision_id, path),
    CONSTRAINT revision_inputs_shape CHECK (
        (deleted AND blob_id IS NULL) OR (NOT deleted AND blob_id IS NOT NULL)
    )
);
