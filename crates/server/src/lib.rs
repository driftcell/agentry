pub mod api;
pub mod auth;
pub mod config;
pub mod content;
pub mod db;
pub mod error;
pub mod lifecycle;
pub mod markdown;
pub mod mcp;
pub mod paths;
pub mod project;
pub mod revisions;
pub mod seed;
pub mod short_id;
pub mod stats;
pub mod storage;
pub mod tokens;
pub mod workspace;

use std::sync::Arc;

use axum::Json;
use axum::Router;
use axum::extract::{DefaultBodyLimit, Path, Query, State};
use axum::http::{HeaderMap, StatusCode};
use axum::response::{IntoResponse, Response};
use axum::routing::get;

use serde_json::json;
use sqlx::PgPool;
use tower_http::compression::CompressionLayer;
use tower_http::request_id::{MakeRequestUuid, PropagateRequestIdLayer, SetRequestIdLayer};
use tower_http::services::{ServeDir, ServeFile};
use tower_http::trace::{DefaultMakeSpan, DefaultOnResponse, TraceLayer};

use crate::config::Config;
use crate::storage::StorageHandle;

#[derive(Clone)]
pub struct AppState {
    pub db: PgPool,
    pub config: Arc<Config>,
    pub storage: StorageHandle,
}

pub fn build_router(state: AppState) -> Router {
    let index = format!(
        "{}/index.html",
        state.config.static_dir.trim_end_matches('/')
    );
    let spa = ServeDir::new(state.config.static_dir.clone()).fallback(ServeFile::new(index));

    let mut router = Router::new()
        .route("/health", get(health))
        .route("/health/live", get(live))
        .merge(mcp::mcp_router(state.clone()))
        .merge(api::api_router(state.clone()));
    if state.storage.is_memory() {
        router = router
            .route(
                "/__oss/{*key}",
                get(memory_get).put(memory_put).delete(memory_delete),
            )
            .layer(DefaultBodyLimit::max(
                state.config.max_upload_bytes as usize + 1024,
            ));
    }
    router
        .fallback_service(spa)
        .layer(
            TraceLayer::new_for_http()
                .make_span_with(DefaultMakeSpan::new().include_headers(false))
                .on_response(DefaultOnResponse::new()),
        )
        .layer(PropagateRequestIdLayer::x_request_id())
        .layer(SetRequestIdLayer::x_request_id(MakeRequestUuid))
        .layer(CompressionLayer::new())
        .with_state(state)
}

async fn live() -> impl IntoResponse {
    (
        StatusCode::OK,
        Json(json!({
            "status": "ok",
            "service": "agentry",
            "version": env!("CARGO_PKG_VERSION"),
        })),
    )
}

async fn health(State(state): State<AppState>) -> Response {
    let db_ok = db::health(&state.db).await;
    let status = if db_ok {
        StatusCode::OK
    } else {
        StatusCode::SERVICE_UNAVAILABLE
    };
    let body = json!({
        "status": if db_ok { "ok" } else { "degraded" },
        "service": "agentry",
        "version": env!("CARGO_PKG_VERSION"),
        "environment": state.config.environment,
        "checks": {"database": if db_ok { "ok" } else { "failed" }},
        "storage": if state.storage.is_memory() { "memory" } else { "s3" },
    });
    (status, Json(body)).into_response()
}

fn memory_object_key(path: &str) -> String {
    path.trim_start_matches('/').to_string()
}

fn memory_sig_params(
    query: &std::collections::HashMap<String, String>,
) -> Result<(u64, String), StatusCode> {
    let expires = query
        .get("expires")
        .and_then(|v| v.parse::<u64>().ok())
        .ok_or(StatusCode::FORBIDDEN)?;
    let sig = query.get("sig").cloned().ok_or(StatusCode::FORBIDDEN)?;
    Ok((expires, sig))
}

async fn memory_get(
    State(state): State<AppState>,
    Path(key): Path<String>,
    Query(query): Query<std::collections::HashMap<String, String>>,
) -> Response {
    let key = memory_object_key(&key);
    let Ok((expires, sig)) = memory_sig_params(&query) else {
        return StatusCode::FORBIDDEN.into_response();
    };
    let Some(memory) = state.storage.memory() else {
        return StatusCode::NOT_FOUND.into_response();
    };
    if !memory.verify("GET", &key, expires, &sig) {
        return StatusCode::FORBIDDEN.into_response();
    }
    match state.storage.get(&key).await {
        Ok(bytes) => (
            StatusCode::OK,
            [(axum::http::header::CONTENT_TYPE, "application/octet-stream")],
            bytes,
        )
            .into_response(),
        Err(_) => StatusCode::NOT_FOUND.into_response(),
    }
}

async fn memory_put(
    State(state): State<AppState>,
    Path(key): Path<String>,
    Query(query): Query<std::collections::HashMap<String, String>>,
    headers: HeaderMap,
    body: axum::body::Bytes,
) -> Response {
    let key = memory_object_key(&key);
    let Ok((expires, sig)) = memory_sig_params(&query) else {
        return StatusCode::FORBIDDEN.into_response();
    };
    let Some(memory) = state.storage.memory() else {
        return StatusCode::NOT_FOUND.into_response();
    };
    if !memory.verify("PUT", &key, expires, &sig) {
        return StatusCode::FORBIDDEN.into_response();
    }
    if body.is_empty() {
        return StatusCode::BAD_REQUEST.into_response();
    }
    if body.len() as u64 > state.config.max_upload_bytes {
        return StatusCode::PAYLOAD_TOO_LARGE.into_response();
    }
    if let Err(error) = state.storage.put(&key, body, None).await {
        tracing::error!(%error, "memory object put failed");
        return StatusCode::INTERNAL_SERVER_ERROR.into_response();
    }
    let _ = headers;
    StatusCode::OK.into_response()
}

async fn memory_delete(
    State(state): State<AppState>,
    Path(key): Path<String>,
    Query(query): Query<std::collections::HashMap<String, String>>,
) -> Response {
    let key = memory_object_key(&key);
    let Ok((expires, sig)) = memory_sig_params(&query) else {
        return StatusCode::FORBIDDEN.into_response();
    };
    let Some(memory) = state.storage.memory() else {
        return StatusCode::NOT_FOUND.into_response();
    };
    if !memory.verify("DELETE", &key, expires, &sig) {
        return StatusCode::FORBIDDEN.into_response();
    }
    let _ = state.storage.delete(&key).await;
    StatusCode::NO_CONTENT.into_response()
}
