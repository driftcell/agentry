use std::collections::{HashMap, HashSet};

use serde_json::{Value, json};
use uuid::Uuid;

use crate::AppState;
use crate::content::{ContentBlob, ingest_bytes};
use crate::error::AppError;
use crate::paths::{normalize_path, normalize_path_set};
use crate::project::Project;

use super::audit::insert_audit;
use super::merge::merge_snapshots;
use super::model::*;
use super::store::{get_revision, get_revision_for_project, load_snapshot};
pub async fn propose_revision(
    state: &AppState,
    project: &Project,
    author: &Actor,
    base_revision_id: Option<Uuid>,
    commit_message: &str,
    changes: Vec<ProposedChange>,
) -> Result<ProposalOutcome, AppError> {
    let commit_message = commit_message.trim();
    if commit_message.is_empty() || commit_message.chars().count() > 10000 {
        return Err(AppError::bad_request(
            "INVALID_ARGUMENT",
            "commit_message must be between 1 and 10000 characters",
        ));
    }
    if changes.is_empty() {
        return Err(AppError::bad_request(
            "INVALID_ARGUMENT",
            "a proposal must change at least one file",
        ));
    }
    if changes.len() > 1000 {
        return Err(AppError::bad_request(
            "INVALID_ARGUMENT",
            "a proposal may touch at most 1000 files",
        ));
    }

    let active_revision_id = project.active_revision_id;
    let active_map = if let Some(active_id) = active_revision_id {
        load_snapshot(&state.db, active_id).await?
    } else {
        HashMap::new()
    };

    let (base_map, base_id) = if let Some(base_id) = base_revision_id {
        if Some(base_id) == active_revision_id {
            (active_map.clone(), Some(base_id))
        } else {
            let base = get_revision_for_project(&state.db, project.id, base_id)
                .await?
                .ok_or_else(|| {
                    AppError::bad_request(
                        "INVALID_BASE",
                        "base revision does not belong to this project",
                    )
                })?;
            (load_snapshot(&state.db, base.id).await?, Some(base.id))
        }
    } else if let Some(active_id) = active_revision_id {
        (active_map.clone(), Some(active_id))
    } else {
        (HashMap::new(), None)
    };

    let mut incoming: HashMap<String, ContentBlob> = HashMap::new();
    let mut deletions: HashSet<String> = HashSet::new();
    let mut paths = Vec::new();
    for change in changes {
        match change {
            ProposedChange::Upsert(file) => {
                let path = normalize_path(&file.path)
                    .map_err(|e| AppError::bad_request("INVALID_PATH", e))?;
                if file.bytes.len() as u64 > state.config.max_upload_bytes {
                    return Err(AppError::bad_request(
                        "FILE_TOO_LARGE",
                        format!("{path} exceeds MAX_UPLOAD_BYTES"),
                    ));
                }
                if deletions.contains(&path) || incoming.contains_key(&path) {
                    return Err(AppError::bad_request(
                        "INVALID_PATH",
                        format!("duplicate path in proposal: {path}"),
                    ));
                }
                let blob = ingest_bytes(
                    &state.db,
                    &state.storage,
                    &path,
                    file.media_type.as_deref(),
                    &file.bytes,
                )
                .await
                .map_err(|e| AppError::internal(format!("ingest {path}: {e}")))?;
                paths.push(path.clone());
                incoming.insert(path, blob);
            }
            ProposedChange::Delete(raw) => {
                let path =
                    normalize_path(&raw).map_err(|e| AppError::bad_request("INVALID_PATH", e))?;
                if deletions.contains(&path) || incoming.contains_key(&path) {
                    return Err(AppError::bad_request(
                        "INVALID_PATH",
                        format!("duplicate path in proposal: {path}"),
                    ));
                }
                paths.push(path.clone());
                deletions.insert(path);
            }
        }
    }
    let _ = normalize_path_set(&paths).map_err(|e| AppError::bad_request("INVALID_PATH", e))?;

    let merged = merge_snapshots(state, &base_map, &active_map, &incoming, &deletions).await?;
    let results = merged.results;
    let conflicts = merged.conflicts;
    let token_added = merged.token_added;
    let token_removed = merged.token_removed;
    let total_tokens = merged.total_tokens;
    let file_count = merged.file_count;

    let status = if conflicts.is_empty() {
        STATUS_PENDING
    } else {
        STATUS_CONFLICT
    };
    let conflict_summary = if conflicts.is_empty() {
        None
    } else {
        Some(sqlx::types::Json(
            serde_json::to_value(conflicts.iter().map(ConflictView::from).collect::<Vec<_>>())
                .unwrap_or(Value::Array(vec![])),
        ))
    };

    let mut tx = state.db.begin().await.map_err(AppError::from_db)?;
    let mut inserted_id: Option<Uuid> = None;
    for _ in 0..3 {
        let short_code = crate::short_id::generate_short_code();
        inserted_id = sqlx::query_scalar(
            r#"
            INSERT INTO revisions
                (project_id, short_code, base_revision_id, merged_against_revision_id, status,
                 commit_message, author_user_id, author_api_key_id, token_added,
                 token_removed, total_tokens, file_count, conflict_summary)
            VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)
            ON CONFLICT (project_id, short_code) DO NOTHING
            RETURNING id
            "#,
        )
        .bind(project.id)
        .bind(&short_code)
        .bind(base_id)
        .bind(active_revision_id)
        .bind(status)
        .bind(commit_message)
        .bind(author.user_id)
        .bind(author.api_key_id)
        .bind(token_added as i32)
        .bind(token_removed as i32)
        .bind(total_tokens)
        .bind(file_count)
        .bind(&conflict_summary)
        .fetch_optional(&mut *tx)
        .await
        .map_err(AppError::from_db)?;
        if inserted_id.is_some() {
            break;
        }
    }
    let revision_id = inserted_id.ok_or_else(|| {
        AppError::internal("could not allocate a unique revision short_code after 3 attempts")
    })?;

    for (path, result, change_type) in &results {
        let Some(blob) = result else { continue };
        let previous_blob_id = active_map.get(path).map(|b| b.id);
        let active_tokens = tokens_of(active_map.get(path));
        let result_tokens = tokens_of(Some(blob));
        let delta = if change_type == "deleted" {
            -active_tokens
        } else {
            result_tokens - active_tokens
        };
        let stored_tokens = if change_type == "deleted" {
            0
        } else {
            result_tokens
        };
        sqlx::query(
            r#"
            INSERT INTO revision_files
                (revision_id, path, blob_id, previous_blob_id, change_type,
                 token_delta, token_count, is_text, size_bytes)
            VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)
            "#,
        )
        .bind(revision_id)
        .bind(path)
        .bind(blob.id)
        .bind(previous_blob_id)
        .bind(change_type)
        .bind(delta)
        .bind(stored_tokens)
        .bind(blob.is_text)
        .bind(blob.size_bytes)
        .execute(&mut *tx)
        .await
        .map_err(AppError::from_db)?;
    }

    for detail in &conflicts {
        let value = serde_json::to_value(detail).unwrap_or(Value::Null);
        sqlx::query(
            "INSERT INTO revision_conflicts (revision_id, path, detail) VALUES ($1, $2, $3)",
        )
        .bind(revision_id)
        .bind(&detail.path)
        .bind(sqlx::types::Json(value))
        .execute(&mut *tx)
        .await
        .map_err(AppError::from_db)?;
    }

    for (path, blob) in &incoming {
        sqlx::query(
            "INSERT INTO revision_inputs (revision_id, path, blob_id, deleted) VALUES ($1, $2, $3, false)",
        )
        .bind(revision_id)
        .bind(path)
        .bind(blob.id)
        .execute(&mut *tx)
        .await
        .map_err(AppError::from_db)?;
    }

    for path in &deletions {
        sqlx::query(
            "INSERT INTO revision_inputs (revision_id, path, blob_id, deleted) VALUES ($1, $2, NULL, true)",
        )
        .bind(revision_id)
        .bind(path)
        .execute(&mut *tx)
        .await
        .map_err(AppError::from_db)?;
    }

    insert_audit(
        &mut tx,
        Some(project.id),
        Some(revision_id),
        author,
        "propose_revision",
        "ok",
        json!({
            "status": status,
            "base_revision_id": base_id,
            "merged_against_revision_id": active_revision_id,
            "files": results.len(),
            "conflicts": conflicts.len(),
            "token_added": token_added,
            "token_removed": token_removed,
        }),
    )
    .await?;
    tx.commit().await.map_err(AppError::from_db)?;

    let revision = get_revision(&state.db, revision_id)
        .await?
        .ok_or_else(|| AppError::internal("revision vanished after proposal"))?;
    Ok(ProposalOutcome {
        revision,
        conflicts: conflicts.iter().map(ConflictView::from).collect(),
    })
}
