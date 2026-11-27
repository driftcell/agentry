use axum::Json;
use axum::extract::{Path, State};
use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use serde_json::{Value, json};
use uuid::Uuid;

use crate::AppState;

use super::common::{insert_web_audit, validate_scopes};
use super::projects::project_for_user;
use crate::auth::{WebUser, issue_api_key};
use crate::error::{AppError, Result};
use crate::project::require_project_access;

#[derive(Debug, Serialize, sqlx::FromRow)]
pub(super) struct ApiKeyRow {
    id: Uuid,
    name: String,
    key_prefix: String,
    default_project_id: Option<Uuid>,
    project_slug: Option<String>,
    is_global: bool,
    scopes: Vec<String>,
    revoked_at: Option<DateTime<Utc>>,
    expires_at: Option<DateTime<Utc>>,
    last_used_at: Option<DateTime<Utc>>,
    created_at: DateTime<Utc>,
    username: String,
}

pub(super) async fn list_keys(
    user: WebUser,
    State(state): State<AppState>,
    Path(slug): Path<String>,
) -> Result<Json<Value>> {
    if !user.is_admin() {
        return Err(AppError::forbidden(
            "FORBIDDEN",
            "API key management requires an admin user",
        ));
    }
    let project = project_for_user(&state, &user, &slug).await?;
    let keys: Vec<ApiKeyRow> = sqlx::query_as(
        r#"
        SELECT k.id, k.name, k.key_prefix, k.default_project_id,
               p.slug AS project_slug, k.is_global, k.scopes, k.revoked_at,
               k.expires_at, k.last_used_at, k.created_at, u.username
        FROM api_keys k
        JOIN users u ON u.id = k.user_id
        LEFT JOIN projects p ON p.id = k.default_project_id
        WHERE k.default_project_id = $1
        ORDER BY k.created_at DESC
        "#,
    )
    .bind(project.id)
    .fetch_all(&state.db)
    .await?;
    Ok(Json(json!({"keys": keys, "project": project})))
}

#[derive(Debug, Deserialize)]
pub(super) struct IssueKeyInput {
    name: String,
    scopes: Vec<String>,
    #[serde(default)]
    user_id: Option<Uuid>,
    #[serde(default)]
    is_global: bool,
}

pub(super) async fn issue_key(
    user: WebUser,
    State(state): State<AppState>,
    Path(slug): Path<String>,
    Json(input): Json<IssueKeyInput>,
) -> Result<Json<Value>> {
    if !user.is_admin() {
        return Err(AppError::forbidden(
            "FORBIDDEN",
            "API key management requires an admin user",
        ));
    }
    let project = project_for_user(&state, &user, &slug).await?;
    validate_scopes(&input.scopes)?;
    if (input.is_global || input.scopes.iter().any(|s| s == "admin:platform"))
        && !user.can_platform()
    {
        return Err(AppError::forbidden(
            "FORBIDDEN",
            "only a superadmin may issue global or platform-scoped keys",
        ));
    }
    let target_user = input.user_id.unwrap_or(user.id);
    let exists: Option<i32> = sqlx::query_scalar("SELECT 1 FROM users WHERE id = $1")
        .bind(target_user)
        .fetch_optional(&state.db)
        .await?;
    if exists.is_none() {
        return Err(AppError::bad_request(
            "INVALID_ARGUMENT",
            "target user does not exist",
        ));
    }
    if target_user != user.id && !user.can_platform() {
        return Err(AppError::forbidden(
            "FORBIDDEN",
            "only a superadmin may issue keys for another user",
        ));
    }
    let (id, plaintext) = issue_api_key(
        &state.db,
        target_user,
        if input.is_global {
            None
        } else {
            Some(project.id)
        },
        input.name.trim(),
        &input.scopes,
        input.is_global,
    )
    .await?;
    insert_web_audit(
        &state,
        Some(project.id),
        None,
        &user,
        "issue_api_key",
        json!({"api_key_id": id, "scopes": input.scopes, "global": input.is_global}),
    )
    .await;
    Ok(Json(json!({
        "api_key_id": id,
        "api_key": plaintext,
        "name": input.name,
        "project": if input.is_global { Value::Null } else { json!(project.slug) },
        "scopes": input.scopes,
        "is_global": input.is_global,
        "warning": "this plaintext key is shown once; it cannot be retrieved again",
    })))
}

pub(super) async fn revoke_key(
    user: WebUser,
    State(state): State<AppState>,
    Path(id): Path<Uuid>,
) -> Result<Json<Value>> {
    if !user.is_admin() {
        return Err(AppError::forbidden(
            "FORBIDDEN",
            "API key management requires an admin user",
        ));
    }
    let row: Option<(Option<Uuid>, bool)> =
        sqlx::query_as("SELECT default_project_id, is_global FROM api_keys WHERE id = $1")
            .bind(id)
            .fetch_optional(&state.db)
            .await?;
    let (default_project, is_global) =
        row.ok_or_else(|| AppError::not_found("NOT_FOUND", "API key not found"))?;
    if let Some(project_id) = default_project {
        require_project_access(&state.db, &user, project_id).await?;
    }
    if (is_global || default_project.is_none()) && !user.can_platform() {
        return Err(AppError::forbidden(
            "FORBIDDEN",
            "only a superadmin may revoke a global key",
        ));
    }
    sqlx::query("UPDATE api_keys SET revoked_at = now() WHERE id = $1")
        .bind(id)
        .execute(&state.db)
        .await?;
    insert_web_audit(
        &state,
        default_project,
        None,
        &user,
        "revoke_api_key",
        json!({"api_key_id": id}),
    )
    .await;
    Ok(Json(json!({"api_key_id": id, "revoked": true})))
}

pub(super) async fn list_all_keys(
    user: WebUser,
    State(state): State<AppState>,
) -> Result<Json<Value>> {
    if !user.can_platform() {
        return Err(AppError::forbidden(
            "FORBIDDEN",
            "listing all API keys requires a superadmin",
        ));
    }
    let keys: Vec<ApiKeyRow> = sqlx::query_as(
        r#"
        SELECT k.id, k.name, k.key_prefix, k.default_project_id,
               p.slug AS project_slug, k.is_global, k.scopes, k.revoked_at,
               k.expires_at, k.last_used_at, k.created_at, u.username
        FROM api_keys k
        JOIN users u ON u.id = k.user_id
        LEFT JOIN projects p ON p.id = k.default_project_id
        ORDER BY k.is_global DESC, k.created_at DESC
        "#,
    )
    .fetch_all(&state.db)
    .await?;
    Ok(Json(json!({"keys": keys})))
}
