mod support;

use reqwest::Method;
use serde_json::{Value, json};
use support::TestApp;

async fn request(
    app: &TestApp,
    cookie: Option<&str>,
    method: Method,
    path: &str,
    body: Option<Value>,
) -> (u16, Value) {
    let mut request = app
        .http
        .request(method, format!("{}{}", app.base_url, path));
    if let Some(cookie) = cookie {
        request = request.header(reqwest::header::COOKIE, cookie);
    }
    if let Some(body) = body {
        request = request.json(&body);
    }
    let response = request.send().await.expect("request");
    let status = response.status().as_u16();
    let value: Value = response.json().await.unwrap_or(Value::Null);
    (status, value)
}

async fn login_as(app: &TestApp, username: &str, password: &str) -> String {
    let response = app
        .http
        .post(format!("{}/api/auth/login", app.base_url))
        .json(&json!({"username": username, "password": password}))
        .send()
        .await
        .expect("login");
    assert_eq!(response.status(), 200);
    response
        .headers()
        .get(reqwest::header::SET_COOKIE)
        .expect("set-cookie")
        .to_str()
        .unwrap()
        .split(';')
        .next()
        .unwrap()
        .to_string()
}

#[tokio::test]
async fn deleting_a_project_soft_deletes_it_and_blocks_bound_keys() {
    let app = TestApp::start().await;
    let cookie = app.login().await;

    let created = app
        .web(
            &cookie,
            Method::POST,
            "/api/projects",
            Some(json!({"slug": "trash", "name": "Trash"})),
        )
        .await;
    let project_id = created["project"]["id"].as_str().unwrap().to_string();

    let key = app
        .web(
            &cookie,
            Method::POST,
            "/api/projects/trash/keys",
            Some(json!({"name": "trash-read", "scopes": ["mcp:read"]})),
        )
        .await["api_key"]
        .as_str()
        .unwrap()
        .to_string();

    let tree = app
        .mcp("/mcp", &key, "inspect_workspace", json!({}))
        .await
        .unwrap();
    assert_eq!(tree["project"], "trash");

    let deleted = app
        .web(&cookie, Method::DELETE, "/api/projects/trash", None)
        .await;
    assert_eq!(deleted["deleted"], true);
    assert_eq!(deleted["project"]["slug"], "trash");

    let projects = app.web(&cookie, Method::GET, "/api/projects", None).await;
    assert!(
        projects["projects"]
            .as_array()
            .unwrap()
            .iter()
            .all(|project| project["slug"] != "trash")
    );

    let (status, body) = request(
        &app,
        Some(&cookie),
        Method::GET,
        "/api/projects/trash",
        None,
    )
    .await;
    assert_eq!(status, 404);
    assert_eq!(body["error"]["code"], "PROJECT_NOT_FOUND");

    let error = app
        .mcp_rpc(
            "/mcp",
            &key,
            "tools/call",
            json!({"name": "inspect_workspace", "arguments": {}}),
        )
        .await
        .expect_err("deleted project key must be rejected");
    assert_eq!(error["error"]["code"], "PROJECT_ACCESS_DENIED");

    let (status, body) = request(
        &app,
        Some(&cookie),
        Method::DELETE,
        "/api/projects/trash",
        None,
    )
    .await;
    assert_eq!(status, 404);
    assert_eq!(body["error"]["code"], "PROJECT_NOT_FOUND");

    let (status, body) = request(
        &app,
        Some(&cookie),
        Method::POST,
        "/api/projects",
        Some(json!({"slug": "trash", "name": "Trash again"})),
    )
    .await;
    assert_eq!(status, 409);
    assert_eq!(body["error"]["code"], "CONFLICT");

    let audit: i64 = sqlx::query_scalar(
        "SELECT count(*) FROM audit_events WHERE action = 'delete_project' AND project_id = $1",
    )
    .bind(uuid::Uuid::parse_str(&project_id).unwrap())
    .fetch_one(&app.state.db)
    .await
    .unwrap();
    assert_eq!(audit, 1);

    app.cleanup().await;
}

#[tokio::test]
async fn only_superadmins_can_delete_projects_via_web_or_mcp() {
    let app = TestApp::start().await;
    let cookie = app.login().await;

    app.web(
        &cookie,
        Method::POST,
        "/api/users",
        Some(json!({
            "username": "opsadmin",
            "password": "password123",
            "role": "admin"
        })),
    )
    .await;
    let ops_cookie = login_as(&app, "opsadmin", "password123").await;

    app.web(
        &cookie,
        Method::POST,
        "/api/projects",
        Some(json!({"slug": "admin-trash", "name": "Admin Trash"})),
    )
    .await;
    let (status, body) = request(
        &app,
        Some(&ops_cookie),
        Method::DELETE,
        "/api/projects/admin-trash",
        None,
    )
    .await;
    assert_eq!(status, 403);
    assert_eq!(body["error"]["code"], "FORBIDDEN");

    app.web(
        &cookie,
        Method::POST,
        "/api/projects",
        Some(json!({"slug": "mcp-trash", "name": "MCP Trash"})),
    )
    .await;
    let platform_key = app
        .web(
            &cookie,
            Method::POST,
            "/api/projects/default/keys",
            Some(json!({
                "name": "platform-delete",
                "scopes": ["admin:platform"],
                "is_global": true
            })),
        )
        .await["api_key"]
        .as_str()
        .unwrap()
        .to_string();

    let deleted = app
        .mcp(
            "/admin/mcp",
            &platform_key,
            "manage_platform",
            json!({"action": "delete_project", "slug": "mcp-trash"}),
        )
        .await
        .unwrap();
    assert_eq!(deleted["deleted"], true);
    assert_eq!(deleted["slug"], "mcp-trash");

    let (status, _) = request(
        &app,
        Some(&cookie),
        Method::GET,
        "/api/projects/mcp-trash",
        None,
    )
    .await;
    assert_eq!(status, 404);

    app.cleanup().await;
}
