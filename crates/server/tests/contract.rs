mod support;

use serde_json::json;
use support::TestApp;

fn keys(value: &serde_json::Value) -> Vec<String> {
    let mut keys: Vec<String> = value.as_object().expect("object").keys().cloned().collect();
    keys.sort();
    keys
}

#[tokio::test]
async fn read_contract_fields_digests_tokens_and_size_stay_stable() {
    let app = TestApp::start().await;
    let cookie = app.login().await;
    let key = app
        .web(
            &cookie,
            reqwest::Method::POST,
            "/api/projects/default/keys",
            Some(json!({"name": "contract", "scopes": ["mcp:read"]})),
        )
        .await["api_key"]
        .as_str()
        .unwrap()
        .to_string();

    let tools = app
        .mcp_rpc("/mcp", &key, "tools/list", json!({}))
        .await
        .unwrap();
    let mut names: Vec<&str> = tools["tools"]
        .as_array()
        .unwrap()
        .iter()
        .map(|tool| tool["name"].as_str().unwrap())
        .collect();
    names.sort();
    assert_eq!(
        names,
        vec!["inspect_workspace", "pull_bundle_url", "read_slice"]
    );
    assert!(tools.to_string().len() < 8_000);

    let tree = app
        .mcp("/mcp", &key, "inspect_workspace", json!({}))
        .await
        .unwrap();
    assert_eq!(
        keys(&tree),
        vec![
            "files",
            "project",
            "revision",
            "revision_uuid",
            "tokens",
            "tree"
        ]
    );
    assert!(tree.to_string().len() < 8_000);
    assert!(tree["tree"].as_str().unwrap().contains("CLAUDE.md"));

    let project = app
        .web(&cookie, reqwest::Method::GET, "/api/projects/default", None)
        .await;
    assert_eq!(
        tree["tokens"].as_i64().unwrap(),
        project["active_revision"]["total_tokens"].as_i64().unwrap()
    );
    assert_eq!(
        tree["files"].as_u64().unwrap(),
        project["active_revision"]["file_count"].as_u64().unwrap()
    );

    let outline = app
        .mcp(
            "/mcp",
            &key,
            "read_slice",
            json!({"path": "CLAUDE.md", "mode": "outline"}),
        )
        .await
        .unwrap();
    assert_eq!(
        keys(&outline),
        vec![
            "content",
            "file_tokens",
            "mode",
            "path",
            "sections",
            "tokens",
            "truncated"
        ]
    );
    assert!(outline["file_tokens"].as_i64().unwrap() > 0);
    assert!(outline.to_string().len() < 8_000);

    let section = app
        .mcp(
            "/mcp",
            &key,
            "read_slice",
            json!({"path": "CLAUDE.md", "mode": "section", "section": "Repository Map"}),
        )
        .await
        .unwrap();
    assert_eq!(section["section"], "Repository Map");
    assert!(section["tokens"].as_u64().unwrap() > 0);
    assert!(section["tokens"].as_u64().unwrap() < outline["file_tokens"].as_u64().unwrap());

    let resources = app
        .mcp_rpc("/mcp", &key, "resources/list", json!({}))
        .await
        .unwrap();
    let first = &resources["resources"][0];
    for required in ["uri", "name", "mimeType", "size"] {
        assert!(first.get(required).is_some(), "missing {required}");
    }
    assert!(keys(first).iter().all(|k| {
        [
            "uri",
            "name",
            "mimeType",
            "size",
            "description",
            "annotations",
        ]
        .contains(&k.as_str())
    }));
    assert!(first["uri"].as_str().unwrap().starts_with("mcp://default/"));

    let skills = app
        .mcp_rpc("/mcp", &key, "skills/list", json!({}))
        .await
        .unwrap();
    let skill = &skills["skills"][0];
    let digest = skill["resources"][0]["digest"].as_str().unwrap();
    assert!(digest.starts_with("sha256:"));
    assert_eq!(digest.len(), 7 + 64);
    assert!(
        skill["uri"]
            .as_str()
            .unwrap()
            .starts_with("skill://default/")
    );

    let directory = app
        .mcp_rpc(
            "/mcp",
            &key,
            "resources/directory/read",
            json!({"uri": "skill://default/reviewer/"}),
        )
        .await
        .unwrap();
    let uris: Vec<&str> = directory["resources"]
        .as_array()
        .unwrap()
        .iter()
        .map(|resource| resource["uri"].as_str().unwrap())
        .collect();
    assert!(uris.contains(&"skill://default/reviewer/SKILL.md"));
    assert!(uris.contains(&"skill://default/reviewer/reference.md"));

    // Invalid cursor is a stable invalid-params error, not a panic or empty page.
    let bad_cursor = app
        .mcp_rpc(
            "/mcp",
            &key,
            "skills/list",
            json!({"cursor": "not-a-cursor"}),
        )
        .await
        .expect_err("invalid cursor");
    assert!(bad_cursor.to_string().contains("invalid cursor"));

    let unknown = app
        .mcp("/mcp", &key, "delete_everything", json!({}))
        .await
        .expect_err("unknown tool");
    assert_eq!(unknown["error"]["code"], "UNKNOWN_TOOL");

    app.cleanup().await;
}
