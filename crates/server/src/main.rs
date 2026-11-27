use std::sync::Arc;

use agentry::config::{Config, StorageBackend};
use agentry::storage::StorageHandle;
use agentry::{AppState, build_router, db, lifecycle, seed};
use anyhow::{Context, Result};
use tokio::net::TcpListener;

#[tokio::main]
async fn main() -> Result<()> {
    init_tracing();
    let config = Config::from_env().context("invalid configuration")?;
    if config.environment == "production" && config.storage_backend != StorageBackend::S3 {
        anyhow::bail!("STORAGE_BACKEND must be s3 when APP_ENV=production");
    }
    // Initialise the tokenizer before accepting requests so the first
    // outline/section read does not pay the one-time vocab load.
    let _ = agentry::tokens::count_tokens("warmup");

    let pool = db::connect(&config).await?;
    db::migrate(&pool).await?;
    let storage = StorageHandle::from_config(&config)?;
    let report = seed::seed(&pool, &storage, &config).await?;
    if report.revision_created {
        tracing::info!(
            project = %config.seed_default_project,
            revision = ?report.revision_id,
            "seeded default project"
        );
    }
    if report.user_created {
        tracing::warn!(
            username = %config.seed_admin_username,
            "seeded the initial administrator; change the password immediately"
        );
    }
    match agentry::content::retry_failed_token_counts(&pool).await {
        Ok(0) => {}
        Ok(count) => tracing::info!(count, "retried failed token counts"),
        Err(error) => tracing::warn!(%error, "token count retry failed"),
    }
    if let Err(error) = lifecycle::cleanup_expired_sessions(&AppState {
        db: pool.clone(),
        config: Arc::new(config.clone()),
        storage: storage.clone(),
    })
    .await
    {
        tracing::warn!(%error, "startup transfer-session cleanup failed");
    }

    let state = AppState {
        db: pool,
        config: Arc::new(config.clone()),
        storage,
    };
    lifecycle::spawn_cleanup(state.clone());
    let router = build_router(state);
    let listener = TcpListener::bind(&config.bind_addr)
        .await
        .with_context(|| format!("bind {}", config.bind_addr))?;
    tracing::info!(
        address = %listener.local_addr()?,
        public_url = %config.public_url,
        environment = %config.environment,
        "agentry listening"
    );
    axum::serve(listener, router)
        .with_graceful_shutdown(shutdown_signal())
        .await?;
    Ok(())
}

fn init_tracing() {
    use tracing_subscriber::EnvFilter;
    let filter = EnvFilter::try_from_default_env()
        .unwrap_or_else(|_| EnvFilter::new("info,agentry=debug,tower_http=info"));
    let json = std::env::var("LOG_FORMAT")
        .map(|v| v.eq_ignore_ascii_case("json"))
        .unwrap_or(false);
    if json {
        tracing_subscriber::fmt()
            .with_env_filter(filter)
            .json()
            .init();
    } else {
        tracing_subscriber::fmt().with_env_filter(filter).init();
    }
}

async fn shutdown_signal() {
    let ctrl_c = async {
        tokio::signal::ctrl_c()
            .await
            .expect("install Ctrl-C handler");
    };
    #[cfg(unix)]
    let terminate = async {
        tokio::signal::unix::signal(tokio::signal::unix::SignalKind::terminate())
            .expect("install SIGTERM handler")
            .recv()
            .await;
    };
    #[cfg(not(unix))]
    let terminate = std::future::pending::<()>();
    tokio::select! {
        _ = ctrl_c => {},
        _ = terminate => {},
    }
    tracing::info!("shutdown signal received");
}
