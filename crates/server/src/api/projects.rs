use axum::Json;
use axum::extract::{Path, Query, State};
use serde::{Deserialize, Serialize};
use serde_json::{Value, json};
use uuid::Uuid;

use crate::AppState;

use super::common::{insert_web_audit, map_unique_violation};
use crate::auth::WebUser;
use crate::content::blob_by_id;
use crate::error::{AppError, Result};
use crate::paths::{normalize_path, validate_slug};
use crate::project::{
    Project, list_projects_for_user, load_project_by_slug, require_project_access,
};
use crate::revisions::get_revision;
use crate::workspace::{load_active_files, render_tree};

pub(super) async fn list_projects(
    user: WebUser,
    State(state): State<AppState>,
) -> Result<Json<Value>> {
    let projects = list_projects_for_user(&state.db, &user).await?;
    Ok(Json(json!({"projects": projects})))
}

#[derive(Debug, Deserialize)]
pub(super) struct CreateProjectInput {
    slug: String,
    name: String,
    #[serde(default)]
    description: String,
    #[serde(default)]
    token_budget: Option<i64>,
}

pub(super) async fn create_project(
    user: WebUser,
    State(state): State<AppState>,
    Json(input): Json<CreateProjectInput>,
) -> Result<Json<Value>> {
    if !user.is_admin() {
        return Err(AppError::forbidden(
            "FORBIDDEN",
            "project creation requires an admin user",
        ));
    }
    validate_slug(&input.slug).map_err(|e| AppError::bad_request("INVALID_PROJECT", e))?;
    if input.name.trim().is_empty() {
        return Err(AppError::bad_request(
            "INVALID_ARGUMENT",
            "name is required",
        ));
    }
    let budget = input.token_budget.unwrap_or(200_000);
    if budget <= 0 {
        return Err(AppError::bad_request(
            "INVALID_ARGUMENT",
            "token_budget must be positive",
        ));
    }
    let project_id: Uuid = sqlx::query_scalar(
        r#"
        INSERT INTO projects (slug, name, description, token_budget)
        VALUES ($1, $2, $3, $4)
        RETURNING id
        "#,
    )
    .bind(&input.slug)
    .bind(input.name.trim())
    .bind(input.description.trim())
    .bind(budget)
    .fetch_one(&state.db)
    .await
    .map_err(map_unique_violation("project slug already exists"))?;
    insert_web_audit(
        &state,
        Some(project_id),
        None,
        &user,
        "create_project",
        json!({"slug": input.slug}),
    )
    .await;
    Ok(Json(json!({
        "project": {
            "id": project_id,
            "slug": input.slug,
            "name": input.name,
            "description": input.description,
            "token_budget": budget,
            "active_revision_id": null,
        }
    })))
}

pub(super) async fn delete_project(
    user: WebUser,
    State(state): State<AppState>,
    Path(slug): Path<String>,
) -> Result<Json<Value>> {
    if !user.can_platform() {
        return Err(AppError::forbidden(
            "FORBIDDEN",
            "project deletion requires a superadmin",
        ));
    }
    let deleted: Option<(Uuid, String)> = sqlx::query_as(
        r#"
        UPDATE projects
        SET deleted_at = now(), updated_at = now()
        WHERE slug = $1 AND deleted_at IS NULL
        RETURNING id, slug
        "#,
    )
    .bind(&slug)
    .fetch_optional(&state.db)
    .await?;
    let (project_id, slug) =
        deleted.ok_or_else(|| AppError::not_found("PROJECT_NOT_FOUND", "project not found"))?;
    insert_web_audit(
        &state,
        Some(project_id),
        None,
        &user,
        "delete_project",
        json!({"slug": slug}),
    )
    .await;
    Ok(Json(json!({
        "deleted": true,
        "project": {"id": project_id, "slug": slug}
    })))
}

pub(super) async fn project_detail(
    user: WebUser,
    State(state): State<AppState>,
    Path(slug): Path<String>,
) -> Result<Json<Value>> {
    let project = project_for_user(&state, &user, &slug).await?;
    let active = if let Some(active_id) = project.active_revision_id {
        get_revision(&state.db, active_id).await?
    } else {
        None
    };
    Ok(Json(json!({"project": project, "active_revision": active})))
}

pub(super) async fn project_for_user(
    state: &AppState,
    user: &WebUser,
    slug: &str,
) -> Result<Project> {
    let project = load_project_by_slug(&state.db, slug)
        .await?
        .ok_or_else(|| AppError::not_found("PROJECT_NOT_FOUND", "project not found"))?;
    require_project_access(&state.db, user, project.id).await?;
    Ok(project)
}

#[derive(Debug, Serialize)]
pub(super) struct WorkspaceFileView {
    path: String,
    tokens: i32,
    size: i64,
    sha256: String,
    media_type: String,
    is_text: bool,
    description: String,
}

pub(super) async fn workspace(
    user: WebUser,
    State(state): State<AppState>,
    Path(slug): Path<String>,
) -> Result<Json<Value>> {
    let project = project_for_user(&state, &user, &slug).await?;
    let files = load_active_files(&state.db, &project).await?;
    let mut list: Vec<WorkspaceFileView> = files
        .values()
        .map(|file| WorkspaceFileView {
            path: file.path.clone(),
            tokens: file.token_count.unwrap_or(0),
            size: file.size_bytes,
            sha256: file.sha256.clone(),
            media_type: file.media_type.clone(),
            is_text: file.is_text,
            description: file.description.clone(),
        })
        .collect();
    list.sort_by(|a, b| a.path.cmp(&b.path));
    let summary = render_tree(&files, crate::workspace::KindFilter::All);
    Ok(Json(json!({
        "project": project,
        "revision_id": project.active_revision_id,
        "files": list,
        "tree": summary.tree,
        "tokens": summary.tokens,
    })))
}

#[derive(Debug, Deserialize)]
pub(super) struct FileQuery {
    path: String,
}

pub(super) async fn project_file(
    user: WebUser,
    State(state): State<AppState>,
    Path(slug): Path<String>,
    Query(query): Query<FileQuery>,
) -> Result<Json<Value>> {
    let project = project_for_user(&state, &user, &slug).await?;
    let path = normalize_path(&query.path).map_err(|e| AppError::bad_request("INVALID_PATH", e))?;
    let files = load_active_files(&state.db, &project).await?;
    let file = files
        .get(&path)
        .ok_or_else(|| AppError::not_found("NOT_FOUND", "file not found in active revision"))?;
    let blob = blob_by_id(&state.db, file.blob_id)
        .await
        .map_err(|e| AppError::internal(format!("load blob: {e}")))?
        .ok_or_else(|| AppError::not_found("NOT_FOUND", "file not found"))?;
    if blob.is_text {
        Ok(Json(json!({
            "path": path,
            "content": blob.text_content,
            "url": null,
            "sha256": blob.sha256,
            "size": blob.size_bytes,
            "media_type": blob.media_type,
            "is_text": true,
            "tokens": blob.token_count,
        })))
    } else {
        let key = blob
            .object_key
            .as_deref()
            .ok_or_else(|| AppError::internal("binary blob has no object key"))?;
        let ttl = state
            .config
            .oss
            .as_ref()
            .map(|o| o.presign_ttl)
            .unwrap_or(std::time::Duration::from_secs(600));
        let url = state
            .storage
            .presign_get(key, ttl)
            .await
            .map_err(|e| AppError::internal(format!("sign attachment: {e}")))?;
        Ok(Json(json!({
            "path": path,
            "content": null,
            "url": url,
            "sha256": blob.sha256,
            "size": blob.size_bytes,
            "media_type": blob.media_type,
            "is_text": false,
            "tokens": null,
        })))
    }
}
