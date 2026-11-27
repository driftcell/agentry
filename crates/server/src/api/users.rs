use axum::Json;
use axum::extract::State;
use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use serde_json::{Value, json};
use uuid::Uuid;

use crate::AppState;

use super::common::{insert_web_audit, map_unique_violation};
use crate::auth::WebUser;
use crate::error::{AppError, Result};
use crate::seed::hash_password;

#[derive(Debug, Serialize, sqlx::FromRow)]
pub(super) struct UserRow {
    id: Uuid,
    username: String,
    display_name: String,
    role: String,
    created_at: DateTime<Utc>,
    key_count: i64,
}

#[derive(Debug, Deserialize)]
pub(super) struct CreateUserInput {
    username: String,
    #[serde(default)]
    display_name: String,
    password: String,
    #[serde(default)]
    role: Option<String>,
}

pub(super) async fn list_users(user: WebUser, State(state): State<AppState>) -> Result<Json<Value>> {
    if !user.can_platform() {
        return Err(AppError::forbidden("FORBIDDEN", "user management requires a superadmin"));
    }
    let users: Vec<UserRow> = sqlx::query_as(
        r#"
        SELECT u.id, u.username, u.display_name, u.role, u.created_at,
               (SELECT count(*) FROM api_keys k WHERE k.user_id = u.id AND k.revoked_at IS NULL) AS key_count
        FROM users u ORDER BY u.username
        "#,
    )
    .fetch_all(&state.db)
    .await?;
    Ok(Json(json!({"users": users})))
}

pub(super) async fn create_user(
    user: WebUser,
    State(state): State<AppState>,
    Json(input): Json<CreateUserInput>,
) -> Result<Json<Value>> {
    if !user.can_platform() {
        return Err(AppError::forbidden("FORBIDDEN", "user management requires a superadmin"));
    }
    let username = input.username.trim();
    if !(3..=64).contains(&username.len())
        || !username
            .chars()
            .all(|c| c.is_ascii_alphanumeric() || matches!(c, '.' | '_' | '-'))
    {
        return Err(AppError::bad_request(
            "INVALID_ARGUMENT",
            "username must be 3-64 letters, digits, dots, underscores or dashes",
        ));
    }
    if input.password.len() < 8 {
        return Err(AppError::bad_request(
            "INVALID_ARGUMENT",
            "new user passwords must be at least 8 characters",
        ));
    }
    let role = input.role.unwrap_or_else(|| "member".into());
    if !matches!(role.as_str(), "superadmin" | "admin" | "member") {
        return Err(AppError::bad_request("INVALID_ARGUMENT", "unknown role"));
    }
    let hash = hash_password(&input.password)?;
    let id: Uuid = sqlx::query_scalar(
        r#"
        INSERT INTO users (username, display_name, password_hash, role)
        VALUES ($1, $2, $3, $4)
        RETURNING id
        "#,
    )
    .bind(username)
    .bind(input.display_name.trim())
    .bind(hash)
    .bind(&role)
    .fetch_one(&state.db)
    .await
    .map_err(map_unique_violation("username already exists"))?;
    insert_web_audit(&state, None, None, &user, "create_user", json!({"user_id": id, "role": role})).await;
    Ok(Json(json!({
        "user": {"id": id, "username": username, "display_name": input.display_name, "role": role}
    })))
}

