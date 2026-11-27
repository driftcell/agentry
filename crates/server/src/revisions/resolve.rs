use std::collections::{HashMap, HashSet};

use serde_json::{Value, json};
use uuid::Uuid;

use crate::AppState;
use crate::content::{ContentBlob, blob_by_id, ingest_bytes};
use crate::error::AppError;
use crate::paths::normalize_path;
use crate::project::Project;

use super::audit::insert_audit;
use super::model::*;
use super::store::{get_revision, load_revision_for_update, load_snapshot, lock_project_active};
pub async fn resolve_conflict(
    state: &AppState,
    project: &Project,
    revision_id: Uuid,
    actor: &Actor,
    resolutions: Vec<Resolution>,
    commit_message: &str,
) -> Result<Revision, AppError> {
    let commit_message = commit_message.trim();
    if commit_message.is_empty() || commit_message.chars().count() > 10000 {
        return Err(AppError::bad_request(
            "INVALID_ARGUMENT",
            "commit_message must be between 1 and 10000 characters",
        ));
    }
    let mut tx = state.db.begin().await.map_err(AppError::from_db)?;
    // Lock order is project then revision, matching activation.
    let active_id = lock_project_active(&mut tx, project.id).await?;
    let revision = load_revision_for_update(&mut tx, revision_id).await?;
    if revision.project_id != project.id {
        return Err(AppError::not_found(
            "REVISION_NOT_FOUND",
            "revision not found",
        ));
    }
    if revision.status != STATUS_CONFLICT {
        return Err(AppError::conflict(
            "REVISION_STATE",
            format!(
                "revision is {}; only conflict revisions can be resolved",
                revision.status
            ),
        ));
    }

    let conflict_rows: Vec<(String, sqlx::types::Json<Value>)> = sqlx::query_as(
        "SELECT path, detail FROM revision_conflicts WHERE revision_id = $1 ORDER BY path",
    )
    .bind(revision_id)
    .fetch_all(&mut *tx)
    .await
    .map_err(AppError::from_db)?;
    let conflict_paths: HashSet<String> = conflict_rows.iter().map(|(p, _)| p.clone()).collect();

    let mut resolved: HashMap<String, ContentBlob> = HashMap::new();
    for resolution in &resolutions {
        let path = normalize_path(&resolution.path)
            .map_err(|e| AppError::bad_request("INVALID_PATH", e))?;
        if !conflict_paths.contains(&path) {
            return Err(AppError::bad_request(
                "UNKNOWN_CONFLICT",
                format!("{path} is not a conflict in this revision"),
            ));
        }
        if resolved.contains_key(&path) {
            return Err(AppError::bad_request(
                "INVALID_PATH",
                format!("duplicate resolution for {path}"),
            ));
        }
        let bytes = match (&resolution.content, &resolution.oss_key) {
            (Some(content), None) => content.as_bytes().to_vec(),
            (None, Some(key)) => {
                let prefix = format!("staging/{}/", project.id);
                if !key.starts_with(&prefix) {
                    return Err(AppError::forbidden(
                        "OSS_KEY_DENIED",
                        "resolution object key must belong to this project's staging area",
                    ));
                }
                let bytes = state.storage.get(key).await.map_err(|e| {
                    AppError::bad_request(
                        "OSS_OBJECT_UNAVAILABLE",
                        format!("cannot read resolution object: {e}"),
                    )
                })?;
                bytes.to_vec()
            }
            _ => {
                return Err(AppError::bad_request(
                    "INVALID_ARGUMENT",
                    format!("resolution for {path} must set exactly one of content or oss_key"),
                ));
            }
        };
        if bytes.len() as u64 > state.config.max_upload_bytes {
            return Err(AppError::bad_request(
                "FILE_TOO_LARGE",
                format!("{path} exceeds MAX_UPLOAD_BYTES"),
            ));
        }
        let blob = ingest_bytes(&state.db, &state.storage, &path, None, &bytes)
            .await
            .map_err(|e| AppError::internal(format!("ingest resolution {path}: {e}")))?;
        resolved.insert(path, blob);
    }
    if resolved.len() != conflict_paths.len() {
        let missing = conflict_paths
            .iter()
            .filter(|p| !resolved.contains_key(*p))
            .cloned()
            .collect::<Vec<_>>();
        return Err(AppError::bad_request(
            "UNRESOLVED_CONFLICTS",
            format!(
                "all conflicts must be resolved; missing: {}",
                missing.join(", ")
            ),
        ));
    }

    let active_map = if let Some(active_id) = active_id {
        load_snapshot(&state.db, active_id).await?
    } else {
        HashMap::new()
    };
    let existing = sqlx::query_as::<_, (String, Uuid, Option<Uuid>, String)>(
        "SELECT path, blob_id, previous_blob_id, change_type FROM revision_files WHERE revision_id = $1",
    )
    .bind(revision_id)
    .fetch_all(&mut *tx)
    .await
    .map_err(AppError::from_db)?;
    // (blob id, previous blob id, boolean: this row represents a deletion)
    let mut result_map: HashMap<String, (Uuid, Option<Uuid>, bool)> = existing
        .into_iter()
        .map(|(path, blob, prev, change_type)| (path, (blob, prev, change_type == "deleted")))
        .collect();
    for (path, blob) in &resolved {
        result_map.insert(
            path.clone(),
            (blob.id, active_map.get(path).map(|b| b.id), false),
        );
    }

    // Recompute the entire snapshot relative to the current active revision.
    // A resolution rebases the revision: merged_against_revision_id is set to
    // the active revision current at resolution time.
    let mut token_added = 0i64;
    let mut token_removed = 0i64;
    let mut total_tokens = 0i64;
    let mut file_count = 0i32;
    let mut rows = Vec::new();
    let mut paths: Vec<String> = result_map.keys().cloned().collect();
    paths.sort();
    for path in paths {
        let (blob_id, previous_blob_id, is_deletion) = result_map[&path];
        let blob = blob_by_id(&state.db, blob_id)
            .await
            .map_err(|e| AppError::internal(format!("load blob: {e}")))?
            .ok_or_else(|| AppError::internal("blob missing"))?;
        let active_blob = active_map.get(&path);
        let active_tokens = tokens_of(active_blob);
        if is_deletion {
            // Preserve a deletion only while it is a real difference against
            // the current active revision.
            if active_blob.is_none() {
                continue;
            }
            let delta = -active_tokens;
            token_removed += i64::from(active_tokens);
            rows.push((
                path,
                blob.id,
                active_blob.map(|b| b.id),
                "deleted".to_string(),
                delta,
                0,
                blob.is_text,
                blob.size_bytes,
            ));
            continue;
        }
        let current_tokens = tokens_of(Some(&blob));
        let delta = current_tokens - active_tokens;
        if delta > 0 {
            token_added += i64::from(delta);
        } else {
            token_removed += i64::from(-delta);
        }
        let change_type = match active_blob {
            None => "added",
            Some(active) if active.sha256 == blob.sha256 => "unchanged",
            Some(_) => "modified",
        };
        total_tokens += i64::from(current_tokens);
        file_count += 1;
        rows.push((
            path,
            blob.id,
            previous_blob_id,
            change_type.to_string(),
            delta,
            current_tokens,
            blob.is_text,
            blob.size_bytes,
        ));
    }

    sqlx::query("DELETE FROM revision_files WHERE revision_id = $1")
        .bind(revision_id)
        .execute(&mut *tx)
        .await
        .map_err(AppError::from_db)?;
    for row in &rows {
        sqlx::query(
            r#"
            INSERT INTO revision_files
                (revision_id, path, blob_id, previous_blob_id, change_type,
                 token_delta, token_count, is_text, size_bytes)
            VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)
            "#,
        )
        .bind(revision_id)
        .bind(&row.0)
        .bind(row.1)
        .bind(row.2)
        .bind(&row.3)
        .bind(row.4)
        .bind(row.5)
        .bind(row.6)
        .bind(row.7)
        .execute(&mut *tx)
        .await
        .map_err(AppError::from_db)?;
    }

    sqlx::query("DELETE FROM revision_conflicts WHERE revision_id = $1")
        .bind(revision_id)
        .execute(&mut *tx)
        .await
        .map_err(AppError::from_db)?;
    sqlx::query(
        r#"
        UPDATE revisions
        SET status = $2, merged_against_revision_id = $3, commit_message = $4,
            conflict_summary = NULL, token_added = $5, token_removed = $6,
            total_tokens = $7, file_count = $8
        WHERE id = $1
        "#,
    )
    .bind(revision_id)
    .bind(STATUS_PENDING)
    .bind(active_id)
    .bind(commit_message)
    .bind(token_added as i32)
    .bind(token_removed as i32)
    .bind(total_tokens)
    .bind(file_count)
    .execute(&mut *tx)
    .await
    .map_err(AppError::from_db)?;

    insert_audit(
        &mut tx,
        Some(project.id),
        Some(revision_id),
        actor,
        "resolve_conflict",
        "ok",
        json!({"resolved": resolved.len(), "files": rows.len()}),
    )
    .await?;
    tx.commit().await.map_err(AppError::from_db)?;
    get_revision(&state.db, revision_id)
        .await?
        .ok_or_else(|| AppError::internal("revision vanished after resolution"))
}
