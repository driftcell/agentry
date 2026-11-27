mod support;

use support::TestApp;

#[tokio::test]
async fn spa_fallback_never_swallows_mcp_or_api_routes() {
    let static_dir = tempfile::tempdir().expect("temp static dir");
    std::fs::write(
        static_dir.path().join("index.html"),
        "<!doctype html><title>agentry-spa</title><div id=\"root\"></div>",
    )
    .expect("write index");

    let app = TestApp::start_with_static(static_dir.path().to_str().unwrap()).await;

    let deep = app
        .http
        .get(format!("{}/projects/default/review", app.base_url))
        .send()
        .await
        .expect("deep route");
    assert_eq!(deep.status(), 200);
    assert!(deep.text().await.unwrap().contains("agentry-spa"));

    for path in ["/mcp", "/admin/mcp"] {
        let response = app
            .http
            .post(format!("{}{}", app.base_url, path))
            .json(&serde_json::json!({"jsonrpc":"2.0","id":1,"method":"ping"}))
            .send()
            .await
            .expect("mcp route");
        assert_eq!(response.status(), 401, "{path} must not fall back to SPA");
        let body: serde_json::Value = response.json().await.unwrap();
        assert_eq!(body["error"]["code"], "UNAUTHENTICATED");
    }

    let unknown_api = app
        .http
        .get(format!("{}/api/does-not-exist", app.base_url))
        .send()
        .await
        .expect("api route");
    assert_eq!(unknown_api.status(), 404);
    let body: serde_json::Value = unknown_api.json().await.unwrap();
    assert_eq!(body["error"]["code"], "NOT_FOUND");

    app.cleanup().await;
}
