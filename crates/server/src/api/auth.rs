use axum::Json;
use axum::extract::State;
use axum::http::{HeaderMap, header};
use axum::response::{IntoResponse, Response};
use serde::Deserialize;
use serde_json::{Value, json};

use crate::AppState;
use crate::auth::{
    WebUser, clear_session_cookie, cookie_value, create_session, logout,
    session_cookie,
};
use crate::error::Result;
use crate::project::list_projects_for_user;

#[derive(Debug, Deserialize)]
pub(super) struct LoginInput {
    username: String,
    password: String,
}

pub(super) async fn login(
    State(state): State<AppState>,
    Json(input): Json<LoginInput>,
) -> Result<Response> {
    let user = crate::auth::login(&state.db, &input.username, &input.password).await?;
    let token = create_session(&state.db, user.id, state.config.web_session_ttl).await?;
    let secure = state.config.public_url.starts_with("https://");
    let cookie = session_cookie(&token, state.config.web_session_ttl, secure);
    Ok((
        [(header::SET_COOKIE, cookie)],
        Json(json!({"user": user})),
    )
        .into_response())
}

pub(super) async fn logout_handler(
    State(state): State<AppState>,
    user: WebUser,
    headers: HeaderMap,
) -> Result<Response> {
    let _ = user;
    if let Some(token) = cookie_value(&headers) {
        logout(&state.db, &token).await?;
    }
    Ok((
        [(header::SET_COOKIE, clear_session_cookie())],
        Json(json!({"ok": true})),
    )
        .into_response())
}

pub(super) async fn me(user: WebUser, State(state): State<AppState>) -> Result<Json<Value>> {
    let projects = list_projects_for_user(&state.db, &user).await?;
    Ok(Json(json!({
        "user": user,
        "projects": projects,
        "can_approve": user.is_admin(),
        "can_platform": user.can_platform(),
    })))
}

