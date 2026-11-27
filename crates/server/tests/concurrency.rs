mod support;

use serde_json::json;
use support::TestApp;

#[tokio::test]
async fn concurrent_activations_keep_one_pointer_and_one_active_revision() {
    let app = TestApp::start().await;
    let cookie = app.login().await;
    let key = app
        .web(
            &cookie,
            reqwest::Method::POST,
            "/api/projects/default/keys",
            Some(json!({
                "name": "race",
                "scopes": ["mcp:read", "admin:propose", "admin:activate"]
            })),
        )
        .await["api_key"]
        .as_str()
        .unwrap()
        .to_string();

    let first = app
        .mcp(
            "/admin/mcp",
            &key,
            "propose_revision",
            json!({
                "commit_message": "race a",
                "inline_patches": [{"path": "docs/race-a.md", "content": "# A\n"}]
            }),
        )
        .await
        .expect("proposal a");
    let second = app
        .mcp(
            "/admin/mcp",
            &key,
            "propose_revision",
            json!({
                "commit_message": "race b",
                "inline_patches": [{"path": "docs/race-b.md", "content": "# B\n"}]
            }),
        )
        .await
        .expect("proposal b");
    let a = uuid::Uuid::parse_str(first["revision_id"].as_str().unwrap()).unwrap();
    let b = uuid::Uuid::parse_str(second["revision_id"].as_str().unwrap()).unwrap();
    for id in [a, b] {
        app.web(
            &cookie,
            reqwest::Method::POST,
            &format!("/api/revisions/{id}/approve"),
            Some(json!({"comment": "approved for race"})),
        )
        .await;
    }

    let project = agentry::project::load_project_by_slug(&app.state.db, "default")
        .await
        .unwrap()
        .unwrap();
    let (ra, rb) = tokio::join!(
        agentry::revisions::activate_revision(&app.state, project.id, a, None),
        agentry::revisions::activate_revision(&app.state, project.id, b, None)
    );
    let a_ok = ra.is_ok();
    let b_ok = rb.is_ok();
    let successes = [a_ok, b_ok].iter().filter(|ok| **ok).count();
    assert_eq!(successes, 1, "exactly one activation must win");
    let error = if let Err(error) = &ra {
        error
    } else {
        rb.as_ref().err().unwrap()
    };
    assert_eq!(error.code, "REVISION_STALE");

    let active: Option<uuid::Uuid> =
        sqlx::query_scalar("SELECT active_revision_id FROM projects WHERE id = $1")
            .bind(project.id)
            .fetch_one(&app.state.db)
            .await
            .unwrap();
    let winner = if a_ok { a } else { b };
    assert_eq!(active, Some(winner));

    let active_count: i64 = sqlx::query_scalar(
        "SELECT count(*) FROM revisions WHERE project_id = $1 AND status = 'active'",
    )
    .bind(project.id)
    .fetch_one(&app.state.db)
    .await
    .unwrap();
    assert_eq!(active_count, 1);

    let loser = if winner == a { b } else { a };
    let loser_status: String = sqlx::query_scalar("SELECT status FROM revisions WHERE id = $1")
        .bind(loser)
        .fetch_one(&app.state.db)
        .await
        .unwrap();
    assert_eq!(loser_status, "approved");

    app.cleanup().await;
}
