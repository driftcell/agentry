use chrono::{DateTime, Utc};
use serde::Serialize;
use serde_json::json;
use sqlx::PgPool;
use uuid::Uuid;

use crate::AppState;
use crate::auth::WebUser;
use crate::error::AppError;
use crate::project::Project;

use super::activate::activate_in_tx;
use super::audit::insert_audit;
use super::model::*;
use super::store::{
    get_revision, load_revision_for_update, lock_project_active, revision_conflicts,
};

/// Compact review status used by both the admin MCP and the Web API.
#[derive(Debug, Clone, Serialize)]
pub struct ReviewStatus {
    pub revision_id: Uuid,
    pub project_slug: String,
    pub status: String,
    pub commit_message: String,
    pub comment: Option<String>,
    pub reviewer: Option<String>,
    pub token_added: i32,
    pub token_removed: i32,
    pub total_tokens: i64,
    pub stale: bool,
    pub conflict_count: usize,
    pub conflicts: Vec<ConflictView>,
    pub created_at: DateTime<Utc>,
    pub updated_at: DateTime<Utc>,
}

pub async fn review_status(
    db: &PgPool,
    project: &Project,
    revision: &Revision,
) -> Result<ReviewStatus, AppError> {
    let reviewer: Option<String> = if let Some(reviewed_by) = revision.reviewed_by {
        sqlx::query_scalar("SELECT username FROM users WHERE id = $1")
            .bind(reviewed_by)
            .fetch_optional(db)
            .await?
    } else {
        None
    };
    let conflicts = revision_conflicts(db, revision.id).await?;
    Ok(ReviewStatus {
        revision_id: revision.id,
        project_slug: project.slug.clone(),
        status: revision.status.clone(),
        commit_message: revision.commit_message.clone(),
        comment: revision.review_comment.clone(),
        reviewer,
        token_added: revision.token_added,
        token_removed: revision.token_removed,
        total_tokens: revision.total_tokens,
        stale: revision.status != STATUS_ACTIVE
            && revision.merged_against_revision_id != project.active_revision_id,
        conflict_count: conflicts.len(),
        conflicts: conflicts.iter().map(ConflictView::from).collect(),
        created_at: revision.created_at,
        updated_at: revision.updated_at,
    })
}

/// Ensure that a revision belongs to the project in a Tool context.
pub async fn approve(
    state: &AppState,
    project: &Project,
    revision_id: Uuid,
    reviewer: &WebUser,
    comment: &str,
    activate_now: bool,
) -> Result<Revision, AppError> {
    if comment.chars().count() > 5000 {
        return Err(AppError::bad_request(
            "INVALID_ARGUMENT",
            "comment is too long",
        ));
    }
    let actor = Actor::from_web(reviewer);
    let mut tx = state.db.begin().await.map_err(AppError::from_db)?;
    // Consistent lock order with activation: project row first, then revision.
    lock_project_active(&mut tx, project.id).await?;
    let revision = load_revision_for_update(&mut tx, revision_id).await?;
    if revision.project_id != project.id {
        return Err(AppError::not_found(
            "REVISION_NOT_FOUND",
            "revision not found",
        ));
    }
    if revision.status != STATUS_PENDING {
        return Err(AppError::conflict(
            "REVISION_STATE",
            format!(
                "revision is {}; only pending_review revisions can be approved",
                revision.status
            ),
        ));
    }

    sqlx::query(
        "UPDATE revisions SET status = $2, review_comment = $3, reviewed_by = $4, reviewed_at = now() WHERE id = $1",
    )
    .bind(revision_id)
    .bind(STATUS_APPROVED)
    .bind(comment)
    .bind(reviewer.id)
    .execute(&mut *tx)
    .await
    .map_err(AppError::from_db)?;

    insert_audit(
        &mut tx,
        Some(project.id),
        Some(revision_id),
        &actor,
        "approve",
        "ok",
        json!({"comment": comment, "activate_now": activate_now}),
    )
    .await?;

    if activate_now {
        activate_in_tx(&mut tx, project.id, revision_id, Some(&actor)).await?;
    }
    tx.commit().await.map_err(AppError::from_db)?;
    get_revision(&state.db, revision_id)
        .await?
        .ok_or_else(|| AppError::internal("revision vanished after approval"))
}

pub async fn reject(
    state: &AppState,
    project: &Project,
    revision_id: Uuid,
    reviewer: &WebUser,
    comment: &str,
) -> Result<Revision, AppError> {
    if comment.chars().count() > 5000 {
        return Err(AppError::bad_request(
            "INVALID_ARGUMENT",
            "comment is too long",
        ));
    }
    let actor = Actor::from_web(reviewer);
    let mut tx = state.db.begin().await.map_err(AppError::from_db)?;
    lock_project_active(&mut tx, project.id).await?;
    let revision = load_revision_for_update(&mut tx, revision_id).await?;
    if revision.project_id != project.id {
        return Err(AppError::not_found(
            "REVISION_NOT_FOUND",
            "revision not found",
        ));
    }
    let status = RevisionStatus::parse(&revision.status)
        .ok_or_else(|| AppError::internal("unknown revision status"))?;
    if !status.can_transition_to(RevisionStatus::Rejected) {
        return Err(AppError::conflict(
            "REVISION_STATE",
            format!("revision is {}; it cannot be rejected now", revision.status),
        ));
    }
    sqlx::query(
        "UPDATE revisions SET status = $2, review_comment = $3, reviewed_by = $4, reviewed_at = now() WHERE id = $1",
    )
    .bind(revision_id)
    .bind(STATUS_REJECTED)
    .bind(comment)
    .bind(reviewer.id)
    .execute(&mut *tx)
    .await
    .map_err(AppError::from_db)?;
    insert_audit(
        &mut tx,
        Some(project.id),
        Some(revision_id),
        &actor,
        "reject",
        "ok",
        json!({"comment": comment}),
    )
    .await?;
    tx.commit().await.map_err(AppError::from_db)?;
    get_revision(&state.db, revision_id)
        .await?
        .ok_or_else(|| AppError::internal("revision vanished after rejection"))
}
