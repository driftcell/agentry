use axum::Json;
use axum::Router;
use axum::http::StatusCode;
use axum::response::{IntoResponse, Response};
use axum::routing::{any, get, post};
use serde_json::json;

use crate::AppState;

mod auth;
mod common;
mod dashboard;
mod keys;
mod projects;
mod revisions;
mod users;

pub fn api_router(state: AppState) -> Router<AppState> {
    use self::auth::{login, logout_handler, me};
    use self::dashboard::dashboard;
    use self::keys::{issue_key, list_all_keys, list_keys, revoke_key};
    use self::projects::{
        create_project, delete_project, list_projects, project_detail, project_file, workspace,
    };
    use self::revisions::{
        approve_revision, project_revisions, rebase_revision, reject_revision, resolve_revision,
        revision_detail, revision_file,
    };
    use self::users::{create_user, list_users};

    let body_limit = state.config.max_upload_bytes.saturating_add(1024 * 1024) as usize;

    Router::<AppState>::new()
        .route("/api/auth/login", post(login))
        .route("/api/auth/logout", post(logout_handler))
        .route("/api/auth/me", get(me))
        .route("/api/dashboard", get(dashboard))
        .route("/api/projects", get(list_projects).post(create_project))
        .route(
            "/api/projects/{slug}",
            get(project_detail).delete(delete_project),
        )
        .route("/api/projects/{slug}/workspace", get(workspace))
        .route("/api/projects/{slug}/file", get(project_file))
        .route("/api/projects/{slug}/revisions", get(project_revisions))
        .route("/api/projects/{slug}/keys", get(list_keys).post(issue_key))
        .route("/api/keys", get(list_all_keys))
        .route("/api/keys/{id}/revoke", post(revoke_key))
        .route("/api/revisions/{id}", get(revision_detail))
        .route("/api/revisions/{id}/file", get(revision_file))
        .route("/api/revisions/{id}/approve", post(approve_revision))
        .route("/api/revisions/{id}/rebase", post(rebase_revision))
        .route("/api/revisions/{id}/reject", post(reject_revision))
        .route("/api/revisions/{id}/resolve", post(resolve_revision))
        .route("/api/users", get(list_users).post(create_user))
        .route("/api/{*rest}", any(api_not_found))
        .layer(axum::extract::DefaultBodyLimit::max(body_limit))
        .with_state(state)
}

async fn api_not_found() -> Response {
    (
        StatusCode::NOT_FOUND,
        Json(json!({"error": {"code": "NOT_FOUND", "message": "unknown API route"}})),
    )
        .into_response()
}
