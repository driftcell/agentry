use axum::Json;
use axum::extract::{Query, State};
use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use serde_json::{Value, json};
use uuid::Uuid;

use crate::AppState;
use crate::auth::WebUser;
use crate::error::{AppError, Result};
use crate::project::list_projects_for_user;
use crate::stats;

#[derive(Debug, Serialize, sqlx::FromRow)]
pub(super) struct RecentRow {
    id: Uuid,
    project_slug: String,
    project_name: String,
    status: String,
    commit_message: String,
    token_added: i32,
    token_removed: i32,
    total_tokens: i64,
    created_at: DateTime<Utc>,
    author: String,
    reviewer: Option<String>,
    comment: Option<String>,
    stale: bool,
    conflict_count: i64,
}

#[derive(Debug, Deserialize)]
pub(super) struct DashboardQuery {
    #[serde(default)]
    project: Option<String>,
}

#[derive(Debug, Serialize, sqlx::FromRow)]
pub(super) struct CountRow {
    count: i64,
}

pub(super) async fn dashboard(
    user: WebUser,
    State(state): State<AppState>,
    Query(query): Query<DashboardQuery>,
) -> Result<Json<Value>> {
    let projects = list_projects_for_user(&state.db, &user).await?;
    let selected = if let Some(slug) = &query.project {
        let project = projects
            .iter()
            .find(|p| &p.slug == slug)
            .cloned()
            .ok_or_else(|| AppError::not_found("PROJECT_NOT_FOUND", "project not found"))?;
        Some(project)
    } else {
        None
    };
    let ids: Vec<Uuid> = selected
        .as_ref()
        .map(|p| vec![p.id])
        .unwrap_or_else(|| projects.iter().map(|p| p.id).collect());
    let id_filter = Some(ids.as_slice());

    let skills: CountRow = sqlx::query_as(
        r#"
        SELECT count(*) AS count
        FROM revision_files rf
        JOIN projects p ON p.active_revision_id = rf.revision_id
        WHERE p.id = ANY($1)
          AND rf.change_type <> 'deleted'
          AND rf.path LIKE 'skills/%/SKILL.md'
        "#,
    )
    .bind(&ids)
    .fetch_one(&state.db)
    .await?;

    let used: CountRow = sqlx::query_as(
        r#"
        SELECT COALESCE(sum(r.total_tokens), 0)::bigint AS count
        FROM projects p
        JOIN revisions r ON r.id = p.active_revision_id
        WHERE p.id = ANY($1)
        "#,
    )
    .bind(&ids)
    .fetch_one(&state.db)
    .await?;

    let pending: CountRow = sqlx::query_as(
        r#"
        SELECT count(*) AS count FROM revisions
        WHERE project_id = ANY($1) AND status IN ('pending_review', 'conflict')
        "#,
    )
    .bind(&ids)
    .fetch_one(&state.db)
    .await?;

    let budget: CountRow = sqlx::query_as(
        "SELECT COALESCE(sum(token_budget), 0)::bigint AS count FROM projects WHERE id = ANY($1)",
    )
    .bind(&ids)
    .fetch_one(&state.db)
    .await?;

    let recent: Vec<RecentRow> = sqlx::query_as(
        r#"
        SELECT r.id, p.slug AS project_slug, p.name AS project_name, r.status,
               r.commit_message, r.token_added, r.token_removed, r.total_tokens,
               r.created_at,
               COALESCE(u.username, CASE WHEN k.key_prefix IS NOT NULL THEN 'key:' || k.key_prefix END, 'system') AS author,
               rv.username AS reviewer,
               r.review_comment AS comment,
               (r.status <> 'active' AND r.merged_against_revision_id IS DISTINCT FROM p.active_revision_id) AS stale,
               (SELECT count(*) FROM revision_conflicts c WHERE c.revision_id = r.id) AS conflict_count
        FROM revisions r
        JOIN projects p ON p.id = r.project_id
        LEFT JOIN users u ON u.id = r.author_user_id
        LEFT JOIN api_keys k ON k.id = r.author_api_key_id
        LEFT JOIN users rv ON rv.id = r.reviewed_by
        WHERE p.id = ANY($1)
        ORDER BY r.created_at DESC
        LIMIT 12
        "#,
    )
    .bind(&ids)
    .fetch_all(&state.db)
    .await?;

    let endpoint_stats = stats::endpoint_stats(&state.db, id_filter).await?;
    let method_stats = stats::method_stats(&state.db, id_filter, 12).await?;
    let key_stats = stats::key_stats(&state.db, id_filter).await?;

    Ok(Json(json!({
        "scope": selected.as_ref().map(|p| p.slug.clone()),
        "metrics": {
            "projects": if selected.is_some() { 1 } else { projects.len() },
            "active_skills": skills.count,
            "tokens_used": used.count,
            "token_budget": budget.count,
            "pending_reviews": pending.count,
        },
        "recent": recent,
        "stats": {
            "endpoints": endpoint_stats,
            "methods": method_stats,
            "keys": key_stats,
        },
        "projects": projects,
    })))
}
