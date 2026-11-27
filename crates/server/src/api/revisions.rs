use axum::Json;
use axum::extract::{Path, Query, State};
use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use serde_json::{Value, json};
use uuid::Uuid;

use crate::AppState;

use super::projects::project_for_user;
use crate::auth::WebUser;
use crate::error::{AppError, Result};
use crate::project::{Project, require_project_access};
use crate::revisions::{
    self, Actor, FileSide, Resolution, Revision, RevisionFileView, RevisionStatus, approve,
    get_revision, reject, revision_conflicts, revision_files, revision_is_stale,
};

#[derive(Debug, Serialize, sqlx::FromRow)]
pub(super) struct RevisionListRow {
    id: Uuid,
    project_slug: String,
    status: String,
    commit_message: String,
    token_added: i32,
    token_removed: i32,
    total_tokens: i64,
    file_count: i32,
    created_at: DateTime<Utc>,
    updated_at: DateTime<Utc>,
    author: String,
    reviewer: Option<String>,
    comment: Option<String>,
    stale: bool,
    conflict_count: i64,
}

#[derive(Debug, Deserialize)]
pub(super) struct RevisionListQuery {
    #[serde(default)]
    status: Option<String>,
}

pub(super) async fn project_revisions(
    user: WebUser,
    State(state): State<AppState>,
    Path(slug): Path<String>,
    Query(query): Query<RevisionListQuery>,
) -> Result<Json<Value>> {
    let project = project_for_user(&state, &user, &slug).await?;
    let statuses: Option<Vec<String>> = query.status.as_ref().map(|status| {
        status
            .split(',')
            .map(|s| s.trim().to_string())
            .filter(|s| !s.is_empty())
            .collect()
    });
    if let Some(statuses) = &statuses {
        for status in statuses {
            if RevisionStatus::parse(status).is_none() {
                return Err(AppError::bad_request(
                    "INVALID_ARGUMENT",
                    format!("unknown status {status}"),
                ));
            }
        }
    }
    let rows: Vec<RevisionListRow> = sqlx::query_as(
        r#"
        SELECT r.id, p.slug AS project_slug, r.status, r.commit_message,
               r.token_added, r.token_removed, r.total_tokens, r.file_count,
               r.created_at, r.updated_at,
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
        WHERE r.project_id = $1
          AND ($2::text[] IS NULL OR r.status = ANY($2))
        ORDER BY r.created_at DESC
        LIMIT 100
        "#,
    )
    .bind(project.id)
    .bind(statuses)
    .fetch_all(&state.db)
    .await?;
    Ok(Json(json!({"revisions": rows, "project": project})))
}

#[derive(Debug, Serialize)]
pub(super) struct RevisionDetail {
    revision: Revision,
    project: Project,
    stale: bool,
    files: Vec<RevisionFileView>,
    conflicts: Vec<revisions::ConflictDetail>,
    author: String,
    reviewer: Option<String>,
}

pub(super) async fn ensure_revision_access(
    state: &AppState,
    user: &WebUser,
    revision_id: Uuid,
) -> Result<(Project, Revision)> {
    let revision = get_revision(&state.db, revision_id)
        .await?
        .ok_or_else(|| AppError::not_found("REVISION_NOT_FOUND", "revision not found"))?;
    let project = crate::project::load_project_by_id(&state.db, revision.project_id)
        .await?
        .ok_or_else(|| AppError::not_found("PROJECT_NOT_FOUND", "project not found"))?;
    require_project_access(&state.db, user, project.id).await?;
    Ok((project, revision))
}

pub(super) async fn revision_detail(
    user: WebUser,
    State(state): State<AppState>,
    Path(id): Path<Uuid>,
) -> Result<Json<Value>> {
    let (project, revision) = ensure_revision_access(&state, &user, id).await?;
    let files = revision_files(&state.db, &project, &revision).await?;
    let conflicts = revision_conflicts(&state.db, revision.id).await?;
    let stale = revision_is_stale(&project, &revision);
    let author = author_label(&state, &revision).await;
    let reviewer = if let Some(reviewed_by) = revision.reviewed_by {
        sqlx::query_scalar::<_, String>("SELECT username FROM users WHERE id = $1")
            .bind(reviewed_by)
            .fetch_optional(&state.db)
            .await?
    } else {
        None
    };
    let detail = RevisionDetail {
        revision,
        project,
        stale,
        files,
        conflicts,
        author,
        reviewer,
    };
    Ok(Json(json!(detail)))
}

pub(super) async fn author_label(state: &AppState, revision: &Revision) -> String {
    if let Some(user_id) = revision.author_user_id
        && let Ok(Some(name)) =
            sqlx::query_scalar::<_, String>("SELECT username FROM users WHERE id = $1")
                .bind(user_id)
                .fetch_optional(&state.db)
                .await
    {
        return name;
    }
    if let Some(key_id) = revision.author_api_key_id
        && let Ok(Some(prefix)) =
            sqlx::query_scalar::<_, String>("SELECT key_prefix FROM api_keys WHERE id = $1")
                .bind(key_id)
                .fetch_optional(&state.db)
                .await
    {
        return format!("key:{prefix}");
    }
    "system".to_string()
}

#[derive(Debug, Deserialize)]
pub(super) struct RevisionFileQuery {
    path: String,
    #[serde(default = "default_side")]
    side: String,
}

pub(super) fn default_side() -> String {
    "incoming".to_string()
}

pub(super) async fn revision_file(
    user: WebUser,
    State(state): State<AppState>,
    Path(id): Path<Uuid>,
    Query(query): Query<RevisionFileQuery>,
) -> Result<Json<FileSide>> {
    let (project, revision) = ensure_revision_access(&state, &user, id).await?;
    let side = revisions::file_side(&state, &project, &revision, &query.path, &query.side).await?;
    Ok(Json(side))
}

#[derive(Debug, Deserialize)]
pub(super) struct ApproveInput {
    #[serde(default)]
    comment: Option<String>,
    #[serde(default)]
    activate_now: bool,
}

pub(super) async fn approve_revision(
    user: WebUser,
    State(state): State<AppState>,
    Path(id): Path<Uuid>,
    Json(input): Json<ApproveInput>,
) -> Result<Json<Value>> {
    if !user.is_admin() {
        return Err(AppError::forbidden(
            "FORBIDDEN",
            "human approval requires an admin user",
        ));
    }
    let (project, _) = ensure_revision_access(&state, &user, id).await?;
    let revision = approve(
        &state,
        &project,
        id,
        &user,
        input.comment.as_deref().unwrap_or(""),
        input.activate_now,
    )
    .await?;
    Ok(Json(json!({"revision": revision})))
}

#[derive(Debug, Deserialize)]
pub(super) struct RejectInput {
    #[serde(default)]
    comment: Option<String>,
}

pub(super) async fn reject_revision(
    user: WebUser,
    State(state): State<AppState>,
    Path(id): Path<Uuid>,
    Json(input): Json<RejectInput>,
) -> Result<Json<Value>> {
    if !user.is_admin() {
        return Err(AppError::forbidden(
            "FORBIDDEN",
            "human rejection requires an admin user",
        ));
    }
    let (project, _) = ensure_revision_access(&state, &user, id).await?;
    let revision = reject(
        &state,
        &project,
        id,
        &user,
        input.comment.as_deref().unwrap_or(""),
    )
    .await?;
    Ok(Json(json!({"revision": revision})))
}

#[derive(Debug, Deserialize)]
pub(super) struct ResolutionInput {
    path: String,
    #[serde(default)]
    content: Option<String>,
    #[serde(default)]
    oss_key: Option<String>,
}

#[derive(Debug, Deserialize)]
pub(super) struct ResolveInput {
    resolutions: Vec<ResolutionInput>,
    #[serde(default)]
    commit_message: Option<String>,
}

pub(super) async fn resolve_revision(
    user: WebUser,
    State(state): State<AppState>,
    Path(id): Path<Uuid>,
    Json(input): Json<ResolveInput>,
) -> Result<Json<Value>> {
    if !user.is_admin() {
        return Err(AppError::forbidden(
            "FORBIDDEN",
            "conflict resolution requires an admin user",
        ));
    }
    let (project, existing) = ensure_revision_access(&state, &user, id).await?;
    let commit_message = input
        .commit_message
        .filter(|m| !m.trim().is_empty())
        .unwrap_or(existing.commit_message);
    let resolutions: Vec<Resolution> = input
        .resolutions
        .into_iter()
        .map(|r| Resolution {
            path: r.path,
            content: r.content,
            oss_key: r.oss_key,
        })
        .collect();
    let actor = Actor::from_web(&user);
    let revision =
        revisions::resolve_conflict(&state, &project, id, &actor, resolutions, &commit_message)
            .await?;
    Ok(Json(json!({"revision": revision})))
}
