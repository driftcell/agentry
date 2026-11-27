#![allow(dead_code)]

use std::sync::Arc;
use std::time::Duration;

use agentry::config::{Config, StorageBackend};
use agentry::storage::StorageHandle;
use agentry::{AppState, build_router, db, seed};
use serde_json::Value;
use sqlx::postgres::PgPoolOptions;
use url::Url;
use uuid::Uuid;

pub struct TestApp {
    pub state: AppState,
    pub base_url: String,
    pub database_url: String,
    pub db_name: String,
    pub admin_url: String,
    pub http: reqwest::Client,
    handle: tokio::task::JoinHandle<()>,
}

impl TestApp {
    pub async fn start() -> Self {
        Self::start_with_static("crates/server/static").await
    }

    pub async fn start_with_static(static_dir: &str) -> Self {
        let _ = tracing_subscriber::fmt()
            .with_env_filter("error,agentry=warn")
            .with_test_writer()
            .try_init();
        let admin_url = std::env::var("TEST_DATABASE_ADMIN_URL")
            .unwrap_or_else(|_| "postgres://agentry:agentry@127.0.0.1:55432/postgres".to_string());
        let db_name = format!("agentry_it_{}", Uuid::new_v4().simple());
        let admin_pool = PgPoolOptions::new()
            .max_connections(1)
            .connect(&admin_url)
            .await
            .unwrap_or_else(|error| {
                panic!(
                    "connect to {admin_url}: {error}\nstart `docker compose -f docker-compose.test.yml up -d`"
                )
            });
        sqlx::query(sqlx::AssertSqlSafe(format!(
            r#"CREATE DATABASE "{db_name}""#
        )))
        .execute(&admin_pool)
        .await
        .expect("create test database");
        admin_pool.close().await;

        let mut url = Url::parse(&admin_url).expect("admin url");
        url.set_path(&db_name);
        let database_url = url.to_string();

        let listener = tokio::net::TcpListener::bind("127.0.0.1:0")
            .await
            .expect("bind test listener");
        let address = listener.local_addr().unwrap();
        let public_url = format!("http://{address}");

        let config = Arc::new(Config {
            environment: "test".into(),
            database_url: database_url.clone(),
            bind_addr: address.to_string(),
            public_url,
            static_dir: static_dir.to_string(),
            allowed_hosts: vec!["127.0.0.1".into(), "localhost".into()],
            storage_backend: StorageBackend::Memory,
            oss: None,
            transfer_ttl: Duration::from_secs(3600),
            max_upload_bytes: 8 * 1024 * 1024,
            web_session_ttl: Duration::from_secs(3600),
            seed_admin_username: "admin".into(),
            seed_admin_password: "admin".into(),
            seed_default_project: "default".into(),
            db_max_connections: 5,
        });
        let pool = db::connect(&config).await.expect("db connect");
        db::migrate(&pool).await.expect("migrate");
        let storage = StorageHandle::from_config(&config).expect("storage");
        seed::seed(&pool, &storage, &config).await.expect("seed");

        let state = AppState {
            db: pool,
            config: config.clone(),
            storage,
        };
        let router = build_router(state.clone());
        let handle = tokio::spawn(async move {
            let _ = axum::serve(listener, router).await;
        });

        let app = Self {
            state,
            base_url: config.public_url.clone(),
            database_url,
            db_name,
            admin_url,
            http: reqwest::Client::new(),
            handle,
        };
        app.wait_ready().await;
        app
    }

    async fn wait_ready(&self) {
        for _ in 0..100 {
            if self
                .http
                .get(format!("{}/health/live", self.base_url))
                .send()
                .await
                .map(|r| r.status().is_success())
                .unwrap_or(false)
            {
                return;
            }
            tokio::time::sleep(Duration::from_millis(25)).await;
        }
        panic!("test app did not become ready");
    }

    pub async fn login(&self) -> String {
        let response = self
            .http
            .post(format!("{}/api/auth/login", self.base_url))
            .json(&serde_json::json!({"username": "admin", "password": "admin"}))
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

    pub async fn web(
        &self,
        cookie: &str,
        method: reqwest::Method,
        path: &str,
        body: Option<Value>,
    ) -> Value {
        let mut request = self
            .http
            .request(method, format!("{}{}", self.base_url, path))
            .header(reqwest::header::COOKIE, cookie);
        if let Some(body) = body {
            request = request.json(&body);
        }
        let response = request.send().await.expect("web request");
        let status = response.status();
        let value: Value = response.json().await.unwrap_or(Value::Null);
        assert!(status.is_success(), "web {path} -> {status}: {value}");
        value
    }

    pub async fn mcp_rpc(
        &self,
        endpoint: &str,
        key: &str,
        method: &str,
        params: Value,
    ) -> Result<Value, Value> {
        let response = self
            .http
            .post(format!("{}{}", self.base_url, endpoint))
            .header(reqwest::header::AUTHORIZATION, format!("Bearer {key}"))
            .header(
                reqwest::header::ACCEPT,
                "application/json, text/event-stream",
            )
            .json(&serde_json::json!({
                "jsonrpc": "2.0",
                "id": 1,
                "method": method,
                "params": params
            }))
            .send()
            .await
            .expect("mcp call");
        let status = response.status();
        let body: Value = response.json().await.expect("json response");
        if !status.is_success() {
            return Err(body);
        }
        if let Some(error) = body.get("error") {
            return Err(error.clone());
        }
        Ok(body.get("result").cloned().unwrap_or(Value::Null))
    }

    pub async fn mcp(
        &self,
        endpoint: &str,
        key: &str,
        tool: &str,
        arguments: Value,
    ) -> Result<Value, Value> {
        let result = self
            .mcp_rpc(
                endpoint,
                key,
                "tools/call",
                serde_json::json!({"name": tool, "arguments": arguments}),
            )
            .await?;
        let parsed: Value = if let Some(structured) = result.get("structuredContent") {
            structured.clone()
        } else {
            let text = result
                .get("content")
                .and_then(|c| c.get(0))
                .and_then(|c| c.get("text"))
                .and_then(|t| t.as_str())
                .unwrap_or("{}");
            serde_json::from_str(text).expect("tool json")
        };
        if result.get("isError").and_then(|v| v.as_bool()) == Some(true) {
            Err(parsed)
        } else {
            Ok(parsed)
        }
    }

    pub async fn cleanup(self) {
        self.state.db.close().await;
        self.handle.abort();
        let admin = PgPoolOptions::new()
            .max_connections(1)
            .connect(&self.admin_url)
            .await
            .expect("admin reconnect");
        sqlx::query("SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname = $1")
            .bind(&self.db_name)
            .execute(&admin)
            .await
            .expect("terminate");
        sqlx::query(sqlx::AssertSqlSafe(format!(
            r#"DROP DATABASE IF EXISTS "{}""#,
            self.db_name
        )))
        .execute(&admin)
        .await
        .expect("drop");
        admin.close().await;
    }
}
