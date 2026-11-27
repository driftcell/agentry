mod support;

use serde_json::json;
use support::TestApp;

#[tokio::test]
async fn resolving_a_conflict_after_active_moves_is_rejected() {
    let app = TestApp::start().await;
    let cookie = app.login().await;
    let key = app
        .web(
            &cookie,
            reqwest::Method::POST,
            "/api/projects/default/keys",
            Some(json!({
                "name": "conflict-stale",
                "scopes": ["mcp:read", "admin:propose", "admin:activate"]
            })),
        )
        .await["api_key"]
        .as_str()
        .unwrap()
        .to_string();

    let base = app
        .mcp("/mcp", &key, "inspect_workspace", json!({}))
        .await
        .unwrap();
    let base_id = base["revision"].as_str().unwrap().to_string();

    let active_side = app
        .mcp(
            "/admin/mcp",
            &key,
            "propose_revision",
            json!({
                "base_revision_id": base_id,
                "commit_message": "conflict active side",
                "inline_patches": [{
                    "path": "docs/conflict.md",
                    "content": "# Conflict\n\nACTIVE\n"
                }]
            }),
        )
        .await
        .unwrap();
    app.web(
        &cookie,
        reqwest::Method::POST,
        &format!(
            "/api/revisions/{}/approve",
            active_side["revision_id"].as_str().unwrap()
        ),
        Some(json!({"comment": "active", "activate_now": true})),
    )
    .await;

    let conflict = app
        .mcp(
            "/admin/mcp",
            &key,
            "propose_revision",
            json!({
                "base_revision_id": base_id,
                "commit_message": "conflict incoming side",
                "inline_patches": [{
                    "path": "docs/conflict.md",
                    "content": "# Conflict\n\nINCOMING\n"
                }]
            }),
        )
        .await
        .unwrap();
    assert_eq!(conflict["status"], "conflict");
    let conflict_id = conflict["revision_id"].as_str().unwrap().to_string();

    // Move the active revision after the conflict was created.
    let newer = app
        .mcp(
            "/admin/mcp",
            &key,
            "propose_revision",
            json!({
                "commit_message": "newer active",
                "inline_patches": [{"path": "docs/newer.md", "content": "# Newer\n"}]
            }),
        )
        .await
        .unwrap();
    app.web(
        &cookie,
        reqwest::Method::POST,
        &format!(
            "/api/revisions/{}/approve",
            newer["revision_id"].as_str().unwrap()
        ),
        Some(json!({"comment": "newer", "activate_now": true})),
    )
    .await;

    let stale = app
        .mcp(
            "/admin/mcp",
            &key,
            "resolve_conflict",
            json!({
                "revision_id": conflict_id,
                "commit_message": "try resolve stale",
                "resolutions": [{
                    "path": "docs/conflict.md",
                    "content": "# Conflict\n\nRESOLVED\n"
                }]
            }),
        )
        .await
        .expect_err("stale conflict resolution must fail");
    assert_eq!(stale["error"]["code"], "REVISION_STALE");

    let status = app
        .mcp(
            "/admin/mcp",
            &key,
            "check_review_status",
            json!({"revision_id": conflict_id}),
        )
        .await
        .unwrap();
    assert_eq!(status["status"], "conflict");
    assert_eq!(status["stale"], true);

    app.cleanup().await;
}
