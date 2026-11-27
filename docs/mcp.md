# MCP contract

Agentry exposes two Streamable HTTP endpoints. Both use JSON responses
(`json_response: true`) and run statelessly, so a client does not need to carry
an `Mcp-Session-Id`.

| Endpoint | Purpose | Required route scope |
| --- | --- | --- |
| `/mcp` | read the active revision | `mcp:read` |
| `/mcp/projects/{slug}` | read a specific project | `mcp:read` |
| `/admin/mcp` | propose, inspect review state, activate, resolve conflicts, platform actions | any `admin:*` scope, plus the tool's exact scope |
| `/admin/mcp/projects/{slug}` | same, pinned to one project | same |

## Authentication and project resolution

Send `Authorization: Bearer ak-<prefix>-<secret>` on every request. Keys are
created once and the plaintext is never shown again. The `ak-` scheme and the
first two `-` separators are structural; the base64url secret may contain
additional dashes.

Resolution priority is fixed and cannot be changed by tool arguments:

1. `/projects/{slug}` in the URL (highest).
2. `X-MCP-Project: <slug>` header.
3. The key's `default_project_id`.
4. For a global key on `/admin/mcp` only: a tool's `project_slug` argument.

A non-global key is bound to one project. Pointing it at another project, by
path or header, fails immediately and never falls back. Supplying both a path
slug and a different header returns `400 PROJECT_CONTEXT_CONFLICT`.

## Scopes

| Scope | Grants |
| --- | --- |
| `mcp:read` | read tools and resources on `/mcp` |
| `admin:propose` | `stage_upload_urls`, `propose_revision`, `check_review_status`, `resolve_conflict` |
| `admin:activate` | `activate_revision` |
| `admin:platform` | `manage_platform` |

Scopes are checked per tool. An admin key without `admin:activate` can propose
but cannot activate. Keys are revoked immediately; there is no cache.

## Read tools (`/mcp`)

### `inspect_workspace`

Arguments: optional `kind_filter` (`all`, `root`, `claude`, `agents`, `skills`,
`subagents`).

Returns `{project, revision, files, tokens, tree}`. `tree` is compact text with
one-line descriptions and per-file token counts. Directory token counts are
sums of their descendants.

### `read_slice`

Arguments: `path`, `mode` (`outline`, `section`, `full`), optional `section`,
optional `max_tokens` (default 20000, max 200000).

- `outline` returns H1–H3 only plus each section's token count.
- `section` returns the named section, including nested subsections.
- `full` returns the file and reports `truncated: true` when the limit cuts it.
- Missing sections return `SECTION_NOT_FOUND` with nearby titles.
- Binary files return `NOT_TEXT`; use `resources/read` for a signed URL.

Token counts come from ingest (`o200k_base`) and are not recomputed on reads.

### `pull_bundle_url`

Arguments: optional `paths`, optional `local_target_dir` (default
`agentry-bundle`), optional `format` (`tar_gz` or `single`).

Creates a private bundle object in OSS and returns `{url, expires_at, files,
file_count, bytes, tokens, command}`. The command is shell-escaped text only;
the server never executes it. Selected paths must belong to the active revision;
`..`, absolute paths, duplicates and unknown paths are rejected.

## Resources and skills (`/mcp`)

- `resources/list`: files in the active revision as `mcp://<project>/<path>`
  URIs, with size and media type. Cursor-paginated.
- `resources/read`: text from PostgreSQL, or a short-lived presigned OSS GET for
  binary attachments. The response is `text/uri-list`; the JSON never contains
  binary bytes.
- `resources/directory/read`: direct children of `mcp://` or `skill://`
  directories.
- `skills/list`: skills at `skills/<name>/SKILL.md` in the active revision,
  including YAML frontmatter and a `{uri, digest, size}` manifest.
- `skills/get`: one skill by its `skill://<project>/<name>/SKILL.md` URI.

Presigned links are bearer capabilities: anyone holding the link can use it
until it expires. TTL defaults to 10 minutes.

## Admin tools (`/admin/mcp`)

### `stage_upload_urls`

Arguments: optional `project_slug` (alias `project`), `files` with
`{remote_path, local_path_hint?, content_type?, expected_sha256?,
expected_size?}`.

Creates a transfer session and returns one presigned PUT per file plus a
shell-safe `curl` batch. Uploaded bytes stay in staging until
`propose_revision` validates them.

### `propose_revision`

Arguments: optional `project_slug`, optional `session_id`, optional
`inline_patches` (`{path, content, content_type?, base_sha256?}`), optional
`deletions`, optional `base_revision_id`, required `commit_message`.

The server pulls staged objects, computes SHA-256 and size, checks declared
digests and sizes, tokenises changed text, and performs a three-way merge
against the current active revision. A clean merge returns `pending_review`; an
overlap returns `conflict` with compact `{path, hunks, lines}` summaries and no
full file bodies.

### `check_review_status`

Arguments: optional `project_slug`, `revision_id`. Returns the true state,
human comment, reviewer, token delta, total tokens, stale flag and conflicts.

### `activate_revision`

Arguments: optional `project_slug`, `revision_id`. Requires
`admin:activate`. The revision must be `approved`, belong to the project and
have been merged against the current active revision. Activation switches the
project pointer and revision state in one transaction.

There is deliberately **no approve tool**.

### `resolve_conflict`

Arguments: optional `project_slug`, `revision_id`, `resolutions`
(`{path, content? , oss_key?}`), `commit_message`.

Every conflict path must be resolved exactly once. `oss_key` must be under the
project's own staging prefix. If the project active revision moved after the
conflict was created, resolution fails with `REVISION_STALE`; re-propose against
the current active revision. A successful resolution returns to
`pending_review` and needs a new human approval.

### `manage_platform`

Arguments: `action` plus action-specific fields.

- `create_project`: `slug`, `name`, optional `description`, `token_budget`.
- `issue_api_key`: `name`, `scopes`, optional `project_slug`, `is_global`,
  `user_id`. Global, platform-scoped and other-user keys require a superadmin.
- `revoke_api_key`: `api_key_id`.
- `list_users`: no extra fields.

Plaintext keys appear only in the issue response. Lists never return hashes or
secrets.

## Human approval (web API)

Approval is not an MCP tool. A human signs in at `/api/auth/login` and uses:

- `POST /api/revisions/{id}/approve` with `{comment?, activate_now?}`
- `POST /api/revisions/{id}/reject` with `{comment?}`
- `POST /api/revisions/{id}/resolve` with `{resolutions, commit_message?}`

The session cookie is `agentry_session`, HTTP-only and SameSite=Strict.

## Client configuration

### Claude Code

```sh
claude mcp add --transport http agentry https://registry.example.com/mcp \
  --header "Authorization: Bearer $AGENTRY_KEY"
```

Project-scoped mount:

```sh
claude mcp add --transport http agentry-project https://registry.example.com/mcp/projects/default \
  --header "Authorization: Bearer $AGENTRY_KEY"
```

`.mcp.json` equivalent:

```json
{
  "mcpServers": {
    "agentry": {
      "type": "http",
      "url": "https://registry.example.com/mcp",
      "headers": { "Authorization": "Bearer ${AGENTRY_KEY}" }
    }
  }
}
```

### OpenCode

```json
{
  "$schema": "https://opencode.ai/config.json",
  "mcp": {
    "agentry": {
      "type": "remote",
      "url": "https://registry.example.com/mcp",
      "oauth": false,
      "headers": { "Authorization": "Bearer {env:AGENTRY_KEY}" }
    }
  }
}
```

Use a separate admin key on `/admin/mcp`; never give the read-only client key
admin scopes it does not need.
