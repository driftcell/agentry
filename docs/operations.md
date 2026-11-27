# Operations

## Configuration

All configuration is validated before the listener starts. An invalid or
missing value exits non-zero with a specific message.

| Variable | Required | Default | Notes |
| --- | --- | --- | --- |
| `DATABASE_URL` | yes | — | `postgres://` or `postgresql://` |
| `APP_ENV` | no | `development` | `production` requires the S3 backend |
| `SERVER_ADDR` | no | `0.0.0.0:8080` | host:port |
| `SERVER_PUBLIC_URL` | no | `http://localhost:8080` | used for presigned memory URLs and generated config snippets |
| `SERVER_ALLOWED_HOSTS` | no | derived | comma-separated Host allowlist for MCP |
| `STORAGE_BACKEND` | no | `s3` | `s3` or `memory` (tests/local only) |
| `OSS_ENDPOINT` | for s3 | — | e.g. `https://oss-cn-hangzhou.aliyuncs.com`, AWS S3 or R2 endpoint |
| `OSS_REGION` | for s3 | — | `oss-cn-hangzhou`, `us-east-1`, or `auto` for R2 |
| `OSS_BUCKET` | for s3 | — | lowercase letters, digits and dashes |
| `OSS_ACCESS_KEY_ID` | for s3 | — | never logged |
| `OSS_SECRET_ACCESS_KEY` | for s3 | — | never logged |
| `OSS_VIRTUAL_HOST_STYLE` | no | `true` | set `false` for path-style endpoints |
| `OSS_PRESIGN_TTL_SECONDS` | no | `600` | 60–3600 |
| `BUNDLE_TTL_SECONDS` | no | `900` | 60–3600 |
| `TRANSFER_SESSION_TTL_SECONDS` | no | `3600` | 300–86400 |
| `MAX_UPLOAD_BYTES` | no | `67108864` | per file |
| `WEB_SESSION_TTL_HOURS` | no | `12` | human session lifetime |
| `DATABASE_MAX_CONNECTIONS` | no | `10` | pool size |
| `SEED_ADMIN_USERNAME` | no | `admin` | first-boot only |
| `SEED_ADMIN_PASSWORD` | no | `admin` | first-boot only; change it |
| `STATIC_DIR` | no | `crates/server/static` | SPA build output |
| `LOG_FORMAT` | no | text | set `json` for structured logs |

## Migrations and seed

The binary runs SQLx migrations and an idempotent seed on every start. The seed
creates the initial superadmin, the `default` project and one active sample
revision. Re-running it never duplicates users, projects or revisions and never
rewrites an existing password.

Verify the seed hash is not plaintext:

```sql
SELECT username, left(password_hash, 10) FROM users;
```

Change the password by replacing the hash with a fresh Argon2id hash, or add a
rotation endpoint in a future release. Do not set a production password in a
committed `.env`.

## Compose

`docker-compose.yml` contains exactly two services: `postgres:17-alpine` and
`agentry`. OSS is external by design; do not add an object-storage container to
the production Compose file.

The server runs migrations and seed at startup. PostgreSQL data lives in the
`agentry_pgdata` volume.

## Backup and restore

Back up PostgreSQL and the OSS bucket together.

```sh
docker compose exec -T postgres pg_dump -U agentry -Fc agentry > agentry.dump
# snapshot/copy the OSS bucket with the provider's tool
```

Restore:

```sh
docker compose stop agentry
docker compose exec -T postgres pg_restore -U agentry -d agentry --clean < agentry.dump
# restore the bucket snapshot
docker compose up -d agentry
```

Revision text lives in PostgreSQL; binary attachments and bundle exports live in
OSS. A PostgreSQL-only restore leaves binary objects missing. A bucket-only
restore has orphaned objects but no metadata.

## Troubleshooting

- **Startup: `OSS_ENDPOINT is required`** — production defaults to the S3
  backend. Set all OSS variables or explicitly use `STORAGE_BACKEND=memory` for
  local development.
- **`/health` returns 503** — PostgreSQL is unreachable. Check `DATABASE_URL`
  and the pool limit.
- **MCP returns 401** — the Bearer key is unknown, revoked or expired. Plaintext
  keys are shown once; issue a new one.
- **MCP returns 403 `INSUFFICIENT_SCOPE`** — the key lacks the exact scope for
  that endpoint/tool.
- **400 `PROJECT_CONTEXT_REQUIRED`** — the key has no default project and the
  request supplied neither `X-MCP-Project` nor a `/projects/{slug}` URL. A
  global admin key can also pass `project_slug` to a tool.
- **409 `REVISION_STALE`** — another revision became active after this one was
  merged. Re-propose or resolve it against the current active revision.
- **Transfer proposal says `UPLOAD_MISSING`** — the presigned PUT never
  completed. Re-upload with the same URL before the session expires.
- **`DIGEST_MISMATCH`** — the uploaded bytes do not match the declared
  `expected_sha256`. The session is failed; create a new one.
