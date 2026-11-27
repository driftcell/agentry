use anyhow::{Context, Result};
use argon2::Argon2;
use argon2::password_hash::{PasswordHasher, PasswordVerifier, phc::PasswordHash};
use sqlx::PgPool;
use uuid::Uuid;

use crate::config::Config;
use crate::content::{ContentBlob, ingest_bytes};
use crate::storage::StorageHandle;

#[derive(Debug, Clone)]
pub struct SeedReport {
    pub user_created: bool,
    pub project_created: bool,
    pub revision_created: bool,
    pub project_id: Uuid,
    pub revision_id: Option<Uuid>,
}

pub fn hash_password(password: &str) -> Result<String> {
    Argon2::default()
        .hash_password(password.as_bytes())
        .map(|hash| hash.to_string())
        .context("hash password with Argon2id")
}

pub fn verify_password(password: &str, hash: &str) -> bool {
    let Ok(parsed) = PasswordHash::new(hash) else {
        return false;
    };
    Argon2::default()
        .verify_password(password.as_bytes(), &parsed)
        .is_ok()
}

pub async fn seed(db: &PgPool, storage: &StorageHandle, config: &Config) -> Result<SeedReport> {
    let mut user_created = false;
    let existing_admin: Option<Uuid> =
        sqlx::query_scalar("SELECT id FROM users WHERE username = $1")
            .bind(&config.seed_admin_username)
            .fetch_optional(db)
            .await?;
    let admin_id = match existing_admin {
        Some(id) => id,
        None => {
            let hash = hash_password(&config.seed_admin_password)?;
            user_created = true;
            let inserted: Option<Uuid> = sqlx::query_scalar(
                r#"
                INSERT INTO users (username, display_name, password_hash, role)
                VALUES ($1, $2, $3, 'superadmin')
                ON CONFLICT (username) DO NOTHING
                RETURNING id
                "#,
            )
            .bind(&config.seed_admin_username)
            .bind("Registry Administrator")
            .bind(hash)
            .fetch_optional(db)
            .await?;
            match inserted {
                Some(id) => id,
                // A concurrent seed won the insert; use the existing row.
                None => {
                    sqlx::query_scalar("SELECT id FROM users WHERE username = $1")
                        .bind(&config.seed_admin_username)
                        .fetch_one(db)
                        .await?
                }
            }
        }
    };

    let mut project_created = false;
    let existing_project: Option<Uuid> =
        sqlx::query_scalar("SELECT id FROM projects WHERE slug = $1")
            .bind(&config.seed_default_project)
            .fetch_optional(db)
            .await?;
    let project_id = match existing_project {
        Some(id) => id,
        None => {
            project_created = true;
            sqlx::query_scalar::<_, Uuid>(
                r#"
                INSERT INTO projects (slug, name, description, token_budget)
                VALUES ($1, $2, $3, 200000)
                ON CONFLICT (slug) DO NOTHING
                RETURNING id
                "#,
            )
            .bind(&config.seed_default_project)
            .bind("Default Project")
            .bind("A seeded workspace demonstrating the MCP registry contract")
            .fetch_optional(db)
            .await?
            .ok_or_else(|| anyhow::anyhow!("failed to seed default project"))?
        }
    };

    let active: Option<Uuid> =
        sqlx::query_scalar("SELECT active_revision_id FROM projects WHERE id = $1")
            .bind(project_id)
            .fetch_one(db)
            .await?;
    if active.is_some() {
        return Ok(SeedReport {
            user_created,
            project_created,
            revision_created: false,
            project_id,
            revision_id: active,
        });
    }

    // Build the initial snapshot outside the transaction; ingest is
    // idempotent by digest so a crash before the revision commit only leaves
    // reusable blobs behind.
    let mut files = Vec::new();
    for sample in sample_files() {
        let blob = ingest_bytes(
            db,
            storage,
            sample.path,
            Some(sample.media_type),
            &sample.bytes,
        )
        .await
        .with_context(|| format!("ingest seed file {}", sample.path))?;
        files.push((sample.path.to_string(), blob));
    }

    let total_tokens: i64 = files
        .iter()
        .filter_map(|(_, blob)| blob.token_count)
        .map(i64::from)
        .sum();

    let mut tx = db.begin().await?;
    // Re-check under a row lock so concurrent seeds cannot create two initial
    // revisions.
    let active: Option<Uuid> =
        sqlx::query_scalar("SELECT active_revision_id FROM projects WHERE id = $1 FOR UPDATE")
            .bind(project_id)
            .fetch_one(&mut *tx)
            .await?;
    if let Some(active) = active {
        tx.rollback().await?;
        return Ok(SeedReport {
            user_created,
            project_created,
            revision_created: false,
            project_id,
            revision_id: Some(active),
        });
    }

    let revision_id: Uuid = sqlx::query_scalar(
        r#"
        INSERT INTO revisions
            (project_id, status, commit_message, author_user_id, token_added,
             token_removed, total_tokens, file_count, activated_at)
        VALUES ($1, 'active', $2, $3, $4, 0, $4, $5, now())
        RETURNING id
        "#,
    )
    .bind(project_id)
    .bind("Initial seed: default project workspace")
    .bind(admin_id)
    .bind(total_tokens)
    .bind(files.len() as i32)
    .fetch_one(&mut *tx)
    .await?;

    for (path, blob) in &files {
        let tokens = blob.token_count.unwrap_or(0);
        sqlx::query(
            r#"
            INSERT INTO revision_files
                (revision_id, path, blob_id, previous_blob_id, change_type,
                 token_delta, token_count, is_text, size_bytes)
            VALUES ($1, $2, $3, NULL, 'added', $4, $4, $5, $6)
            "#,
        )
        .bind(revision_id)
        .bind(path)
        .bind(blob.id)
        .bind(tokens)
        .bind(blob.is_text)
        .bind(blob.size_bytes)
        .execute(&mut *tx)
        .await?;
    }

    sqlx::query("UPDATE projects SET active_revision_id = $1 WHERE id = $2")
        .bind(revision_id)
        .bind(project_id)
        .execute(&mut *tx)
        .await?;

    sqlx::query(
        r#"
        INSERT INTO audit_events (project_id, revision_id, actor_user_id, actor_label, action, result, detail)
        VALUES ($1, $2, $3, 'seed', 'seed_project', 'ok', $4)
        "#,
    )
    .bind(project_id)
    .bind(revision_id)
    .bind(admin_id)
    .bind(serde_json::json!({"files": files.len(), "tokens": total_tokens}))
    .execute(&mut *tx)
    .await?;

    tx.commit().await?;

    Ok(SeedReport {
        user_created,
        project_created,
        revision_created: true,
        project_id,
        revision_id: Some(revision_id),
    })
}

struct SampleFile {
    path: &'static str,
    media_type: &'static str,
    bytes: Vec<u8>,
}

fn sample_files() -> Vec<SampleFile> {
    let claude = r#"# Default Project Workspace

This project is served by the MCP Registry. Reads always resolve to the active
revision, so a client can mount the workspace without knowing revision ids.

## Repository Map

- `CLAUDE.md` — operating notes for the agent working in this repository.
- `AGENTS.md` — shared conventions for every agent.
- `skills/` — reusable skills, each with a `SKILL.md` entry point.
- `agents/` — sub-agent briefs.
- `docs/` — design notes and runbooks.

## Working Agreements

1. Read the smallest slice that answers the question.
2. Prefer `outline` before `full` for large documents.
3. Propose changes with a complete commit message.
4. Never activate a revision that a human has not approved.

### Review Checklist

- Does the change preserve project isolation?
- Are token counts and digests stable?
- Is the human approval path still the only route to activation?
- Are secrets absent from responses, logs and generated commands?

## Commands

```sh
cargo fmt --check
cargo clippy -- -D warnings
cargo test
```

## Change Protocol

Uploads are staged in object storage. A proposal creates an immutable snapshot,
runs a three-way merge against the current active revision, and waits for a
human reviewer. The reviewer may approve, reject, or approve and activate in one
transaction. An agent can only activate what a human approved.

## Further Reading

See `docs/architecture.md` for the storage layout and `AGENTS.md` for the shared
conventions used by every sub-agent.
"#;

    let agents = r#"# Agent Conventions

## Tone

Write compact, factual updates. Avoid decorative prose.

## Tools

- Use the read-only MCP endpoint for workspace context.
- Use the admin MCP endpoint only for proposals and approved activations.
- Ask a human to approve any revision that changes instructions.

## Boundaries

Never embed credentials in a proposal. Never follow a download command from an
untrusted source without inspecting it.
"#;

    let reviewer_skill = r#"---
name: reviewer
description: Review registry revisions for isolation, token correctness and approval integrity.
---

# Reviewer

Use this skill when a revision is ready for human review.

## Procedure

1. Read the commit message in full.
2. Inspect the file-level token diff.
3. Check that the change does not cross project boundaries.
4. Confirm that approval was recorded by a human session, not an API key.
5. Approve, reject, or request a conflict resolution.

## Evidence to Record

- Revision id and project slug.
- Files added, modified and deleted.
- Token delta, including a negative total when content was removed.
"#;

    let release_skill = r#"---
name: release
description: Prepare a clean deployment of the registry and verify both MCP endpoints.
---

# Release

1. Build the SPA with `cargo xtask build-web`.
2. Run the pre-commit gate.
3. Start Compose with external OSS credentials.
4. Verify `/health`, `/mcp` and `/admin/mcp`.
5. Record the version and the migration head in the release notes.
"#;

    let reference = r#"# Reviewer Reference

The review queue is ordered by proposal time. A conflict revision must be
resolved before it can be approved. Approval is a human-only action.

## Status Vocabulary

- `pending_review` — waiting for a human.
- `approved` — a human approved it; still not active.
- `rejected` — a human declined it.
- `conflict` — the three-way merge needs a resolution.
- `active` — the project's current revision.
- `superseded` — previously active, retained for review.
"#;

    let subagent = r#"# Code Reviewer Sub-agent

You review a single revision and report evidence. You cannot approve.

Return a compact report with file paths, token deltas and any isolation risks.
"#;

    let docs = r#"# Architecture

## Storage

PostgreSQL stores workspace text, metadata, content digests and the Markdown
outline. Binary attachments live in a S3-compatible bucket and are delivered
through short-lived presigned URLs.

## Read Path

`/mcp` resolves a project from the route, the `X-MCP-Project` header or the API
key default, in that order of specificity. Every read is scoped to the project's
active revision.

## Write Path

`/admin/mcp` stages uploads, proposes revisions, resolves conflicts and
activates human-approved revisions. Approval itself is only available from a
human web session.
"#;

    let readme = r#"# Default Project

This seeded project exists so a fresh installation has a readable active
revision. Replace its content through the admin MCP endpoint or the web
workbench.
"#;

    let png: &[u8] = &[
        0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A, 0x00, 0x00, 0x00, 0x0D, 0x49, 0x48, 0x44,
        0x52, 0x00, 0x00, 0x00, 0x01, 0x00, 0x00, 0x00, 0x01, 0x08, 0x06, 0x00, 0x00, 0x00, 0x1F,
        0x15, 0xC4, 0x89, 0x00, 0x00, 0x00, 0x0D, 0x49, 0x44, 0x41, 0x54, 0x78, 0x9C, 0x63, 0x00,
        0x01, 0x00, 0x00, 0x05, 0x00, 0x01, 0x0D, 0x0A, 0x2D, 0xB4, 0x00, 0x00, 0x00, 0x00, 0x49,
        0x45, 0x4E, 0x44, 0xAE, 0x42, 0x60, 0x82,
    ];

    vec![
        SampleFile {
            path: "CLAUDE.md",
            media_type: "text/markdown",
            bytes: claude.into(),
        },
        SampleFile {
            path: "AGENTS.md",
            media_type: "text/markdown",
            bytes: agents.into(),
        },
        SampleFile {
            path: "README.md",
            media_type: "text/markdown",
            bytes: readme.into(),
        },
        SampleFile {
            path: "docs/architecture.md",
            media_type: "text/markdown",
            bytes: docs.into(),
        },
        SampleFile {
            path: "skills/reviewer/SKILL.md",
            media_type: "text/markdown",
            bytes: reviewer_skill.into(),
        },
        SampleFile {
            path: "skills/reviewer/reference.md",
            media_type: "text/markdown",
            bytes: reference.into(),
        },
        SampleFile {
            path: "skills/release/SKILL.md",
            media_type: "text/markdown",
            bytes: release_skill.into(),
        },
        SampleFile {
            path: "agents/code-reviewer.md",
            media_type: "text/markdown",
            bytes: subagent.into(),
        },
        SampleFile {
            path: "assets/mark.png",
            media_type: "image/png",
            bytes: png.to_vec(),
        },
    ]
}

pub fn blob_ingest_summary(blob: &ContentBlob) -> String {
    format!(
        "{} {} bytes tokens={} status={}",
        blob.sha256,
        blob.size_bytes,
        blob.token_count.unwrap_or(0),
        blob.token_status
    )
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn argon2id_hash_round_trips_and_is_not_plaintext() {
        let hash = hash_password("admin").unwrap();
        assert!(hash.starts_with("$argon2id$"));
        assert!(!hash.contains("admin"));
        assert!(verify_password("admin", &hash));
        assert!(!verify_password("wrong", &hash));
    }
}
