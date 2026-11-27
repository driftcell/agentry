# Agentry

Agentry is a project-isolated MCP registry with a human review gate. It serves
one read-only Streamable HTTP endpoint (`/mcp`) and one administration endpoint
(`/admin/mcp`) from the same binary, backed by PostgreSQL and an external
S3-compatible bucket.

- Reads always resolve to the project's **active revision**.
- Agents can stage uploads, propose revisions, resolve conflicts and activate a
  revision **only after a human approved it**.
- Approval is available exclusively from an authenticated human web session.
- Activation is atomic and rejects stale revisions.
- Content is addressed by SHA-256 and tokenised with `o200k_base` once at ingest.

## Repository layout

```
crates/server/        Rust/Axum service, SQLx migrations, MCP servers
xtask/                cargo xtask build-web and check
docs/                 operations, MCP contract, security and performance notes
docker-compose.yml    PostgreSQL + agentry (OSS stays external)
```

The web workbench lives in `web/` and is built by `cargo xtask build-web` into
`crates/server/static/`. The backend serves that directory with SPA fallback.

## Quick start

Production-like run with external OSS:

```sh
cp .env.example .env
# fill OSS_* and change SEED_ADMIN_PASSWORD
docker compose up --build
```

The default `admin` / `admin` account exists only to bootstrap a fresh
installation. Change `SEED_ADMIN_PASSWORD` before the first boot or sign in and
rotate it immediately. Never expose the service with the seeded password.

Local backend-only run:

```sh
docker compose -f docker-compose.test.yml up -d
DATABASE_URL=postgres://agentry:agentry@127.0.0.1:55432/postgres \
APP_ENV=test STORAGE_BACKEND=memory \
SERVER_ADDR=127.0.0.1:8080 SERVER_PUBLIC_URL=http://127.0.0.1:8080 \
cargo run
```

`STORAGE_BACKEND=memory` is for local development and tests only. Production
requires `STORAGE_BACKEND=s3`.

## Documentation

- [Operations](docs/operations.md): configuration, migrations, seed, backup,
  troubleshooting.
- [MCP contract](docs/mcp.md): endpoints, tools, scopes, client configuration.
- [Security](docs/security.md): trust boundaries and secret handling.
- [Performance](docs/performance.md): measured read/tree/outline latency.
