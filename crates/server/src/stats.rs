use std::time::Instant;

use serde::Serialize;
use sqlx::PgPool;
use uuid::Uuid;

use crate::project::ProjectContext;

/// Record the minimum metadata needed for the dashboard. Never store bodies,
/// bearer tokens or complete presigned URLs.
pub fn record(
    db: &PgPool,
    ctx: Option<&ProjectContext>,
    endpoint: &str,
    method: &str,
    result: &str,
    started: Instant,
) {
    let pool = db.clone();
    let api_key_id = ctx.map(|c| c.key.api_key_id);
    let project_id = ctx.and_then(|c| c.project.as_ref().map(|p| p.id));
    let endpoint = endpoint.chars().take(40).collect::<String>();
    let method = method.chars().take(100).collect::<String>();
    let result = result.to_string();
    let duration_ms = started.elapsed().as_millis().min(i32::MAX as u128) as i32;
    tokio::spawn(async move {
        let _ = sqlx::query(
            r#"
            INSERT INTO api_call_stats (api_key_id, project_id, endpoint, method, result, duration_ms)
            VALUES ($1, $2, $3, $4, $5, $6)
            "#,
        )
        .bind(api_key_id)
        .bind(project_id)
        .bind(endpoint)
        .bind(method)
        .bind(result)
        .bind(duration_ms)
        .execute(&pool)
        .await;
    });
}

#[derive(Debug, Clone, Serialize, sqlx::FromRow)]
pub struct EndpointStat {
    pub endpoint: String,
    pub calls: i64,
    pub errors: i64,
    pub avg_ms: f64,
}

#[derive(Debug, Clone, Serialize, sqlx::FromRow)]
pub struct KeyStat {
    pub api_key_id: Option<Uuid>,
    pub key_prefix: Option<String>,
    pub key_name: Option<String>,
    pub calls: i64,
    pub errors: i64,
    pub last_called_at: Option<chrono::DateTime<chrono::Utc>>,
}

#[derive(Debug, Clone, Serialize, sqlx::FromRow)]
pub struct MethodStat {
    pub method: String,
    pub calls: i64,
    pub errors: i64,
    pub avg_ms: f64,
}

pub async fn endpoint_stats(
    db: &PgPool,
    project_ids: Option<&[Uuid]>,
) -> Result<Vec<EndpointStat>, sqlx::Error> {
    sqlx::query_as::<_, EndpointStat>(
        r#"
        SELECT endpoint,
               count(*) AS calls,
               count(*) FILTER (WHERE result = 'error') AS errors,
               COALESCE(avg(duration_ms), 0)::float8 AS avg_ms
        FROM api_call_stats
        WHERE created_at > now() - interval '30 days'
          AND ($1::uuid[] IS NULL OR project_id = ANY($1))
        GROUP BY endpoint
        ORDER BY calls DESC
        "#,
    )
    .bind(project_ids)
    .fetch_all(db)
    .await
}

pub async fn method_stats(
    db: &PgPool,
    project_ids: Option<&[Uuid]>,
    limit: i64,
) -> Result<Vec<MethodStat>, sqlx::Error> {
    sqlx::query_as::<_, MethodStat>(
        r#"
        SELECT method,
               count(*) AS calls,
               count(*) FILTER (WHERE result = 'error') AS errors,
               COALESCE(avg(duration_ms), 0)::float8 AS avg_ms
        FROM api_call_stats
        WHERE created_at > now() - interval '30 days'
          AND ($1::uuid[] IS NULL OR project_id = ANY($1))
        GROUP BY method
        ORDER BY calls DESC
        LIMIT $2
        "#,
    )
    .bind(project_ids)
    .bind(limit)
    .fetch_all(db)
    .await
}

pub async fn key_stats(
    db: &PgPool,
    project_ids: Option<&[Uuid]>,
) -> Result<Vec<KeyStat>, sqlx::Error> {
    sqlx::query_as::<_, KeyStat>(
        r#"
        SELECT s.api_key_id, k.key_prefix, k.name AS key_name,
               count(*) AS calls,
               count(*) FILTER (WHERE s.result = 'error') AS errors,
               max(s.created_at) AS last_called_at
        FROM api_call_stats s
        LEFT JOIN api_keys k ON k.id = s.api_key_id
        WHERE s.created_at > now() - interval '30 days'
          AND ($1::uuid[] IS NULL OR s.project_id = ANY($1))
        GROUP BY s.api_key_id, k.key_prefix, k.name
        ORDER BY calls DESC
        LIMIT 20
        "#,
    )
    .bind(project_ids)
    .fetch_all(db)
    .await
}
