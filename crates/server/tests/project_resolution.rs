mod support;

use serde_json::{Value, json};
use support::TestApp;

async fn call(app: &TestApp, key: &str, path: &str, header: Option<(&str, &str)>) -> (u16, Value) {
    let mut request = app
        .http
        .post(format!("{}{}", app.base_url, path))
        .header(reqwest::header::AUTHORIZATION, format!("Bearer {key}"))
        .header(
            reqwest::header::ACCEPT,
            "application/json, text/event-stream",
        )
        .json(&json!({
            "jsonrpc": "2.0", "id": 1, "method": "tools/call",
            "params": {"name": "inspect_workspace", "arguments": {}}
        }));
    if let Some((name, value)) = header {
        request = request.header(name, value);
    }
    let response = request.send().await.expect("mcp request");
    let status = response.status().as_u16();
    (status, response.json().await.expect("json body"))
}

fn tool_project(body: &Value) -> String {
    let text = body["result"]["content"][0]["text"]
        .as_str()
        .expect("tool text");
    let parsed: Value = serde_json::from_str(text).expect("tool json");
    parsed["project"].as_str().unwrap_or("").to_string()
}

fn http_error_code(body: &Value) -> &str {
    body["error"]["code"].as_str().unwrap_or("")
}

#[tokio::test]
async fn project_sources_follow_the_fixed_priority_table() {
    let app = TestApp::start().await;
    let cookie = app.login().await;

    app.web(
        &cookie,
        reqwest::Method::POST,
        "/api/projects",
        Some(json!({"slug": "second", "name": "Second"})),
    )
    .await;

    let bound = app
        .web(
            &cookie,
            reqwest::Method::POST,
            "/api/projects/default/keys",
            Some(json!({"name": "bound", "scopes": ["mcp:read"]})),
        )
        .await;
    let bound_key = bound["api_key"].as_str().unwrap();

    let global = app
        .web(
            &cookie,
            reqwest::Method::POST,
            "/api/projects/default/keys",
            Some(json!({
                "name": "global",
                "scopes": ["mcp:read", "admin:propose", "admin:activate", "admin:platform"],
                "is_global": true
            })),
        )
        .await;
    let global_key = global["api_key"].as_str().unwrap();

    // Project-bound key: its default project is used without a header.
    let (status, body) = call(&app, bound_key, "/mcp", None).await;
    assert_eq!(status, 200);
    assert_eq!(tool_project(&body), "default");

    // Header can select the same project.
    let (status, body) = call(&app, bound_key, "/mcp", Some(("X-MCP-Project", "default"))).await;
    assert_eq!(status, 200);
    assert_eq!(tool_project(&body), "default");

    // Cross-project header is denied, never silently falling back.
    let (status, body) = call(&app, bound_key, "/mcp", Some(("X-MCP-Project", "second"))).await;
    assert_eq!(status, 403);
    assert_eq!(http_error_code(&body), "PROJECT_ACCESS_DENIED");

    // Project path wins; a different header is a conflict.
    let (status, body) = call(&app, bound_key, "/mcp/projects/default", None).await;
    assert_eq!(status, 200);
    assert_eq!(tool_project(&body), "default");
    let (status, body) = call(
        &app,
        bound_key,
        "/mcp/projects/default",
        Some(("X-MCP-Project", "second")),
    )
    .await;
    assert_eq!(status, 400);
    assert_eq!(http_error_code(&body), "PROJECT_CONTEXT_CONFLICT");

    // Project path can never escape a bound key.
    let (status, body) = call(&app, bound_key, "/mcp/projects/second", None).await;
    assert_eq!(status, 403);
    assert_eq!(http_error_code(&body), "PROJECT_ACCESS_DENIED");

    // A global key mounts projects by path, but a fixed /mcp without a header
    // has no context.
    let (status, body) = call(&app, global_key, "/mcp/projects/second", None).await;
    assert_eq!(status, 200);
    assert_eq!(tool_project(&body), "second");
    let (status, body) = call(&app, global_key, "/mcp", None).await;
    assert_eq!(status, 400);
    assert_eq!(http_error_code(&body), "PROJECT_CONTEXT_REQUIRED");
    let (status, body) = call(&app, global_key, "/mcp", Some(("X-MCP-Project", "second"))).await;
    assert_eq!(status, 200);
    assert_eq!(tool_project(&body), "second");

    // Scope gates are default-deny on both endpoint families.
    let reader = app
        .web(
            &cookie,
            reqwest::Method::POST,
            "/api/projects/default/keys",
            Some(json!({"name": "reader", "scopes": ["mcp:read"]})),
        )
        .await;
    let (status, body) = call(
        &app,
        reader["api_key"].as_str().unwrap(),
        "/admin/mcp",
        None,
    )
    .await;
    assert_eq!(status, 403);
    assert_eq!(http_error_code(&body), "INSUFFICIENT_SCOPE");
    let proposer = app
        .web(
            &cookie,
            reqwest::Method::POST,
            "/api/projects/default/keys",
            Some(json!({"name": "proposer", "scopes": ["admin:propose"]})),
        )
        .await;
    let (status, body) = call(&app, proposer["api_key"].as_str().unwrap(), "/mcp", None).await;
    assert_eq!(status, 403);
    assert_eq!(http_error_code(&body), "INSUFFICIENT_SCOPE");

    // Revocation is immediate.
    let keys = app
        .web(
            &cookie,
            reqwest::Method::GET,
            "/api/projects/default/keys",
            None,
        )
        .await;
    let bound_id = keys["keys"]
        .as_array()
        .unwrap()
        .iter()
        .find(|k| k["name"] == "bound")
        .unwrap()["id"]
        .as_str()
        .unwrap();
    app.web(
        &cookie,
        reqwest::Method::POST,
        &format!("/api/keys/{bound_id}/revoke"),
        None,
    )
    .await;
    let (status, body) = call(&app, bound_key, "/mcp", None).await;
    assert_eq!(status, 401);
    assert_eq!(http_error_code(&body), "UNAUTHENTICATED");

    app.cleanup().await;
}
