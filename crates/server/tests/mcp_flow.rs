mod support;

use std::io::Read;

use serde_json::json;
use support::TestApp;

#[tokio::test]
async fn read_and_admin_mcp_share_the_same_revision_domain() {
    let app = TestApp::start().await;
    let cookie = app.login().await;

    let issued = app
        .web(
            &cookie,
            reqwest::Method::POST,
            "/api/projects/default/keys",
            Some(json!({
                "name": "integration",
                "scopes": ["mcp:read", "admin:propose", "admin:activate"]
            })),
        )
        .await;
    let key = issued["api_key"].as_str().unwrap().to_string();

    // The read server exposes the seeded active revision.
    let tree = app
        .mcp("/mcp", &key, "inspect_workspace", json!({}))
        .await
        .expect("inspect");
    assert_eq!(tree["project"], "default");
    assert!(tree["files"].as_u64().unwrap() >= 9);
    assert!(tree["tokens"].as_u64().unwrap() > 0);

    let outline = app
        .mcp(
            "/mcp",
            &key,
            "read_slice",
            json!({"path": "CLAUDE.md", "mode": "outline"}),
        )
        .await
        .expect("outline");
    assert!(
        outline["content"]
            .as_str()
            .unwrap()
            .contains("## Repository Map")
    );
    assert!(outline["sections"].as_u64().unwrap() >= 5);

    let skills = app
        .mcp_rpc("/mcp", &key, "skills/list", json!({}))
        .await
        .expect("skills/list");
    assert_eq!(skills["skills"].as_array().unwrap().len(), 2);
    let skill_uri = skills["skills"][0]["uri"].as_str().unwrap();
    let one = app
        .mcp_rpc("/mcp", &key, "skills/get", json!({"uri": skill_uri}))
        .await
        .expect("skills/get");
    assert_eq!(one["skill"]["uri"], skill_uri);

    let resources = app
        .mcp_rpc("/mcp", &key, "resources/list", json!({}))
        .await
        .expect("resources/list");
    assert!(resources["resources"].as_array().unwrap().len() >= 9);
    let binary = app
        .mcp_rpc(
            "/mcp",
            &key,
            "resources/read",
            json!({"uri": "mcp://default/assets/mark.png"}),
        )
        .await
        .expect("binary resource");
    assert_eq!(binary["contents"][0]["mimeType"], "text/uri-list");
    let signed = binary["contents"][0]["text"].as_str().unwrap();
    let binary_response = app.http.get(signed).send().await.expect("signed get");
    assert_eq!(binary_response.status(), 200);

    // Stage a real upload through the presigned PUT and propose it.
    let staged = app
        .mcp(
            "/admin/mcp",
            &key,
            "stage_upload_urls",
            json!({"files": [{
                "remote_path": "docs/integration.md",
                "local_path_hint": "/tmp/integration.md",
                "content_type": "text/markdown"
            }]}),
        )
        .await
        .expect("stage");
    let url = staged["uploads"][0]["url"].as_str().unwrap();
    let put = app
        .http
        .put(url)
        .header(reqwest::header::CONTENT_TYPE, "text/markdown")
        .body("# Integration\n\nA real presigned upload.\n")
        .send()
        .await
        .expect("presigned put");
    assert_eq!(put.status(), 200);

    let proposal = app
        .mcp(
            "/admin/mcp",
            &key,
            "propose_revision",
            json!({
                "session_id": staged["session_id"],
                "commit_message": "docs: integration upload"
            }),
        )
        .await
        .expect("proposal");
    let revision_id = proposal["revision_id"].as_str().unwrap().to_string();
    assert_eq!(proposal["status"], "pending_review");
    assert!(proposal["token_added"].as_i64().unwrap() > 0);

    // Activation before human approval fails at the domain boundary.
    let denied = app
        .mcp(
            "/admin/mcp",
            &key,
            "activate_revision",
            json!({"revision_id": revision_id}),
        )
        .await
        .expect_err("pending revision must not activate");
    assert_eq!(denied["error"]["code"], "REVISION_STATE");

    let approved = app
        .web(
            &cookie,
            reqwest::Method::POST,
            &format!("/api/revisions/{revision_id}/approve"),
            Some(json!({"comment": "integration approval"})),
        )
        .await;
    assert_eq!(approved["revision"]["status"], "approved");

    let activated = app
        .mcp(
            "/admin/mcp",
            &key,
            "activate_revision",
            json!({"revision_id": revision_id}),
        )
        .await
        .expect("activation");
    assert_eq!(activated["status"], "active");

    let read = app
        .mcp(
            "/mcp",
            &key,
            "read_slice",
            json!({"path": "docs/integration.md", "mode": "full"}),
        )
        .await
        .expect("read new active file");
    assert!(
        read["content"]
            .as_str()
            .unwrap()
            .starts_with("# Integration")
    );

    let status = app
        .mcp(
            "/admin/mcp",
            &key,
            "check_review_status",
            json!({"revision_id": revision_id}),
        )
        .await
        .expect("status");
    assert_eq!(status["status"], "active");
    assert_eq!(status["comment"], "integration approval");
    assert_eq!(status["reviewer"], "admin");

    // Two proposals from the same base both edit the same line: the second
    // must enter conflict, and must not activate until resolved and approved.
    let base = app
        .mcp("/mcp", &key, "inspect_workspace", json!({}))
        .await
        .expect("base");
    let base_id = base["revision"].as_str().unwrap().to_string();

    let first = app
        .mcp(
            "/admin/mcp",
            &key,
            "propose_revision",
            json!({
                "base_revision_id": base_id,
                "commit_message": "docs: active side",
                "inline_patches": [{
                    "path": "docs/integration.md",
                    "content": "# Integration\n\nACTIVE SIDE.\n"
                }]
            }),
        )
        .await
        .expect("first proposal");
    assert_eq!(first["status"], "pending_review");
    app.web(
        &cookie,
        reqwest::Method::POST,
        &format!(
            "/api/revisions/{}/approve",
            first["revision_id"].as_str().unwrap()
        ),
        Some(json!({"comment": "active side ok", "activate_now": true})),
    )
    .await;

    let conflict = app
        .mcp(
            "/admin/mcp",
            &key,
            "propose_revision",
            json!({
                "base_revision_id": base_id,
                "commit_message": "docs: incoming side",
                "inline_patches": [{
                    "path": "docs/integration.md",
                    "content": "# Integration\n\nINCOMING SIDE.\n"
                }]
            }),
        )
        .await
        .expect("conflict proposal");
    assert_eq!(conflict["status"], "conflict");
    let conflicts = conflict["conflicts"].as_array().unwrap();
    assert_eq!(conflicts[0]["path"], "docs/integration.md");
    assert!(conflicts[0]["hunks"].as_u64().unwrap() >= 1);

    let conflict_id = conflict["revision_id"].as_str().unwrap();
    let blocked = app
        .mcp(
            "/admin/mcp",
            &key,
            "activate_revision",
            json!({"revision_id": conflict_id}),
        )
        .await
        .expect_err("conflict must not activate");
    assert_eq!(blocked["error"]["code"], "REVISION_STATE");

    let resolved = app
        .mcp(
            "/admin/mcp",
            &key,
            "resolve_conflict",
            json!({
                "revision_id": conflict_id,
                "commit_message": "docs: resolved integration",
                "resolutions": [{
                    "path": "docs/integration.md",
                    "content": "# Integration\n\nRESOLVED.\n"
                }]
            }),
        )
        .await
        .expect("resolve");
    assert_eq!(resolved["status"], "pending_review");

    let still_blocked = app
        .mcp(
            "/admin/mcp",
            &key,
            "activate_revision",
            json!({"revision_id": conflict_id}),
        )
        .await
        .expect_err("resolved revision still needs approval");
    assert_eq!(still_blocked["error"]["code"], "REVISION_STATE");

    app.web(
        &cookie,
        reqwest::Method::POST,
        &format!("/api/revisions/{conflict_id}/reject"),
        Some(json!({"comment": "rejected in test"})),
    )
    .await;

    // Bundle download is a real tar.gz built by the server.
    let bundle = app
        .mcp(
            "/mcp",
            &key,
            "pull_bundle_url",
            json!({"paths": ["CLAUDE.md", "AGENTS.md"], "local_target_dir": "dl"}),
        )
        .await
        .expect("bundle");
    assert!(bundle["command"].as_str().unwrap().contains("tar -xzf"));
    let bytes = app
        .http
        .get(bundle["url"].as_str().unwrap())
        .send()
        .await
        .expect("bundle get")
        .bytes()
        .await
        .expect("bundle bytes");
    let mut archive = tar::Archive::new(flate2::read::GzDecoder::new(bytes.as_ref()));
    let mut names = Vec::new();
    for entry in archive.entries().unwrap() {
        let mut entry = entry.unwrap();
        names.push(entry.path().unwrap().to_string_lossy().to_string());
        let mut text = String::new();
        entry.read_to_string(&mut text).unwrap();
        assert!(!text.is_empty());
    }
    names.sort();
    assert_eq!(names, vec!["AGENTS.md", "CLAUDE.md"]);

    app.cleanup().await;
}
