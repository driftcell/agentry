use std::collections::{HashMap, HashSet};

use serde_json::{Value, json};
use uuid::Uuid;

use crate::AppState;
use crate::content::{ContentBlob, ingest_bytes};
use crate::error::AppError;
use crate::paths::{normalize_path, normalize_path_set};
use crate::project::Project;

use super::audit::insert_audit;
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
    let (base_map, base_id) = if let Some(base_id) = base_revision_id {
        let base = get_revision_for_project(&state.db, project.id, base_id)
            .await?
            .ok_or_else(|| {
                AppError::bad_request(
                    "INVALID_BASE",
                    "base revision does not belong to this project",
                )
            })?;
        (load_snapshot(&state.db, base.id).await?, Some(base.id))
    } else if let Some(active_id) = active_revision_id {
        (load_snapshot(&state.db, active_id).await?, Some(active_id))
    } else {
        (HashMap::new(), None)
    };

    let active_map = if let Some(active_id) = active_revision_id {
        load_snapshot(&state.db, active_id).await?
    } else {
        HashMap::new()
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

    let mut all_paths: Vec<String> = base_map
        .keys()
        .chain(active_map.keys())
        .chain(incoming.keys())
        .chain(deletions.iter())
        .cloned()
        .collect();
    all_paths.sort();
    all_paths.dedup();

    let mut results: Vec<(String, Option<ContentBlob>, String)> = Vec::new();
    let mut conflicts: Vec<ConflictDetail> = Vec::new();

    for path in all_paths {
        let base = base_map.get(&path);
        let active = active_map.get(&path);
        let explicit_incoming = incoming.get(&path);
        let explicitly_deleted = deletions.contains(&path);
        let inherited = explicit_incoming.is_none() && !explicitly_deleted;

        if inherited {
            if let Some(active) = active {
                results.push((path, Some(active.clone()), "unchanged".into()));
            }
            continue;
        }

        let incoming_blob = explicit_incoming.cloned();
        let base_sha = sha_of(base);
        let active_sha = sha_of(active);
        let incoming_sha = sha_of(incoming_blob.as_ref());

        match (base, active, incoming_blob.as_ref()) {
            (_, Some(active), Some(incoming)) if active.sha256 == incoming.sha256 => {
                results.push((path, Some(active.clone()), "unchanged".into()));
            }
            (Some(base), Some(active), Some(_)) if base.sha256 == active.sha256 => {
                results.push((path, incoming_blob, "modified".into()));
            }
            (Some(base), Some(active), Some(incoming)) if base.sha256 == incoming.sha256 => {
                results.push((path, Some(active.clone()), "unchanged".into()));
            }
            (_, Some(active), Some(incoming)) => {
                match merge_text(state, base, active, incoming).await {
                    Ok(merged) => {
                        let change_type = if merged.sha256 == active.sha256 {
                            "unchanged"
                        } else {
                            "modified"
                        };
                        results.push((path, Some(merged), change_type.into()));
                    }
                    Err(boxed) => {
                        let (marked, mut detail) = *boxed;
                        detail.path = path.clone();
                        detail.base_sha256 = base_sha;
                        detail.active_sha256 = active_sha;
                        detail.incoming_sha256 = incoming_sha;
                        detail.merged_sha256 = Some(marked.sha256.clone());
                        conflicts.push(detail);
                        results.push((path, Some(marked), "modified".into()));
                    }
                }
            }
            (Some(base), Some(active), None) => {
                if base.sha256 == active.sha256 {
                    results.push((path, Some(active.clone()), "deleted".into()));
                } else if is_text(base) && is_text(active) {
                    let detail = ConflictDetail {
                        path: path.clone(),
                        hunks: 1,
                        lines: vec![1],
                        base_sha256: base_sha.clone(),
                        active_sha256: active_sha.clone(),
                        incoming_sha256: None,
                        merged_sha256: Some(active.sha256.clone()),
                        preview: Some(
                            "active content changed while incoming deleted the file".into(),
                        ),
                    };
                    conflicts.push(detail);
                    results.push((path, Some(active.clone()), "unchanged".into()));
                } else {
                    let detail = ConflictDetail {
                        path: path.clone(),
                        hunks: 1,
                        lines: vec![1],
                        base_sha256: base_sha.clone(),
                        active_sha256: active_sha.clone(),
                        incoming_sha256: None,
                        merged_sha256: Some(active.sha256.clone()),
                        preview: Some("binary file deleted while active content changed".into()),
                    };
                    conflicts.push(detail);
                    results.push((path, Some(active.clone()), "unchanged".into()));
                }
            }
            (Some(base), None, Some(incoming)) => {
                if base.sha256 == incoming.sha256 {
                    // Active already deleted it and incoming did not change it.
                    continue;
                }
                let detail = ConflictDetail {
                    path: path.clone(),
                    hunks: 1,
                    lines: vec![1],
                    base_sha256: base_sha.clone(),
                    active_sha256: None,
                    incoming_sha256: incoming_sha.clone(),
                    merged_sha256: Some(incoming.sha256.clone()),
                    preview: Some("active deleted the file while incoming changed it".into()),
                };
                conflicts.push(detail);
                results.push((path, Some(incoming.clone()), "modified".into()));
            }
            (Some(_), None, None) => {
                // Both sides deleted the file.
            }
            (None, None, Some(incoming)) => {
                results.push((path, Some(incoming.clone()), "added".into()));
            }
            (None, Some(active), None) => {
                let detail = ConflictDetail {
                    path: path.clone(),
                    hunks: 1,
                    lines: vec![1],
                    base_sha256: None,
                    active_sha256: active_sha.clone(),
                    incoming_sha256: None,
                    merged_sha256: Some(active.sha256.clone()),
                    preview: Some("incoming deleted a file that active added".into()),
                };
                conflicts.push(detail);
                results.push((path, Some(active.clone()), "unchanged".into()));
            }
            (None, None, None) => {}
        }
    }

    let mut token_added = 0i64;
    let mut token_removed = 0i64;
    let mut total_tokens = 0i64;
    let mut file_count = 0i32;
    for (path, result, change_type) in &results {
        let active_tokens = tokens_of(active_map.get(path));
        let result_tokens = tokens_of(result.as_ref());
        let delta = if change_type == "deleted" {
            -active_tokens
        } else {
            result_tokens - active_tokens
        };
        if delta > 0 {
            token_added += i64::from(delta);
        } else {
            token_removed += i64::from(-delta);
        }
        if *change_type != "deleted" {
            total_tokens += i64::from(result_tokens);
            file_count += 1;
        }
    }

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
    let revision_id: Uuid = sqlx::query_scalar(
        r#"
        INSERT INTO revisions
            (project_id, base_revision_id, merged_against_revision_id, status,
             commit_message, author_user_id, author_api_key_id, token_added,
             token_removed, total_tokens, file_count, conflict_summary)
        VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)
        RETURNING id
        "#,
    )
    .bind(project.id)
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
    .bind(conflict_summary)
    .fetch_one(&mut *tx)
    .await
    .map_err(AppError::from_db)?;

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

async fn merge_text(
    state: &AppState,
    base: Option<&ContentBlob>,
    active: &ContentBlob,
    incoming: &ContentBlob,
) -> Result<ContentBlob, Box<(ContentBlob, ConflictDetail)>> {
    let conflict = |preview: String| ConflictDetail {
        path: String::new(),
        hunks: 1,
        lines: vec![1],
        base_sha256: sha_of(base),
        active_sha256: Some(active.sha256.clone()),
        incoming_sha256: Some(incoming.sha256.clone()),
        merged_sha256: Some(incoming.sha256.clone()),
        preview: Some(preview),
    };
    if !active.is_text || !incoming.is_text {
        return Err(Box::new((
            incoming.clone(),
            conflict("binary files cannot be merged; choose one side".into()),
        )));
    }
    let Some(active_text) = active.text_content.as_deref() else {
        return Err(Box::new((
            incoming.clone(),
            conflict("active text is unavailable".into()),
        )));
    };
    let Some(incoming_text) = incoming.text_content.as_deref() else {
        return Err(Box::new((
            incoming.clone(),
            conflict("incoming text is unavailable".into()),
        )));
    };
    let base_text = base.and_then(|b| b.text_content.as_deref()).unwrap_or("");

    match diffy::merge(base_text, active_text, incoming_text) {
        Ok(merged) => {
            if merged == active_text {
                return Ok(active.clone());
            }
            let blob = ingest_bytes(
                &state.db,
                &state.storage,
                "merge.md",
                Some(active.media_type.as_str()),
                merged.as_bytes(),
            )
            .await
            .map_err(|e| {
                let detail = conflict(format!("merge ingest failed: {e}"));
                Box::new((incoming.clone(), detail))
            })?;
            Ok(blob)
        }
        Err(marked) => {
            let merged_blob = ingest_bytes(
                &state.db,
                &state.storage,
                "conflict.md",
                Some(active.media_type.as_str()),
                marked.as_bytes(),
            )
            .await
            .unwrap_or_else(|_| incoming.clone());
            let conflict_lines: Vec<usize> = marked
                .lines()
                .enumerate()
                .filter(|(_, line)| line.starts_with("<<<<<<<"))
                .map(|(index, _)| index + 1)
                .collect();
            let detail = ConflictDetail {
                path: String::new(),
                hunks: conflict_lines.len().max(1),
                lines: if conflict_lines.is_empty() {
                    vec![1]
                } else {
                    conflict_lines
                },
                base_sha256: sha_of(base),
                active_sha256: Some(active.sha256.clone()),
                incoming_sha256: Some(incoming.sha256.clone()),
                merged_sha256: Some(merged_blob.sha256.clone()),
                preview: Some(
                    marked
                        .lines()
                        .find(|line| line.starts_with("<<<<<<<"))
                        .unwrap_or("overlapping edits")
                        .chars()
                        .take(200)
                        .collect(),
                ),
            };
            Err(Box::new((merged_blob, detail)))
        }
    }
}
