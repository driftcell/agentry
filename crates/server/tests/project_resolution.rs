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
    body["result"]["structuredContent"]["project"]
        .as_str()
        .unwrap_or("")
        .to_string()
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

    // A project-bound platform key cannot revoke a global key.
    let platform_bound = app
        .web(
            &cookie,
            reqwest::Method::POST,
            "/api/projects/default/keys",
            Some(json!({"name": "platform-bound", "scopes": ["admin:platform"]})),
        )
        .await;
    let boundary = app
        .mcp(
            "/admin/mcp",
            platform_bound["api_key"].as_str().unwrap(),
            "manage_platform",
            json!({"action": "revoke_api_key", "api_key_id": global["api_key_id"]}),
        )
        .await
        .expect_err("bound key must not revoke a global key");
    assert_eq!(boundary["error"]["code"], "FORBIDDEN");

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

    // An illegal project_slug never reaches a project lookup.
    let invalid_slug = app
        .mcp(
            "/admin/mcp",
            global_key,
            "stage_upload_urls",
            json!({"project_slug": "../bad", "files": []}),
        )
        .await
        .expect_err("illegal project_slug");
    assert_eq!(invalid_slug["error"]["code"], "INVALID_ARGUMENT");

    // The admin endpoint family resolves the same project sources. A tool
    // error (UNKNOWN_TOOL here) still means the middleware resolved a context;
    // cross-project requests stop at 403.
    let admin_bound = app
        .web(
            &cookie,
            reqwest::Method::POST,
            "/api/projects/default/keys",
            Some(json!({"name": "admin-bound", "scopes": ["admin:propose"]})),
        )
        .await;
    let admin_key = admin_bound["api_key"].as_str().unwrap();
    let (status, _) = call(&app, admin_key, "/admin/mcp", None).await;
    assert_eq!(status, 200);
    let (status, body) = call(
        &app,
        admin_key,
        "/admin/mcp",
        Some(("X-MCP-Project", "second")),
    )
    .await;
    assert_eq!(status, 403);
    assert_eq!(http_error_code(&body), "PROJECT_ACCESS_DENIED");
    let (status, _) = call(&app, admin_key, "/admin/mcp/projects/default", None).await;
    assert_eq!(status, 200);
    let (status, body) = call(&app, admin_key, "/admin/mcp/projects/second", None).await;
    assert_eq!(status, 403);
    assert_eq!(http_error_code(&body), "PROJECT_ACCESS_DENIED");
    let (status, _) = call(&app, global_key, "/admin/mcp", None).await;
    assert_eq!(status, 200);

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
    let proposer_key = proposer["api_key"].as_str().unwrap();
    let (status, body) = call(&app, proposer_key, "/mcp", None).await;
    assert_eq!(status, 403);
    assert_eq!(http_error_code(&body), "INSUFFICIENT_SCOPE");
    let activate = app
        .mcp(
            "/admin/mcp",
            proposer_key,
            "activate_revision",
            json!({"revision_id": "00000000-0000-0000-0000-000000000000"}),
        )
        .await
        .expect_err("admin:activate is required");
    assert_eq!(activate["error"]["code"], "FORBIDDEN");
    let platform = app
        .mcp(
            "/admin/mcp",
            proposer_key,
            "manage_platform",
            json!({"action": "list_users"}),
        )
        .await
        .expect_err("admin:platform is required");
    assert_eq!(platform["error"]["code"], "FORBIDDEN");

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
