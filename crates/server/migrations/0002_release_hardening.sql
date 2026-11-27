-- Release hardening additions, kept in a separate migration because 0001 has
-- already been applied by existing installations.

CREATE TABLE bundle_exports (
    id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    project_id uuid NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    object_key text NOT NULL,
    expires_at timestamptz NOT NULL,
    created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX bundle_exports_expires_idx ON bundle_exports (expires_at);

-- A revision may only carry status='active' when its project points at it.
-- Deferred so activation can update the project pointer and the revision in
-- either order inside one transaction.
CREATE OR REPLACE FUNCTION validate_revision_active_status() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
    pointer uuid;
BEGIN
    IF NEW.status <> 'active' THEN
        RETURN NEW;
    END IF;
    SELECT active_revision_id INTO pointer FROM projects WHERE id = NEW.project_id;
    IF pointer IS DISTINCT FROM NEW.id THEN
        RAISE EXCEPTION 'revision % is active but project % points at %', NEW.id, NEW.project_id, pointer;
    END IF;
    RETURN NEW;
END;
$$;

CREATE CONSTRAINT TRIGGER revisions_active_pointer_matches
AFTER INSERT OR UPDATE OF status ON revisions
DEFERRABLE INITIALLY DEFERRED
FOR EACH ROW EXECUTE FUNCTION validate_revision_active_status();
