mod support;

use serde_json::json;
use support::TestApp;

#[tokio::test]
async fn rebasing_a_stale_pending_revision_updates_it_in_place() {
    let app = TestApp::start().await;
    let cookie = app.login().await;
    let key = app
        .web(
            &cookie,
            reqwest::Method::POST,
            "/api/projects/default/keys",
            Some(json!({
                "name": "rebase-stale",
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

    // Move the active revision forward.
    let active_side = app
        .mcp(
            "/admin/mcp",
            &key,
            "propose_revision",
            json!({
                "base_revision_id": base_id,
                "commit_message": "move active forward",
                "inline_patches": [{
                    "path": "docs/active.md",
                    "content": "# Active\n"
                }]
            }),
        )
        .await
        .unwrap();

    // Propose the second revision before activation so it is based on the
    // previous active and becomes stale once the first one is activated.
    let stale = app
        .mcp(
            "/admin/mcp",
            &key,
            "propose_revision",
            json!({
                "base_revision_id": base_id,
                "commit_message": "stale pending proposal",
                "inline_patches": [{
                    "path": "docs/stale.md",
                    "content": "# Stale\n"
                }]
            }),
        )
        .await
        .unwrap();
    let stale_id = stale["revision_id"].as_str().unwrap().to_string();
    let stale_uuid = stale["revision_uuid"].as_str().unwrap().to_string();

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

    let before = app
        .mcp(
            "/admin/mcp",
            &key,
            "check_review_status",
            json!({"revision_id": stale_id}),
        )
        .await
        .unwrap();
    assert_eq!(before["status"], "pending_review");
    assert_eq!(before["stale"], true);

    let rebased = app
        .web(
            &cookie,
            reqwest::Method::POST,
            &format!("/api/revisions/{stale_id}/rebase"),
            None,
        )
        .await;
    assert_eq!(rebased["revision"]["id"], stale_uuid);
    assert_eq!(rebased["revision"]["short_code"], stale_id);
    assert_eq!(rebased["revision"]["status"], "pending_review");

    let after = app
        .mcp(
            "/admin/mcp",
            &key,
            "check_review_status",
            json!({"revision_id": stale_id}),
        )
        .await
        .unwrap();
    assert_eq!(after["status"], "pending_review");
    assert_eq!(after["stale"], false);

    app.web(
        &cookie,
        reqwest::Method::POST,
        &format!("/api/revisions/{stale_id}/approve"),
        Some(json!({"comment": "rebased", "activate_now": true})),
    )
    .await;

    let active_doc = app
        .mcp(
            "/mcp",
            &key,
            "read_slice",
            json!({"path": "docs/active.md", "mode": "full"}),
        )
        .await
        .unwrap();
    assert!(active_doc["content"].as_str().unwrap().contains("# Active"));

    let stale_doc = app
        .mcp(
            "/mcp",
            &key,
            "read_slice",
            json!({"path": "docs/stale.md", "mode": "full"}),
        )
        .await
        .unwrap();
    assert!(stale_doc["content"].as_str().unwrap().contains("# Stale"));

    app.cleanup().await;
}
