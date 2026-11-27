use std::collections::{HashMap, HashSet};

use crate::AppState;
use crate::content::{ContentBlob, ingest_bytes};
use crate::error::AppError;

use super::model::*;

pub(super) struct MergeOutput {
    pub results: Vec<(String, Option<ContentBlob>, String)>,
    pub conflicts: Vec<ConflictDetail>,
    pub token_added: i64,
    pub token_removed: i64,
    pub total_tokens: i64,
    pub file_count: i32,
}

/// Three-way merge of the proposal's incoming side against the current active
/// snapshot, using the original base as the common ancestor.
pub(super) async fn merge_snapshots(
    state: &AppState,
    base_map: &HashMap<String, ContentBlob>,
    active_map: &HashMap<String, ContentBlob>,
    incoming: &HashMap<String, ContentBlob>,
    deletions: &HashSet<String>,
) -> Result<MergeOutput, AppError> {
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

    Ok(MergeOutput {
        results,
        conflicts,
        token_added,
        token_removed,
        total_tokens,
        file_count,
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
