use std::sync::Arc;
use std::time::Duration;

use serde_json::Value;
use tokio::time::interval;
use uuid::Uuid;

use crate::AppState;

/// Expire abandoned transfer sessions and remove their staging objects.
/// Completed sessions are cleaned after a grace period so a retry can still
/// inspect what was uploaded. Revisions never reference staging objects, only
/// immutable blobs, so cleanup cannot corrupt an activated revision.
pub async fn cleanup_expired_sessions(state: &AppState) -> Result<usize, anyhow::Error> {
    type SessionRow = (
        Uuid,
        Uuid,
        String,
        Option<chrono::DateTime<chrono::Utc>>,
        Value,
    );
    let rows: Vec<SessionRow> = sqlx::query_as(
        r#"
            SELECT id, project_id, status, completed_at, files
            FROM transfer_sessions
            WHERE objects_cleaned_at IS NULL
              AND (
                (status = 'open' AND expires_at < now())
                OR (status IN ('completed', 'failed')
                    AND (completed_at IS NULL OR completed_at < now() - interval '1 hour')
                    AND created_at < now() - interval '1 hour')
              )
            "#,
    )
    .fetch_all(&state.db)
    .await?;

    let mut cleaned = 0;
    for (id, project_id, status, _completed_at, files) in rows {
        let mut keys = Vec::new();
        if let Some(files) = files.as_array() {
            for file in files {
                if let Some(key) = file.get("object_key").and_then(|v| v.as_str()) {
                    keys.push(key.to_string());
                }
            }
        }
        for key in keys {
            if let Err(error) = state.storage.delete(&key).await {
                tracing::warn!(%error, %key, "failed to delete staging object");
            }
        }
        let new_status = if status == "open" {
            "expired"
        } else {
            "completed"
        };
        sqlx::query(
            r#"
            UPDATE transfer_sessions
            SET status = $2, objects_cleaned_at = now()
            WHERE id = $1 AND status = $3 AND objects_cleaned_at IS NULL
            "#,
        )
        .bind(id)
        .bind(new_status)
        .bind(&status)
        .execute(&state.db)
        .await?;
        let _ = sqlx::query(
            r#"
            INSERT INTO audit_events
                (project_id, actor_label, action, result, detail)
            VALUES ($1, 'lifecycle', 'cleanup_transfer_session', 'ok', $2)
            "#,
        )
        .bind(project_id)
        .bind(sqlx::types::Json(
            serde_json::json!({"session_id": id, "previous_status": status}),
        ))
        .execute(&state.db)
        .await;
        cleaned += 1;
    }
    Ok(cleaned)
}

/// Delete staging objects for one completed session. Called immediately after
/// a successful proposal; failures are picked up by the periodic cleanup.
pub async fn discard_session_objects(state: &AppState, session_id: Uuid) {
    let row: Option<(Value,)> = sqlx::query_as("SELECT files FROM transfer_sessions WHERE id = $1")
        .bind(session_id)
        .fetch_optional(&state.db)
        .await
        .ok()
        .flatten();
    let Some((files,)) = row else { return };
    if let Some(files) = files.as_array() {
        for file in files {
            if let Some(key) = file.get("object_key").and_then(|v| v.as_str()) {
                let _ = state.storage.delete(key).await;
            }
        }
    }
    let _ = sqlx::query(
        "UPDATE transfer_sessions SET objects_cleaned_at = now() WHERE id = $1 AND objects_cleaned_at IS NULL",
    )
    .bind(session_id)
    .execute(&state.db)
    .await;
}

/// Delete bundle exports whose presigned URL has expired. The row is removed
/// only after the object deletion succeeds, so a transient OSS error retries on
/// the next cleanup tick.
pub async fn cleanup_expired_bundles(state: &AppState) -> Result<usize, anyhow::Error> {
    let rows: Vec<(uuid::Uuid, String)> = sqlx::query_as(
        "SELECT id, object_key FROM bundle_exports WHERE expires_at < now() ORDER BY expires_at LIMIT 200",
    )
    .fetch_all(&state.db)
    .await?;
    let mut cleaned = 0;
    for (id, key) in rows {
        if let Err(error) = state.storage.delete(&key).await {
            tracing::warn!(%error, %key, "failed to delete expired bundle object");
            continue;
        }
        sqlx::query("DELETE FROM bundle_exports WHERE id = $1")
            .bind(id)
            .execute(&state.db)
            .await?;
        cleaned += 1;
    }
    Ok(cleaned)
}

/// Remove expired web sessions and old call telemetry. Audit events are
/// retained; only the high-volume request counters are trimmed.
pub async fn cleanup_expired_sessions_and_stats(
    state: &AppState,
) -> Result<(u64, u64), anyhow::Error> {
    let sessions = sqlx::query("DELETE FROM web_sessions WHERE expires_at < now()")
        .execute(&state.db)
        .await?
        .rows_affected();
    let stats =
        sqlx::query("DELETE FROM api_call_stats WHERE created_at < now() - interval '90 days'")
            .execute(&state.db)
            .await?
            .rows_affected();
    Ok((sessions, stats))
}

pub fn spawn_cleanup(state: AppState) {
    let state = Arc::new(state);
    tokio::spawn(async move {
        let mut ticker = interval(Duration::from_secs(600));
        loop {
            ticker.tick().await;
            match cleanup_expired_sessions(&state).await {
                Ok(0) => {}
                Ok(count) => tracing::info!(count, "cleaned expired transfer sessions"),
                Err(error) => tracing::warn!(%error, "transfer session cleanup failed"),
            }
            match cleanup_expired_bundles(&state).await {
                Ok(0) => {}
                Ok(count) => tracing::info!(count, "cleaned expired bundle exports"),
                Err(error) => tracing::warn!(%error, "bundle cleanup failed"),
            }
            if let Err(error) = cleanup_expired_sessions_and_stats(&state).await {
                tracing::warn!(%error, "session/stat cleanup failed");
            }
        }
    });
}
