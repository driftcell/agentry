# Security and trust boundaries

## Human approval cannot be bypassed

- No MCP tool approves a revision. The only code path that sets
  `status = 'approved'` is the web approval service, which requires a human
  `agentry_session` cookie.
- `activate_revision` requires `status = 'approved'`, a matching project, and a
  base merged against the current active revision. It locks the project and the
  revision in one transaction and updates both rows atomically.
- `pending_review`, `conflict`, `rejected` and stale revisions fail activation.
- `Approve & Activate Now` performs approval and activation in one transaction;
  if activation fails, the approval is rolled back too.

## Project isolation

- A non-global API key is bound to one project by a database foreign key.
- `/projects/{slug}` and `X-MCP-Project` never fall back to another project.
- Cross-project reads and argument `project_slug` overrides require a global
  key on the admin endpoint.
- Revision lookups always include the resolved project id.
- `resolve_conflict` accepts OSS keys only under that project's staging prefix.
- Object keys embed the project UUID for staging and bundle exports.

## Secrets

- API key plaintext is returned exactly once and never stored. Only a SHA-256
  hash and a short lookup prefix are persisted.
- Passwords use Argon2id; the seed never stores the plaintext password.
- Bearer values, OSS secrets and full presigned URLs are not logged. HTTP trace
  logging excludes headers.
- MCP responses contain project-scoped content and signed URLs, never database
  rows, OSS credentials or stack traces.
- Error responses use stable codes and generic messages for internal failures.

## Capability URLs

Presigned GET/PUT URLs are bearer capabilities. Anyone with the link can use it
until expiry. TTL defaults:

- attachment/resource reads: `OSS_PRESIGN_TTL_SECONDS` (600 s)
- bundle downloads: `BUNDLE_TTL_SECONDS` (900 s)
- staged uploads: `TRANSFER_SESSION_TTL_SECONDS` (3600 s)

The URLs are scoped to one object and one HTTP method. They are never placed in
logs. Clients should treat the generated shell command as untrusted text and
review it before running it; the server never executes it.

## Paths and uploads

- Workspace paths are POSIX relative, must not contain `.`/`..`, empty
  segments, backslashes, drive letters or control characters.
- URI paths are percent-decoded and re-validated.
- Duplicate normalized paths are rejected.
- `MAX_UPLOAD_BYTES` is enforced when a staged object enters a revision and when
  inline content is accepted.
- Bundle selections are capped at 500 files and 128 MiB.
- Binary content is delivered by OSS, never embedded in MCP JSON.

## Authentication endpoints

- The web session cookie is `HttpOnly`, `SameSite=Strict` and `Secure` when the
  public URL is HTTPS.
- The web API ignores Bearer API keys; only a cookie session can approve.
- Revoked or expired keys fail on the next request; there is no cached auth.
- Login failures use the same message for unknown users and bad passwords.

## Deployment checklist

- Change the seeded admin password before exposing the service.
- Set `APP_ENV=production` and `STORAGE_BACKEND=s3`.
- Terminate TLS at the proxy; set `SERVER_PUBLIC_URL` to the HTTPS origin.
- Restrict the OSS bucket to the service credentials; enable versioning and
  lifecycle cleanup for staging/bundle prefixes.
- Keep migration/seed logs and database backups encrypted.
