-- 0001_core.sql
-- Core schema for the MCP Registry.
-- Invariants enforced here:
--   * one active revision pointer per project, and it must point at an `active`
--     revision belonging to that same project (deferred constraint trigger);
--   * every blob is content addressed by its SHA-256;
--   * API keys never store the plaintext secret;
--   * project slugs are globally unique and URL-safe.

CREATE TABLE users (
    id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    username      text NOT NULL,
    display_name  text NOT NULL DEFAULT '',
    password_hash text NOT NULL,
    role          text NOT NULL DEFAULT 'member',
    created_at    timestamptz NOT NULL DEFAULT now(),
    updated_at    timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT users_username_format CHECK (username ~ '^[A-Za-z0-9][A-Za-z0-9._-]{2,63}$'),
    CONSTRAINT users_username_unique UNIQUE (username),
    CONSTRAINT users_role_valid CHECK (role IN ('superadmin', 'admin', 'member'))
);

CREATE TABLE projects (
    id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    slug        text NOT NULL,
    name        text NOT NULL,
    description text NOT NULL DEFAULT '',
    token_budget bigint NOT NULL DEFAULT 200000,
    created_at  timestamptz NOT NULL DEFAULT now(),
    updated_at  timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT projects_slug_format CHECK (slug ~ '^[a-z0-9][a-z0-9-]{1,62}[a-z0-9]$'),
    CONSTRAINT projects_slug_unique UNIQUE (slug),
    CONSTRAINT projects_token_budget_positive CHECK (token_budget > 0)
);

CREATE TABLE content_blobs (
    id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    sha256       char(64) NOT NULL,
    size_bytes   bigint NOT NULL,
    media_type   text NOT NULL DEFAULT 'text/markdown',
    is_text      boolean NOT NULL,
    text_content text,
    object_key   text,
    token_count  integer,
    token_status text NOT NULL DEFAULT 'ok',
    token_error  text,
    outline      jsonb,
    created_at   timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT content_blobs_sha256_format CHECK (sha256 ~ '^[0-9a-f]{64}$'),
    CONSTRAINT content_blobs_sha256_unique UNIQUE (sha256),
    CONSTRAINT content_blobs_size_nonnegative CHECK (size_bytes >= 0),
    CONSTRAINT content_blobs_token_status_valid CHECK (token_status IN ('ok', 'failed')),
    CONSTRAINT content_blobs_storage_present CHECK (
        (is_text AND text_content IS NOT NULL)
        OR (NOT is_text AND object_key IS NOT NULL)
    ),
    CONSTRAINT content_blobs_object_key_relative CHECK (
        object_key IS NULL OR (object_key NOT LIKE '/%' AND object_key NOT LIKE '%..%')
    )
);

CREATE TABLE revisions (
    id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    project_id        uuid NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    base_revision_id  uuid REFERENCES revisions(id) ON DELETE SET NULL,
    merged_against_revision_id uuid REFERENCES revisions(id) ON DELETE SET NULL,
    status            text NOT NULL,
    commit_message    text NOT NULL,
    author_user_id    uuid REFERENCES users(id) ON DELETE SET NULL,
    author_api_key_id uuid,
    token_added       integer NOT NULL DEFAULT 0,
    token_removed     integer NOT NULL DEFAULT 0,
    total_tokens      bigint NOT NULL DEFAULT 0,
    file_count        integer NOT NULL DEFAULT 0,
    conflict_summary  jsonb,
    review_comment    text,
    reviewed_by       uuid REFERENCES users(id) ON DELETE SET NULL,
    reviewed_at       timestamptz,
    activated_at      timestamptz,
    created_at        timestamptz NOT NULL DEFAULT now(),
    updated_at        timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT revisions_status_valid CHECK (
        status IN ('pending_review', 'approved', 'rejected', 'conflict', 'active', 'superseded')
    ),
    CONSTRAINT revisions_commit_message_len CHECK (char_length(commit_message) BETWEEN 1 AND 10000),
    CONSTRAINT revisions_base_not_self CHECK (base_revision_id IS NULL OR base_revision_id <> id)
);

ALTER TABLE projects
    ADD COLUMN active_revision_id uuid REFERENCES revisions(id) ON DELETE SET NULL;

CREATE TABLE revision_files (
    revision_id      uuid NOT NULL REFERENCES revisions(id) ON DELETE CASCADE,
    path             text NOT NULL,
    blob_id          uuid NOT NULL REFERENCES content_blobs(id),
    previous_blob_id uuid REFERENCES content_blobs(id),
    change_type      text NOT NULL,
    token_delta      integer NOT NULL DEFAULT 0,
    token_count      integer NOT NULL DEFAULT 0,
    is_text          boolean NOT NULL,
    size_bytes       bigint NOT NULL,
    PRIMARY KEY (revision_id, path),
    CONSTRAINT revision_files_path_safe CHECK (
        path NOT LIKE '/%' AND path NOT LIKE '%..%' AND path <> '' AND path NOT LIKE '%\\%'
    ),
    CONSTRAINT revision_files_change_type_valid CHECK (
        change_type IN ('added', 'modified', 'deleted', 'unchanged')
    )
);

CREATE TABLE revision_conflicts (
    revision_id uuid NOT NULL REFERENCES revisions(id) ON DELETE CASCADE,
    path        text NOT NULL,
    detail      jsonb NOT NULL DEFAULT '{}'::jsonb,
    resolved    boolean NOT NULL DEFAULT false,
    created_at  timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (revision_id, path)
);

CREATE TABLE transfer_sessions (
    id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    project_id   uuid NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    user_id      uuid REFERENCES users(id) ON DELETE SET NULL,
    api_key_id   uuid,
    status       text NOT NULL DEFAULT 'open',
    files        jsonb NOT NULL DEFAULT '[]'::jsonb,
    expires_at   timestamptz NOT NULL,
    completed_at timestamptz,
    objects_cleaned_at timestamptz,
    created_at   timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT transfer_sessions_status_valid CHECK (
        status IN ('open', 'completed', 'expired', 'failed')
    )
);

CREATE TABLE api_keys (
    id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id            uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    name               text NOT NULL,
    key_prefix         text NOT NULL,
    key_hash           text NOT NULL,
    default_project_id uuid REFERENCES projects(id) ON DELETE SET NULL,
    is_global          boolean NOT NULL DEFAULT false,
    scopes             text[] NOT NULL,
    revoked_at         timestamptz,
    expires_at         timestamptz,
    last_used_at       timestamptz,
    created_at         timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT api_keys_prefix_unique UNIQUE (key_prefix),
    CONSTRAINT api_keys_hash_unique UNIQUE (key_hash),
    CONSTRAINT api_keys_scopes_known CHECK (
        scopes <@ ARRAY['mcp:read', 'admin:propose', 'admin:activate', 'admin:platform']::text[]
    ),
    CONSTRAINT api_keys_scopes_nonempty CHECK (cardinality(scopes) > 0),
    CONSTRAINT api_keys_global_needs_scope CHECK (
        NOT is_global OR default_project_id IS NULL
    )
);

CREATE TABLE web_sessions (
    id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id    uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    token_hash text NOT NULL,
    expires_at timestamptz NOT NULL,
    created_at timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT web_sessions_token_unique UNIQUE (token_hash)
);

CREATE TABLE project_members (
    project_id uuid NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    user_id    uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    role       text NOT NULL DEFAULT 'member',
    created_at timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (project_id, user_id),
    CONSTRAINT project_members_role_valid CHECK (role IN ('owner', 'member'))
);

CREATE TABLE audit_events (
    id                bigserial PRIMARY KEY,
    project_id        uuid REFERENCES projects(id) ON DELETE SET NULL,
    revision_id       uuid REFERENCES revisions(id) ON DELETE SET NULL,
    actor_user_id     uuid REFERENCES users(id) ON DELETE SET NULL,
    actor_api_key_id  uuid,
    actor_label       text NOT NULL DEFAULT '',
    action            text NOT NULL,
    result            text NOT NULL,
    detail            jsonb NOT NULL DEFAULT '{}'::jsonb,
    created_at        timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT audit_events_result_valid CHECK (result IN ('ok', 'error'))
);

CREATE TABLE api_call_stats (
    id           bigserial PRIMARY KEY,
    api_key_id   uuid,
    project_id   uuid,
    endpoint     text NOT NULL,
    method       text NOT NULL,
    result       text NOT NULL,
    duration_ms  integer NOT NULL DEFAULT 0,
    created_at   timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT api_call_stats_result_valid CHECK (result IN ('ok', 'error'))
);

CREATE INDEX api_keys_user_idx ON api_keys (user_id);
CREATE INDEX api_keys_default_project_idx ON api_keys (default_project_id);
CREATE INDEX revisions_project_status_idx ON revisions (project_id, status, created_at DESC);
CREATE INDEX revisions_project_created_idx ON revisions (project_id, created_at DESC);
CREATE INDEX revisions_base_idx ON revisions (base_revision_id);
CREATE INDEX revisions_merged_against_idx ON revisions (merged_against_revision_id);
CREATE INDEX revisions_author_key_idx ON revisions (author_api_key_id);
CREATE UNIQUE INDEX revisions_one_active_per_project ON revisions (project_id) WHERE status = 'active';
CREATE INDEX revision_files_blob_idx ON revision_files (blob_id);
CREATE INDEX revision_files_previous_blob_idx ON revision_files (previous_blob_id);
CREATE INDEX transfer_sessions_project_status_idx ON transfer_sessions (project_id, status, expires_at);
CREATE INDEX web_sessions_user_idx ON web_sessions (user_id);
CREATE INDEX audit_events_created_idx ON audit_events (created_at DESC);
CREATE INDEX audit_events_project_idx ON audit_events (project_id, created_at DESC);
CREATE INDEX audit_events_revision_idx ON audit_events (revision_id, created_at DESC);
CREATE INDEX api_call_stats_created_idx ON api_call_stats (created_at DESC);
CREATE INDEX api_call_stats_key_idx ON api_call_stats (api_key_id, created_at DESC);
CREATE INDEX api_call_stats_project_idx ON api_call_stats (project_id, created_at DESC);

-- A project's active revision must exist, belong to that project and be the
-- sole revision whose status is `active`. Deferred so activation can update
-- both rows in one transaction in any statement order.
CREATE OR REPLACE FUNCTION validate_project_active_revision() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
    r_project uuid;
    r_status text;
    active_count integer;
BEGIN
    IF NEW.active_revision_id IS NULL THEN
        RETURN NEW;
    END IF;
    SELECT project_id, status INTO r_project, r_status
      FROM revisions WHERE id = NEW.active_revision_id;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'active_revision_id % does not exist', NEW.active_revision_id;
    END IF;
    IF r_project <> NEW.id THEN
        RAISE EXCEPTION 'active_revision_id % belongs to another project', NEW.active_revision_id;
    END IF;
    IF r_status <> 'active' THEN
        RAISE EXCEPTION 'active_revision_id % is not active (status %)', NEW.active_revision_id, r_status;
    END IF;
    SELECT count(*) INTO active_count FROM revisions
     WHERE project_id = NEW.id AND status = 'active';
    IF active_count <> 1 THEN
        RAISE EXCEPTION 'project % must have exactly one active revision, found %', NEW.id, active_count;
    END IF;
    RETURN NEW;
END;
$$;

CREATE CONSTRAINT TRIGGER projects_active_revision_valid
AFTER INSERT OR UPDATE OF active_revision_id ON projects
DEFERRABLE INITIALLY DEFERRED
FOR EACH ROW EXECUTE FUNCTION validate_project_active_revision();

CREATE OR REPLACE FUNCTION set_updated_at() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
    NEW.updated_at := now();
    RETURN NEW;
END;
$$;

CREATE TRIGGER users_touch BEFORE UPDATE ON users
FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE TRIGGER projects_touch BEFORE UPDATE ON projects
FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE TRIGGER revisions_touch BEFORE UPDATE ON revisions
FOR EACH ROW EXECUTE FUNCTION set_updated_at();
