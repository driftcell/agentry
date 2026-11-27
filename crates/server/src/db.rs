use std::time::Duration;

use anyhow::{Context, Result};
use sqlx::PgPool;
use sqlx::postgres::PgPoolOptions;

use crate::config::Config;

pub async fn connect(config: &Config) -> Result<PgPool> {
    let pool = PgPoolOptions::new()
        .max_connections(config.db_max_connections)
        .acquire_timeout(Duration::from_secs(10))
        .connect(&config.database_url)
        .await
        .with_context(
            || "connect to PostgreSQL (check DATABASE_URL and that the server is running)",
        )?;
    sqlx::query("SELECT 1")
        .execute(&pool)
        .await
        .context("verify database connectivity")?;
    Ok(pool)
}

pub async fn migrate(pool: &PgPool) -> Result<()> {
    sqlx::migrate!("./migrations")
        .run(pool)
        .await
        .context("run SQL migrations")?;
    Ok(())
}

pub async fn health(pool: &PgPool) -> bool {
    sqlx::query_scalar::<_, i32>("SELECT 1")
        .fetch_one(pool)
        .await
        .is_ok()
}
