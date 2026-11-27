use serde_json::Value;
use sqlx::{Postgres, Transaction};
use uuid::Uuid;

use crate::error::AppError;

use super::model::Actor;
pub(super) async fn insert_audit(
    tx: &mut Transaction<'_, Postgres>,
    project_id: Option<Uuid>,
    revision_id: Option<Uuid>,
    actor: &Actor,
    action: &str,
    result: &str,
    detail: Value,
) -> Result<(), AppError> {
    sqlx::query(
        r#"
        INSERT INTO audit_events
            (project_id, revision_id, actor_user_id, actor_api_key_id, actor_label, action, result, detail)
        VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
        "#,
    )
    .bind(project_id)
    .bind(revision_id)
    .bind(actor.user_id)
    .bind(actor.api_key_id)
    .bind(&actor.label)
    .bind(action)
    .bind(result)
    .bind(sqlx::types::Json(detail))
    .execute(&mut **tx)
    .await
    .map_err(AppError::from_db)?;
    Ok(())
}
