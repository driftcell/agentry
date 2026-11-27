use std::collections::{HashMap, HashSet};

use serde_json::{Value, json};
use sqlx::{Postgres, Transaction};
use uuid::Uuid;

use crate::AppState;
use crate::content::{ContentBlob, blob_by_id};
use crate::error::AppError;
use crate::project::Project;

use super::audit::insert_audit;
use super::merge::merge_snapshots;
use super::model::*;
use super::store::{get_revision, load_revision_for_update, load_snapshot, lock_project_active};

/// Recompute a stale pending revision against the current active revision,
/// updating the same revision row instead of creating a duplicate.
pub async fn rebase_revision(
    state: &AppState,
    project: &Project,
    revision_id: Uuid,
    actor: &Actor,
) -> Result<Revision, AppError> {
    let mut tx = state.db.begin().await.map_err(AppError::from_db)?;

    let active_id = lock_project_active(&mut tx, project.id).await?;
    let revision = load_revision_for_update(&mut tx, revision_id).await?;
    if revision.project_id != project.id {
        return Err(AppError::not_found(
            "REVISION_NOT_FOUND",
            "revision not found",
        ));
    }
    if revision.status != STATUS_PENDING {
        return Err(AppError::conflict(
            "REVISION_STATE",
            format!(
                "revision is {}; only pending_review revisions can be rebased",
                revision.status
            ),
        ));
    }
    if revision.merged_against_revision_id == active_id {
        return Err(AppError::conflict(
            "REVISION_NOT_STALE",
            "revision is already merged against the current active revision",
        ));
    }

    let base_map = if let Some(base_id) = revision.base_revision_id {
        load_snapshot(&state.db, base_id).await?
    } else {
        HashMap::new()
    };
    let active_map = if let Some(active_id) = active_id {
        load_snapshot(&state.db, active_id).await?
    } else {
        HashMap::new()
    };

    let (incoming, deletions, replacement_inputs) =
        load_revision_inputs(state, &mut tx, revision_id).await?;

    let merged = merge_snapshots(state, &base_map, &active_map, &incoming, &deletions).await?;
    let status = if merged.conflicts.is_empty() {
        STATUS_PENDING
    } else {
        STATUS_CONFLICT
    };
    let conflict_summary = if merged.conflicts.is_empty() {
        None
    } else {
        Some(sqlx::types::Json(
            serde_json::to_value(
                merged
                    .conflicts
                    .iter()
                    .map(ConflictView::from)
                    .collect::<Vec<_>>(),
            )
            .unwrap_or(Value::Array(vec![])),
        ))
    };

    sqlx::query("DELETE FROM revision_files WHERE revision_id = $1")
        .bind(revision_id)
        .execute(&mut *tx)
        .await
        .map_err(AppError::from_db)?;
    sqlx::query("DELETE FROM revision_conflicts WHERE revision_id = $1")
        .bind(revision_id)
        .execute(&mut *tx)
        .await
        .map_err(AppError::from_db)?;

    sqlx::query(
        r#"
        UPDATE revisions
        SET status = $2, merged_against_revision_id = $3, token_added = $4,
            token_removed = $5, total_tokens = $6, file_count = $7,
            conflict_summary = $8, review_comment = NULL, reviewed_by = NULL,
            reviewed_at = NULL, updated_at = now()
        WHERE id = $1
        "#,
    )
    .bind(revision_id)
    .bind(status)
    .bind(active_id)
    .bind(merged.token_added as i32)
    .bind(merged.token_removed as i32)
    .bind(merged.total_tokens)
    .bind(merged.file_count)
    .bind(conflict_summary)
    .execute(&mut *tx)
    .await
    .map_err(AppError::from_db)?;

    insert_revision_files(&mut tx, revision_id, &merged.results, &active_map).await?;
    insert_revision_conflicts(&mut tx, revision_id, &merged.conflicts).await?;

    if let Some(inputs) = replacement_inputs {
        sqlx::query("DELETE FROM revision_inputs WHERE revision_id = $1")
            .bind(revision_id)
            .execute(&mut *tx)
            .await
            .map_err(AppError::from_db)?;
        for (path, blob_id, deleted) in inputs {
            sqlx::query(
                "INSERT INTO revision_inputs (revision_id, path, blob_id, deleted) VALUES ($1, $2, $3, $4)",
            )
            .bind(revision_id)
            .bind(path)
            .bind(blob_id)
            .bind(deleted)
            .execute(&mut *tx)
            .await
            .map_err(AppError::from_db)?;
        }
    }

    insert_audit(
        &mut tx,
        Some(project.id),
        Some(revision_id),
        actor,
        "rebase_revision",
        "ok",
        json!({
            "from_merged_against_revision_id": revision.merged_against_revision_id,
            "to_merged_against_revision_id": active_id,
            "status": status,
            "files": merged.results.len(),
            "conflicts": merged.conflicts.len(),
            "token_added": merged.token_added,
            "token_removed": merged.token_removed,
        }),
    )
    .await?;

    tx.commit().await.map_err(AppError::from_db)?;
    get_revision(&state.db, revision_id)
        .await?
        .ok_or_else(|| AppError::internal("revision vanished after rebase"))
}

type RevisionInputs = (
    HashMap<String, ContentBlob>,
    HashSet<String>,
    Option<Vec<(String, Option<Uuid>, bool)>>,
);

/// Load the original incoming side. Revisions created before revision_inputs
/// existed fall back to their stored changed files and are backfilled after a
/// successful rebase.
async fn load_revision_inputs(
    state: &AppState,
    tx: &mut Transaction<'_, Postgres>,
    revision_id: Uuid,
) -> Result<RevisionInputs, AppError> {
    #[derive(sqlx::FromRow)]
    struct InputRow {
        path: String,
        blob_id: Option<Uuid>,
        deleted: bool,
    }

    let stored: Vec<InputRow> =
        sqlx::query_as("SELECT path, blob_id, deleted FROM revision_inputs WHERE revision_id = $1")
            .bind(revision_id)
            .fetch_all(&mut **tx)
            .await
            .map_err(AppError::from_db)?;

    let used_fallback = stored.is_empty();
    let rows = if used_fallback {
        #[derive(sqlx::FromRow)]
        struct FileRow {
            path: String,
            blob_id: Uuid,
            change_type: String,
        }
        let files: Vec<FileRow> = sqlx::query_as(
            r#"
            SELECT path, blob_id, change_type FROM revision_files
            WHERE revision_id = $1 AND change_type <> 'unchanged'
            "#,
        )
        .bind(revision_id)
        .fetch_all(&mut **tx)
        .await
        .map_err(AppError::from_db)?;
        files
            .into_iter()
            .map(|file| InputRow {
                path: file.path,
                blob_id: if file.change_type == "deleted" {
                    None
                } else {
                    Some(file.blob_id)
                },
                deleted: file.change_type == "deleted",
            })
            .collect()
    } else {
        stored
    };

    let mut incoming = HashMap::new();
    let mut deletions = HashSet::new();
    for row in &rows {
        if row.deleted {
            deletions.insert(row.path.clone());
            continue;
        }
        let Some(blob_id) = row.blob_id else {
            continue;
        };
        let blob = blob_by_id(&state.db, blob_id)
            .await?
            .ok_or_else(|| AppError::internal(format!("missing blob {blob_id}")))?;
        incoming.insert(row.path.clone(), blob);
    }

    if incoming.is_empty() && deletions.is_empty() {
        return Err(AppError::conflict(
            "REVISION_NOT_REBASABLE",
            "revision has no recorded incoming changes to rebase",
        ));
    }

    let replacement_inputs = used_fallback.then(|| {
        rows.iter()
            .map(|row| (row.path.clone(), row.blob_id, row.deleted))
            .collect()
    });

    Ok((incoming, deletions, replacement_inputs))
}

async fn insert_revision_files(
    tx: &mut Transaction<'_, Postgres>,
    revision_id: Uuid,
    results: &[(String, Option<ContentBlob>, String)],
    active_map: &HashMap<String, ContentBlob>,
) -> Result<(), AppError> {
    for (path, result, change_type) in results {
        let Some(blob) = result else { continue };
        let previous_blob_id = active_map.get(path).map(|blob| blob.id);
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
        .execute(&mut **tx)
        .await
        .map_err(AppError::from_db)?;
    }
    Ok(())
}

async fn insert_revision_conflicts(
    tx: &mut Transaction<'_, Postgres>,
    revision_id: Uuid,
    conflicts: &[ConflictDetail],
) -> Result<(), AppError> {
    for detail in conflicts {
        let value = serde_json::to_value(detail).unwrap_or(Value::Null);
        sqlx::query(
            "INSERT INTO revision_conflicts (revision_id, path, detail) VALUES ($1, $2, $3)",
        )
        .bind(revision_id)
        .bind(&detail.path)
        .bind(sqlx::types::Json(value))
        .execute(&mut **tx)
        .await
        .map_err(AppError::from_db)?;
    }
    Ok(())
}
