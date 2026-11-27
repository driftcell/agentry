use serde_json::Value;
use uuid::Uuid;

use crate::AppState;
use crate::auth::WebUser;
use crate::error::{AppError, Result};

pub(super) fn validate_scopes(scopes: &[String]) -> Result<()> {
    let allowed = ["mcp:read", "admin:propose", "admin:activate", "admin:platform"];
    if scopes.is_empty() {
        return Err(AppError::bad_request("INVALID_ARGUMENT", "scopes must not be empty"));
    }
    for scope in scopes {
        if !allowed.contains(&scope.as_str()) {
            return Err(AppError::bad_request(
                "INVALID_ARGUMENT",
                format!("unknown scope {scope}"),
            ));
        }
    }
    Ok(())
}

pub(super) fn map_unique_violation(message: &'static str) -> impl FnOnce(sqlx::Error) -> AppError {
    move |error| {
        if let sqlx::Error::Database(db) = &error {
            if db.code().as_deref() == Some("23505") {
                return AppError::conflict("CONFLICT", message);
            }
        }
        AppError::from_db(error)
    }
}

pub(super) async fn insert_web_audit(
    state: &AppState,
    project_id: Option<Uuid>,
    revision_id: Option<Uuid>,
    user: &WebUser,
    action: &str,
    detail: Value,
) {
    let _ = sqlx::query(
        r#"
        INSERT INTO audit_events
            (project_id, revision_id, actor_user_id, actor_label, action, result, detail)
        VALUES ($1, $2, $3, $4, $5, 'ok', $6)
        "#,
    )
    .bind(project_id)
    .bind(revision_id)
    .bind(user.id)
    .bind(user.label())
    .bind(action)
    .bind(sqlx::types::Json(detail))
    .execute(&state.db)
    .await;
}
