use serde::{Deserialize, Serialize};
use serde_json::Value;
use uuid::Uuid;

use crate::AppState;
use crate::content::sha256_hex;
use crate::error::ToolError;
use crate::paths::{normalize_path, normalize_path_set, shell_quote, staging_key};
use crate::project::{ProjectContext, resolve_tool_project};
use crate::revisions::{self, Actor, ProposedChange, ProposedFile};

use super::args::*;
use super::outputs::*;

impl super::AdminServer {
    pub(super) async fn stage_upload_urls(
        &self,
        ctx: &ProjectContext,
        args: StageArgs,
    ) -> Result<StageOutput, ToolError> {
        ctx.require_scope("admin:propose")?;
        let project = resolve_tool_project(&self.state, ctx, args.project_slug.as_deref()).await?;
        if args.files.is_empty() || args.files.len() > 200 {
            return Err(ToolError::bad_request("files must contain 1-200 entries"));
        }
        let paths: Vec<String> = args.files.iter().map(|f| f.remote_path.clone()).collect();
        let normalized = normalize_path_set(&paths).map_err(ToolError::bad_request)?;
        let session_id = Uuid::new_v4();
        let session_short_code = crate::short_id::generate_short_code();
        let expires_at = chrono::Utc::now()
            + chrono::Duration::seconds(self.state.config.transfer_ttl.as_secs() as i64);
        let mut staged = Vec::new();
        let mut uploads = Vec::new();
        let mut commands = Vec::new();
        for (file, path) in args.files.iter().zip(normalized.iter()) {
            if file.remote_path.trim().is_empty() {
                return Err(ToolError::bad_request("remote_path must not be empty"));
            }
            if let Some(local) = &file.local_path_hint
                && local.chars().any(|c| c.is_control())
            {
                return Err(ToolError::bad_request(
                    "local_path_hint must not contain control characters",
                ));
            }
            if let Some(expected) = &file.expected_sha256
                && (expected.len() != 64 || !expected.bytes().all(|b| b.is_ascii_hexdigit()))
            {
                return Err(ToolError::bad_request(
                    "expected_sha256 must be 64 hexadecimal characters",
                ));
            }
            if let Some(size) = file.expected_size
                && (size < 0 || size as u64 > self.state.config.max_upload_bytes)
            {
                return Err(ToolError::bad_request(
                    "expected_size is outside the allowed range",
                ));
            }
            let content_type = sanitize_content_type(file.content_type.as_deref());
            let object_key = staging_key(project.id, session_id, path);
            let url = self
                .state
                .storage
                .presign_put(&object_key, self.state.config.transfer_ttl)
                .await
                .map_err(|e| ToolError::internal(format!("sign upload: {e}")))?;
            let local = file.local_path_hint.clone().unwrap_or_else(|| path.clone());
            let command = format!(
                "curl -fsS -X PUT -T {} -H {} {}",
                shell_quote(&local),
                shell_quote(&format!("Content-Type: {content_type}")),
                shell_quote(&url)
            );
            commands.push(command);
            uploads.push(StagedUploadView {
                path: path.clone(),
                method: "PUT".to_string(),
                url,
                content_type: content_type.clone(),
            });
            staged.push(StagedFile {
                path: path.clone(),
                object_key,
                content_type,
                expected_sha256: file
                    .expected_sha256
                    .as_ref()
                    .map(|s| s.to_ascii_lowercase()),
                expected_size: file.expected_size,
                local_path_hint: file.local_path_hint.clone(),
            });
        }
        let files_json = serde_json::to_value(&staged)
            .map_err(|e| ToolError::internal(format!("serialize session: {e}")))?;
        sqlx::query(
            r#"
            INSERT INTO transfer_sessions
                (id, short_code, project_id, user_id, api_key_id, status, files, expires_at)
            VALUES ($1, $2, $3, $4, $5, 'open', $6, $7)
            "#,
        )
        .bind(session_id)
        .bind(&session_short_code)
        .bind(project.id)
        .bind(ctx.key.user_id)
        .bind(ctx.key.api_key_id)
        .bind(sqlx::types::Json(files_json))
        .bind(expires_at)
        .execute(&self.state.db)
        .await
        .map_err(|e| ToolError::internal(format!("create transfer session: {e}")))?;

        let command = commands.join("\n");
        Ok(StageOutput {
            session_id: session_short_code,
            session_uuid: session_id,
            project: project.slug,
            expires_at: expires_at.to_rfc3339(),
            uploads,
            command,
            next: "upload each file, then call propose_revision with session_id".to_string(),
        })
    }

    pub(super) async fn propose_revision(
        &self,
        ctx: &ProjectContext,
        args: ProposeArgs,
    ) -> Result<ProposeOutput, ToolError> {
        ctx.require_scope("admin:propose")?;
        let project = resolve_tool_project(&self.state, ctx, args.project_slug.as_deref()).await?;
        if args.session_id.is_none()
            && args.inline_patches.as_ref().is_none_or(|p| p.is_empty())
            && args.deletions.as_ref().is_none_or(|d| d.is_empty())
        {
            return Err(ToolError::bad_request(
                "provide session_id, inline_patches and/or deletions",
            ));
        }

        let mut changes = Vec::new();
        let mut resolved_session_uuid: Option<Uuid> = None;
        if let Some(session_ref) = &args.session_id {
            let session = load_transfer_session(&self.state, session_ref, project.id).await?;
            let session_id = session.id;
            resolved_session_uuid = Some(session_id);
            if session.status != "open" {
                return Err(ToolError::conflict(format!(
                    "transfer session is {} and cannot be proposed",
                    session.status
                )));
            }
            if session.expires_at <= chrono::Utc::now() {
                sqlx::query("UPDATE transfer_sessions SET status = 'expired' WHERE id = $1")
                    .bind(session_id)
                    .execute(&self.state.db)
                    .await
                    .ok();
                return Err(ToolError::new(
                    "SESSION_EXPIRED",
                    "transfer session has expired",
                ));
            }
            for file in &session.files {
                let bytes = match self.state.storage.get(&file.object_key).await {
                    Ok(bytes) => bytes,
                    Err(_) => {
                        return Err(ToolError::new(
                            "UPLOAD_MISSING",
                            format!("{} has not been uploaded to the staging object", file.path),
                        ));
                    }
                };
                if bytes.len() as u64 > self.state.config.max_upload_bytes {
                    return Err(ToolError::bad_request(format!(
                        "{} exceeds MAX_UPLOAD_BYTES",
                        file.path
                    )));
                }
                let digest = sha256_hex(&bytes);
                if let Some(expected) = &file.expected_sha256
                    && expected.to_ascii_lowercase() != digest
                {
                    sqlx::query("UPDATE transfer_sessions SET status = 'failed' WHERE id = $1")
                        .bind(session_id)
                        .execute(&self.state.db)
                        .await
                        .ok();
                    return Err(ToolError::new(
                        "DIGEST_MISMATCH",
                        format!("{} does not match its expected SHA-256", file.path),
                    ));
                }
                if let Some(expected) = file.expected_size
                    && expected as u64 != bytes.len() as u64
                {
                    sqlx::query("UPDATE transfer_sessions SET status = 'failed' WHERE id = $1")
                        .bind(session_id)
                        .execute(&self.state.db)
                        .await
                        .ok();
                    return Err(ToolError::new(
                        "SIZE_MISMATCH",
                        format!("{} does not match its expected size", file.path),
                    ));
                }
                changes.push(ProposedChange::Upsert(ProposedFile {
                    path: file.path.clone(),
                    media_type: Some(file.content_type.clone()),
                    bytes: bytes.to_vec(),
                }));
            }
        }

        let base_revision_uuid = if let Some(base_ref) = &args.base_revision_id {
            let rev =
                revisions::get_revision_for_tool_ref(&self.state.db, &project, base_ref).await?;
            Some(rev.id)
        } else {
            None
        };
        if let Some(patches) = args.inline_patches {
            let base_id = base_revision_uuid.or(project.active_revision_id);
            let base_snapshot = if patches.iter().any(|p| p.base_sha256.is_some()) {
                if let Some(base_id) = base_id {
                    Some(
                        revisions::load_snapshot(&self.state.db, base_id)
                            .await
                            .map_err(ToolError::from)?,
                    )
                } else {
                    None
                }
            } else {
                None
            };
            for patch in patches {
                let path = normalize_path(&patch.path).map_err(ToolError::bad_request)?;
                if let Some(expected) = &patch.base_sha256 {
                    let actual = base_snapshot
                        .as_ref()
                        .and_then(|snap| snap.get(&path))
                        .map(|b| b.sha256.as_str());
                    if actual != Some(expected.to_ascii_lowercase().as_str()) {
                        return Err(ToolError::new(
                            "BASE_MISMATCH",
                            format!("{path} does not match the declared base_sha256"),
                        ));
                    }
                }
                changes.push(ProposedChange::Upsert(ProposedFile {
                    path,
                    media_type: patch.content_type,
                    bytes: patch.content.into_bytes(),
                }));
            }
        }

        if let Some(deletions) = args.deletions {
            for path in deletions {
                changes.push(ProposedChange::Delete(path));
            }
        }

        let actor = Actor::from_mcp(ctx);
        let outcome = revisions::propose_revision(
            &self.state,
            &project,
            &actor,
            base_revision_uuid,
            &args.commit_message,
            changes,
        )
        .await
        .map_err(ToolError::from)?;

        if let Some(session_id) = resolved_session_uuid {
            sqlx::query(
                "UPDATE transfer_sessions SET status = 'completed', completed_at = now() WHERE id = $1",
            )
            .bind(session_id)
            .execute(&self.state.db)
            .await
            .ok();
            crate::lifecycle::discard_session_objects(&self.state, session_id).await;
        }

        let next = if outcome.revision.status == "pending_review" {
            "a human must approve this revision before activate_revision can succeed"
        } else {
            "resolve every conflict, then a human must approve the revision"
        };
        Ok(ProposeOutput {
            revision_id: outcome.revision.short_code,
            revision_uuid: outcome.revision.id,
            project: project.slug,
            status: outcome.revision.status,
            commit_message: outcome.revision.commit_message,
            token_added: outcome.revision.token_added,
            token_removed: outcome.revision.token_removed,
            file_count: outcome.revision.file_count,
            conflicts: outcome.conflicts,
            next: next.to_string(),
        })
    }
}

#[derive(Debug, Serialize, Deserialize, Clone)]
struct StagedFile {
    path: String,
    object_key: String,
    content_type: String,
    expected_sha256: Option<String>,
    expected_size: Option<i64>,
    local_path_hint: Option<String>,
}

struct TransferSession {
    id: Uuid,
    status: String,
    expires_at: chrono::DateTime<chrono::Utc>,
    files: Vec<StagedFile>,
}

async fn load_transfer_session(
    state: &AppState,
    session_ref: &str,
    project_id: Uuid,
) -> Result<TransferSession, ToolError> {
    let parsed = crate::short_id::IdRef::parse(session_ref).map_err(ToolError::bad_request)?;
    type TransferSessionRow = (
        Uuid,
        Uuid,
        String,
        chrono::DateTime<chrono::Utc>,
        sqlx::types::Json<Value>,
    );
    let row: Option<TransferSessionRow> = match parsed {
        crate::short_id::IdRef::Uuid(id) => {
            sqlx::query_as(
                "SELECT id, project_id, status, expires_at, files FROM transfer_sessions WHERE id = $1",
            )
            .bind(id)
            .fetch_optional(&state.db)
            .await
            .map_err(|e| ToolError::internal(format!("load transfer session: {e}")))?
        }
        crate::short_id::IdRef::ShortCode(code) => {
            sqlx::query_as(
                "SELECT id, project_id, status, expires_at, files FROM transfer_sessions WHERE project_id = $1 AND short_code = $2",
            )
            .bind(project_id)
            .bind(code)
            .fetch_optional(&state.db)
            .await
            .map_err(|e| ToolError::internal(format!("load transfer session: {e}")))?
        }
    };
    let (id, row_project, status, expires_at, files) =
        row.ok_or_else(|| ToolError::not_found("transfer session not found"))?;
    if row_project != project_id {
        return Err(ToolError::not_found("transfer session not found"));
    }
    let files: Vec<StagedFile> = serde_json::from_value(files.0)
        .map_err(|e| ToolError::internal(format!("decode transfer session: {e}")))?;
    Ok(TransferSession {
        id,
        status,
        expires_at,
        files,
    })
}

fn sanitize_content_type(value: Option<&str>) -> String {
    let candidate = value.unwrap_or("application/octet-stream").trim();
    let valid = !candidate.is_empty()
        && candidate.len() <= 200
        && candidate.chars().all(|c| {
            c.is_ascii_alphanumeric() || matches!(c, '/' | '+' | '-' | '.' | ';' | '=' | ' ')
        });
    if valid {
        candidate.to_string()
    } else {
        "application/octet-stream".to_string()
    }
}
