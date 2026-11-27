use serde_json::json;
use sqlx::{Postgres, Transaction};
use uuid::Uuid;

use crate::AppState;
use crate::error::AppError;

use super::audit::insert_audit;
use super::model::*;
use super::store::{get_revision, load_revision_for_update};
pub async fn activate_revision(
    state: &AppState,
    project_id: Uuid,
    revision_id: Uuid,
    actor: Option<&Actor>,
) -> Result<Revision, AppError> {
    let mut tx = state.db.begin().await.map_err(AppError::from_db)?;
    activate_in_tx(&mut tx, project_id, revision_id, actor).await?;
    tx.commit().await.map_err(AppError::from_db)?;
    get_revision(&state.db, revision_id)
        .await?
        .ok_or_else(|| AppError::internal("revision vanished after activation"))
}

pub(super) async fn activate_in_tx(
    tx: &mut Transaction<'_, Postgres>,
    project_id: Uuid,
    revision_id: Uuid,
    actor: Option<&Actor>,
) -> Result<(), AppError> {
    let project: Option<(Uuid, Option<Uuid>)> =
        sqlx::query_as("SELECT id, active_revision_id FROM projects WHERE id = $1 FOR UPDATE")
            .bind(project_id)
            .fetch_optional(&mut **tx)
            .await
            .map_err(AppError::from_db)?;
    let (_, active_id) =
        project.ok_or_else(|| AppError::not_found("PROJECT_NOT_FOUND", "project not found"))?;

    let revision = load_revision_for_update(tx, revision_id).await?;
    if revision.project_id != project_id {
        return Err(AppError::not_found(
            "REVISION_NOT_FOUND",
            "revision not found",
        ));
    }
    if revision.status != STATUS_APPROVED {
        return Err(AppError::conflict(
            "REVISION_STATE",
            format!(
                "revision is {}; only an approved revision can be activated",
                revision.status
            ),
        ));
    }
    if revision.merged_against_revision_id != active_id {
        return Err(AppError::conflict(
            "REVISION_STALE",
            "the project active revision changed after this revision was merged; re-propose or resolve it against the current active revision",
        ));
    }
    if active_id == Some(revision_id) {
        return Err(AppError::conflict(
            "REVISION_STATE",
            "revision is already active",
        ));
    }

    if let Some(old_active) = active_id {
        sqlx::query("UPDATE revisions SET status = $2 WHERE id = $1 AND status = $3")
            .bind(old_active)
            .bind(STATUS_SUPERSEDED)
            .bind(STATUS_ACTIVE)
            .execute(&mut **tx)
            .await
            .map_err(AppError::from_db)?;
    }
    sqlx::query("UPDATE projects SET active_revision_id = $1 WHERE id = $2")
        .bind(revision_id)
        .bind(project_id)
        .execute(&mut **tx)
        .await
        .map_err(AppError::from_db)?;
    sqlx::query("UPDATE revisions SET status = $2, activated_at = now() WHERE id = $1")
        .bind(revision_id)
        .bind(STATUS_ACTIVE)
        .execute(&mut **tx)
        .await
        .map_err(AppError::from_db)?;

    if let Some(actor) = actor {
        insert_audit(
            tx,
            Some(project_id),
            Some(revision_id),
            actor,
            "activate_revision",
            "ok",
            json!({"previous_active": active_id}),
        )
        .await?;
    }
    Ok(())
}
