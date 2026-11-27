use std::collections::HashMap;

use serde::Serialize;
use serde_json::Value;
use sqlx::{PgPool, Postgres, Transaction};
use uuid::Uuid;

use crate::AppState;
use crate::content::{ContentBlob, blob_by_id, read_blob_text};
use crate::error::{AppError, ToolError};
use crate::markdown::Outline;
use crate::paths::normalize_path;
use crate::project::Project;

use super::model::*;
pub async fn load_snapshot(
    db: &PgPool,
    revision_id: Uuid,
) -> Result<HashMap<String, ContentBlob>, AppError> {
    #[derive(sqlx::FromRow)]
    struct SnapshotRow {
        path: String,
        id: Uuid,
        sha256: String,
        size_bytes: i64,
        media_type: String,
        is_text: bool,
        text_content: Option<String>,
        object_key: Option<String>,
        token_count: Option<i32>,
        token_status: String,
        token_error: Option<String>,
        outline: Option<sqlx::types::Json<Outline>>,
    }
    let rows = sqlx::query_as::<_, SnapshotRow>(
        r#"
        SELECT rf.path, b.id, b.sha256, b.size_bytes, b.media_type, b.is_text,
               b.text_content, b.object_key, b.token_count, b.token_status,
               b.token_error, b.outline
        FROM revision_files rf
        JOIN content_blobs b ON b.id = rf.blob_id
        WHERE rf.revision_id = $1 AND rf.change_type <> 'deleted'
        "#,
    )
    .bind(revision_id)
    .fetch_all(db)
    .await
    .map_err(AppError::from_db)?;
    Ok(rows
        .into_iter()
        .map(|row| {
            (
                row.path,
                ContentBlob {
                    id: row.id,
                    sha256: row.sha256,
                    size_bytes: row.size_bytes,
                    media_type: row.media_type,
                    is_text: row.is_text,
                    text_content: row.text_content,
                    object_key: row.object_key,
                    token_count: row.token_count,
                    token_status: row.token_status,
                    token_error: row.token_error,
                    outline: row.outline,
                },
            )
        })
        .collect())
}

pub(super) async fn load_revision_for_update(
    tx: &mut Transaction<'_, Postgres>,
    revision_id: Uuid,
) -> Result<Revision, AppError> {
    sqlx::query_as::<_, Revision>(
        r#"
        SELECT id, project_id, base_revision_id, merged_against_revision_id, status,
               commit_message, author_user_id, author_api_key_id, token_added,
               token_removed, total_tokens, file_count, conflict_summary,
               review_comment, reviewed_by, reviewed_at, activated_at,
               created_at, updated_at
        FROM revisions WHERE id = $1 FOR UPDATE
        "#,
    )
    .bind(revision_id)
    .fetch_optional(&mut **tx)
    .await
    .map_err(AppError::from_db)?
    .ok_or_else(|| AppError::not_found("REVISION_NOT_FOUND", "revision not found"))
}

pub async fn get_revision(db: &PgPool, revision_id: Uuid) -> Result<Option<Revision>, AppError> {
    sqlx::query_as::<_, Revision>(
        r#"
        SELECT id, project_id, base_revision_id, merged_against_revision_id, status,
               commit_message, author_user_id, author_api_key_id, token_added,
               token_removed, total_tokens, file_count, conflict_summary,
               review_comment, reviewed_by, reviewed_at, activated_at,
               created_at, updated_at
        FROM revisions WHERE id = $1
        "#,
    )
    .bind(revision_id)
    .fetch_optional(db)
    .await
    .map_err(AppError::from_db)
}

pub async fn get_revision_for_project(
    db: &PgPool,
    project_id: Uuid,
    revision_id: Uuid,
) -> Result<Option<Revision>, AppError> {
    let revision = get_revision(db, revision_id).await?;
    Ok(revision.filter(|r| r.project_id == project_id))
}

/// Propose an immutable revision. All content hashes, token counts and the
/// three-way merge are computed here, before the transaction, so a failure
/// cannot leave a partially-visible revision.

pub async fn revision_files(
    db: &PgPool,
    project: &Project,
    revision: &Revision,
) -> Result<Vec<RevisionFileView>, AppError> {
    let active_id = project.active_revision_id;
    let rows = sqlx::query_as::<_, RevisionFileView>(
        r#"
        SELECT rf.path, rf.change_type, rf.token_delta, rf.token_count,
               rf.is_text, rf.size_bytes, rf.blob_id, b.sha256,
               pb.sha256 AS previous_sha256,
               bb.sha256 AS base_sha256,
               ab.sha256 AS active_sha256
        FROM revision_files rf
        JOIN content_blobs b ON b.id = rf.blob_id
        LEFT JOIN content_blobs pb ON pb.id = rf.previous_blob_id
        LEFT JOIN revision_files brf
               ON brf.revision_id = $2 AND brf.path = rf.path AND brf.change_type <> 'deleted'
        LEFT JOIN content_blobs bb ON bb.id = brf.blob_id
        LEFT JOIN revision_files arf
               ON arf.revision_id = $3 AND arf.path = rf.path AND arf.change_type <> 'deleted'
        LEFT JOIN content_blobs ab ON ab.id = arf.blob_id
        WHERE rf.revision_id = $1
        ORDER BY rf.change_type = 'deleted', rf.path
        "#,
    )
    .bind(revision.id)
    .bind(revision.base_revision_id)
    .bind(active_id)
    .fetch_all(db)
    .await
    .map_err(AppError::from_db)?;
    Ok(rows)
}

pub async fn revision_conflicts(
    db: &PgPool,
    revision_id: Uuid,
) -> Result<Vec<ConflictDetail>, AppError> {
    let rows: Vec<(String, sqlx::types::Json<Value>)> = sqlx::query_as(
        "SELECT path, detail FROM revision_conflicts WHERE revision_id = $1 ORDER BY path",
    )
    .bind(revision_id)
    .fetch_all(db)
    .await
    .map_err(AppError::from_db)?;
    Ok(rows
        .into_iter()
        .map(|(path, json)| {
            let mut detail: ConflictDetail = serde_json::from_value(json.0)
                .unwrap_or(ConflictDetail {
                    path: path.clone(),
                    hunks: 1,
                    lines: vec![1],
                    base_sha256: None,
                    active_sha256: None,
                    incoming_sha256: None,
                    merged_sha256: None,
                    preview: None,
                });
            if detail.path.is_empty() {
                detail.path = path;
            }
            detail
        })
        .collect())
}

/// Read one side of a file for the Diff Studio. Returns text content for text
/// blobs and a short-lived presigned URL for binary blobs; never both.
#[derive(Debug, Clone, Serialize)]

pub struct FileSide {
    pub path: String,
    pub side: String,
    pub content: Option<String>,
    pub url: Option<String>,
    pub sha256: Option<String>,
    pub size_bytes: i64,
    pub is_text: bool,
    pub media_type: Option<String>,
    pub token_count: Option<i32>,
}

pub async fn file_side(
    state: &AppState,
    project: &Project,
    revision: &Revision,
    path: &str,
    side: &str,
) -> Result<FileSide, AppError> {
    let path = normalize_path(path)
        .map_err(|e| AppError::bad_request("INVALID_PATH", e))?;
    let revision_id = match side {
        "incoming" => revision.id,
        "base" => revision
            .base_revision_id
            .ok_or_else(|| AppError::not_found("NOT_FOUND", "this revision has no base"))?,
        "active" => project
            .active_revision_id
            .ok_or_else(|| AppError::not_found("NOT_FOUND", "project has no active revision"))?,
        _ => {
            return Err(AppError::bad_request(
                "INVALID_ARGUMENT",
                "side must be base, active or incoming",
            ));
        }
    };
    let blob_id: Option<Uuid> = sqlx::query_scalar(
        "SELECT blob_id FROM revision_files WHERE revision_id = $1 AND path = $2 AND change_type <> 'deleted'",
    )
    .bind(revision_id)
    .bind(&path)
    .fetch_optional(&state.db)
    .await
    .map_err(AppError::from_db)?;
    let Some(blob_id) = blob_id else {
        return Ok(FileSide {
            path,
            side: side.to_string(),
            content: None,
            url: None,
            sha256: None,
            size_bytes: 0,
            is_text: true,
            media_type: None,
            token_count: None,
        });
    };
    let blob = blob_by_id(&state.db, blob_id)
        .await
        .map_err(|e| AppError::internal(format!("load blob: {e}")))?
        .ok_or_else(|| AppError::not_found("NOT_FOUND", "file not found"))?;
    if blob.is_text {
        Ok(FileSide {
            path,
            side: side.to_string(),
            content: blob.text_content.clone(),
            url: None,
            sha256: Some(blob.sha256),
            size_bytes: blob.size_bytes,
            is_text: true,
            media_type: Some(blob.media_type),
            token_count: blob.token_count,
        })
    } else {
        let key = blob
            .object_key
            .as_deref()
            .ok_or_else(|| AppError::internal("binary blob has no object key"))?;
        let url = state
            .storage
            .presign_get(key, state.config.oss.as_ref().map(|o| o.presign_ttl).unwrap_or(std::time::Duration::from_secs(600)))
            .await
            .map_err(|e| AppError::internal(format!("presign binary blob: {e}")))?;
        Ok(FileSide {
            path,
            side: side.to_string(),
            content: None,
            url: Some(url),
            sha256: Some(blob.sha256),
            size_bytes: blob.size_bytes,
            is_text: false,
            media_type: Some(blob.media_type),
            token_count: None,
        })
    }
}

pub async fn get_revision_for_tool(
    db: &PgPool,
    project: &Project,
    revision_id: Uuid,
) -> Result<Revision, ToolError> {
    let revision = get_revision_for_project(db, project.id, revision_id)
        .await
        .map_err(ToolError::from)?
        .ok_or_else(|| ToolError::not_found("revision not found"))?;
    Ok(revision)
}

pub async fn list_review_queue(
    db: &PgPool,
    project_id: Uuid,
) -> Result<Vec<Revision>, AppError> {
    let rows = sqlx::query_as::<_, Revision>(
        r#"
        SELECT id, project_id, base_revision_id, merged_against_revision_id, status,
               commit_message, author_user_id, author_api_key_id, token_added,
               token_removed, total_tokens, file_count, conflict_summary,
               review_comment, reviewed_by, reviewed_at, activated_at,
               created_at, updated_at
        FROM revisions
        WHERE project_id = $1 AND status IN ('pending_review', 'conflict')
        ORDER BY created_at DESC
        "#,
    )
    .bind(project_id)
    .fetch_all(db)
    .await
    .map_err(AppError::from_db)?;
    Ok(rows)
}

pub async fn list_recent_revisions(
    db: &PgPool,
    project_id: Option<Uuid>,
    limit: i64,
) -> Result<Vec<Revision>, AppError> {
    let rows = if let Some(project_id) = project_id {
        sqlx::query_as::<_, Revision>(
            r#"
            SELECT id, project_id, base_revision_id, merged_against_revision_id, status,
                   commit_message, author_user_id, author_api_key_id, token_added,
                   token_removed, total_tokens, file_count, conflict_summary,
                   review_comment, reviewed_by, reviewed_at, activated_at,
                   created_at, updated_at
            FROM revisions WHERE project_id = $1
            ORDER BY created_at DESC LIMIT $2
            "#,
        )
        .bind(project_id)
        .bind(limit)
        .fetch_all(db)
        .await
    } else {
        sqlx::query_as::<_, Revision>(
            r#"
            SELECT id, project_id, base_revision_id, merged_against_revision_id, status,
                   commit_message, author_user_id, author_api_key_id, token_added,
                   token_removed, total_tokens, file_count, conflict_summary,
                   review_comment, reviewed_by, reviewed_at, activated_at,
                   created_at, updated_at
            FROM revisions ORDER BY created_at DESC LIMIT $1
            "#,
        )
        .bind(limit)
        .fetch_all(db)
        .await
    };
    rows.map_err(AppError::from_db)
}

pub async fn read_text_for_revision_path(
    db: &PgPool,
    revision_id: Uuid,
    path: &str,
) -> Result<Option<String>, AppError> {
    let blob_id: Option<Uuid> = sqlx::query_scalar(
        "SELECT blob_id FROM revision_files WHERE revision_id = $1 AND path = $2 AND change_type <> 'deleted'",
    )
    .bind(revision_id)
    .bind(path)
    .fetch_optional(db)
    .await
    .map_err(AppError::from_db)?;
    if let Some(blob_id) = blob_id {
        read_blob_text(db, blob_id)
            .await
            .map_err(|e| AppError::internal(format!("read blob: {e}")))
    } else {
        Ok(None)
    }
}

