pub mod admin;
pub mod read;

use std::sync::Arc;
use std::time::Instant;

use axum::Router;
use axum::extract::State;
use axum::http::Request;
use axum::middleware::{self, Next};
use axum::response::{IntoResponse, Response};
use rmcp::RoleServer;
use rmcp::service::RequestContext;
use rmcp::transport::streamable_http_server::session::local::LocalSessionManager;
use rmcp::transport::streamable_http_server::{StreamableHttpServerConfig, StreamableHttpService};

use crate::AppState;
use crate::error::ToolError;
use crate::project::{ProjectContext, resolve_mcp_context};

/// Build the four MCP route shapes. They share one auth/project middleware;
/// only the per-request ServerHandler differs.
pub fn mcp_router(state: AppState) -> Router<AppState> {
    let read_service = StreamableHttpService::new(
        {
            let state = state.clone();
            move || Ok(read::ReadServer::new(state.clone()))
        },
        Arc::new(LocalSessionManager::default()),
        streamable_config(&state),
    );
    let admin_service = StreamableHttpService::new(
        {
            let state = state.clone();
            move || Ok(admin::AdminServer::new(state.clone()))
        },
        Arc::new(LocalSessionManager::default()),
        streamable_config(&state),
    );

    Router::new()
        .route_service("/mcp", read_service.clone())
        .route_service("/mcp/projects/{slug}", read_service)
        .route_service("/admin/mcp", admin_service.clone())
        .route_service("/admin/mcp/projects/{slug}", admin_service)
        .route("/mcp/{*rest}", axum::routing::any(mcp_not_found))
        .route("/admin/mcp/{*rest}", axum::routing::any(mcp_not_found))
        .layer(middleware::from_fn_with_state(state, mcp_auth_middleware))
}

async fn mcp_not_found() -> axum::response::Response {
    use axum::response::IntoResponse;
    (
        axum::http::StatusCode::NOT_FOUND,
        axum::Json(
            serde_json::json!({"error": {"code": "NOT_FOUND", "message": "unknown MCP route"}}),
        ),
    )
        .into_response()
}

fn streamable_config(state: &AppState) -> StreamableHttpServerConfig {
    let mut config = StreamableHttpServerConfig::default();
    config.legacy_session_mode = false;
    config.json_response = true;
    config.sse_keep_alive = Some(std::time::Duration::from_secs(15));
    let hosts = if state.config.allowed_hosts.is_empty() {
        let mut hosts = vec![
            "localhost".to_string(),
            "127.0.0.1".to_string(),
            "::1".to_string(),
            "agentry".to_string(),
        ];
        if let Some(host) = url::Url::parse(&state.config.public_url)
            .ok()
            .and_then(|u| u.host_str().map(str::to_string))
            && !hosts.contains(&host)
        {
            hosts.push(host);
        }
        hosts
    } else {
        state.config.allowed_hosts.clone()
    };
    config.allowed_hosts = hosts;
    config
}

async fn mcp_auth_middleware(
    State(state): State<AppState>,
    mut request: Request<axum::body::Body>,
    next: Next,
) -> Response {
    let started = Instant::now();
    match resolve_mcp_context(&state, request.headers(), request.uri().path()).await {
        Ok(context) => {
            let endpoint = context.endpoint();
            let stats_context = context.clone();
            request.extensions_mut().insert(context);
            let response = next.run(request).await;
            // Endpoint-level failure (protocol/HTTP) is recorded; successful
            // tool/protocol calls are recorded with their real method names by
            // the handlers.
            if !response.status().is_success() {
                crate::stats::record(
                    &state.db,
                    Some(&stats_context),
                    endpoint,
                    "http",
                    "error",
                    started,
                );
            }
            response
        }
        Err(error) => {
            let endpoint = if request.uri().path().starts_with("/admin") {
                "admin/mcp"
            } else {
                "mcp"
            };
            crate::stats::record(&state.db, None, endpoint, "auth", "error", started);
            error.into_response()
        }
    }
}

/// Extract the middleware-resolved context from the HTTP request parts that
/// rmcp attaches to every request.
pub fn request_project_context(
    ctx: &RequestContext<RoleServer>,
) -> Result<ProjectContext, ToolError> {
    let parts = ctx
        .extensions
        .get::<http::request::Parts>()
        .ok_or_else(|| {
            ToolError::new("PROJECT_CONTEXT_REQUIRED", "missing HTTP request context")
        })?;
    parts
        .extensions
        .get::<ProjectContext>()
        .cloned()
        .ok_or_else(|| ToolError::new("PROJECT_CONTEXT_REQUIRED", "no project context resolved"))
}

pub fn parse_args<T: serde::de::DeserializeOwned>(
    arguments: Option<rmcp::model::JsonObject>,
) -> Result<T, ToolError> {
    let value = serde_json::Value::Object(arguments.unwrap_or_default());
    serde_json::from_value(value)
        .map_err(|e| ToolError::bad_request(format!("invalid arguments: {e}")))
}

pub fn tool_json(value: serde_json::Value) -> rmcp::model::CallToolResult {
    rmcp::model::CallToolResult::success(vec![rmcp::model::ContentBlock::text(value.to_string())])
}
