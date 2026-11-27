use std::env;
use std::time::Duration;

use anyhow::{Context, Result, bail};
use url::Url;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum StorageBackend {
    S3,
    Memory,
}

#[derive(Debug, Clone)]
pub struct OssConfig {
    pub endpoint: String,
    pub region: String,
    pub bucket: String,
    pub access_key_id: String,
    pub secret_access_key: String,
    pub virtual_host_style: bool,
    pub presign_ttl: Duration,
    pub bundle_ttl: Duration,
}

#[derive(Debug, Clone)]
pub struct Config {
    pub environment: String,
    pub database_url: String,
    pub bind_addr: String,
    pub public_url: String,
    pub static_dir: String,
    pub allowed_hosts: Vec<String>,
    pub storage_backend: StorageBackend,
    pub oss: Option<OssConfig>,
    pub transfer_ttl: Duration,
    pub max_upload_bytes: u64,
    pub web_session_ttl: Duration,
    pub seed_admin_username: String,
    pub seed_admin_password: String,
    pub seed_default_project: String,
    pub db_max_connections: u32,
}

fn var(name: &str) -> Option<String> {
    env::var(name)
        .ok()
        .map(|v| v.trim().to_string())
        .filter(|v| !v.is_empty())
}

fn var_or(name: &str, default: &str) -> String {
    var(name).unwrap_or_else(|| default.to_string())
}

fn parse_bool(name: &str, default: bool) -> Result<bool> {
    match var(name) {
        None => Ok(default),
        Some(v) => match v.to_ascii_lowercase().as_str() {
            "1" | "true" | "yes" | "on" => Ok(true),
            "0" | "false" | "no" | "off" => Ok(false),
            other => bail!("{name} must be a boolean, got {other:?}"),
        },
    }
}

fn parse_u64(name: &str, default: u64) -> Result<u64> {
    match var(name) {
        None => Ok(default),
        Some(v) => v
            .parse::<u64>()
            .with_context(|| format!("{name} must be a non-negative integer, got {v:?}")),
    }
}

impl Config {
    /// Load configuration from the environment. All validation happens here so
    /// the process fails before it can listen on a socket with a half-valid
    /// configuration.
    pub fn from_env() -> Result<Self> {
        let environment = var_or("APP_ENV", "development");
        let database_url =
            var("DATABASE_URL").ok_or_else(|| anyhow::anyhow!("DATABASE_URL is required"))?;
        let parsed_db = Url::parse(&database_url)
            .context("DATABASE_URL must be a valid URL (postgres://user:pass@host/db)")?;
        if !matches!(parsed_db.scheme(), "postgres" | "postgresql") {
            bail!("DATABASE_URL must use the postgres:// scheme");
        }

        let bind_addr = var_or("SERVER_ADDR", "0.0.0.0:8080");
        if bind_addr.parse::<std::net::SocketAddr>().is_err() {
            bail!("SERVER_ADDR must be host:port, got {bind_addr:?}");
        }

        let public_url = var_or("SERVER_PUBLIC_URL", "http://localhost:8080");
        let public = Url::parse(&public_url).context(
            "SERVER_PUBLIC_URL must be an absolute URL, e.g. https://registry.example.com",
        )?;
        if public.host_str().is_none() {
            bail!("SERVER_PUBLIC_URL must include a host");
        }

        let allowed_hosts = var("SERVER_ALLOWED_HOSTS")
            .map(|v| {
                v.split(',')
                    .map(|s| s.trim().to_string())
                    .filter(|s| !s.is_empty())
                    .collect::<Vec<_>>()
            })
            .unwrap_or_default();

        let storage_backend = match var_or("STORAGE_BACKEND", "s3")
            .to_ascii_lowercase()
            .as_str()
        {
            "s3" | "oss" => StorageBackend::S3,
            "memory" => StorageBackend::Memory,
            other => bail!("STORAGE_BACKEND must be s3 or memory, got {other:?}"),
        };

        let oss = if storage_backend == StorageBackend::S3 {
            let endpoint = var("OSS_ENDPOINT").ok_or_else(|| {
                anyhow::anyhow!("OSS_ENDPOINT is required when STORAGE_BACKEND=s3")
            })?;
            let endpoint_url = Url::parse(&endpoint).context(
                "OSS_ENDPOINT must be an absolute URL, e.g. https://oss-cn-hangzhou.aliyuncs.com",
            )?;
            if !matches!(endpoint_url.scheme(), "http" | "https") {
                bail!("OSS_ENDPOINT must use http:// or https://");
            }
            if endpoint_url.path() != "/" && !endpoint_url.path().is_empty() {
                bail!("OSS_ENDPOINT must not include a path");
            }
            let region = var("OSS_REGION")
                .ok_or_else(|| anyhow::anyhow!("OSS_REGION is required when STORAGE_BACKEND=s3"))?;
            let bucket = var("OSS_BUCKET")
                .ok_or_else(|| anyhow::anyhow!("OSS_BUCKET is required when STORAGE_BACKEND=s3"))?;
            if !bucket
                .chars()
                .all(|c| c.is_ascii_lowercase() || c.is_ascii_digit() || c == '-')
            {
                bail!("OSS_BUCKET may contain only lowercase letters, digits and dashes");
            }
            let access_key_id = var("OSS_ACCESS_KEY_ID").ok_or_else(|| {
                anyhow::anyhow!("OSS_ACCESS_KEY_ID is required when STORAGE_BACKEND=s3")
            })?;
            let secret_access_key = var("OSS_SECRET_ACCESS_KEY").ok_or_else(|| {
                anyhow::anyhow!("OSS_SECRET_ACCESS_KEY is required when STORAGE_BACKEND=s3")
            })?;
            let virtual_host_style = parse_bool("OSS_VIRTUAL_HOST_STYLE", true)?;
            let presign_ttl = Duration::from_secs(parse_u64("OSS_PRESIGN_TTL_SECONDS", 600)?);
            if !(60..=3600).contains(&presign_ttl.as_secs()) {
                bail!("OSS_PRESIGN_TTL_SECONDS must be between 60 and 3600");
            }
            let bundle_ttl = Duration::from_secs(parse_u64("BUNDLE_TTL_SECONDS", 900)?);
            if !(60..=3600).contains(&bundle_ttl.as_secs()) {
                bail!("BUNDLE_TTL_SECONDS must be between 60 and 3600");
            }
            Some(OssConfig {
                endpoint,
                region,
                bucket,
                access_key_id,
                secret_access_key,
                virtual_host_style,
                presign_ttl,
                bundle_ttl,
            })
        } else {
            None
        };

        let transfer_ttl = Duration::from_secs(parse_u64("TRANSFER_SESSION_TTL_SECONDS", 3600)?);
        if !(300..=86400).contains(&transfer_ttl.as_secs()) {
            bail!("TRANSFER_SESSION_TTL_SECONDS must be between 300 and 86400");
        }
        let max_upload_bytes = parse_u64("MAX_UPLOAD_BYTES", 64 * 1024 * 1024)?;
        if max_upload_bytes == 0 {
            bail!("MAX_UPLOAD_BYTES must be greater than zero");
        }
        let web_session_ttl = Duration::from_secs(parse_u64("WEB_SESSION_TTL_HOURS", 12)? * 3600);
        let db_max_connections = parse_u64("DATABASE_MAX_CONNECTIONS", 10)? as u32;
        if db_max_connections == 0 {
            bail!("DATABASE_MAX_CONNECTIONS must be greater than zero");
        }

        Ok(Self {
            environment,
            database_url,
            bind_addr,
            public_url: public_url.trim_end_matches('/').to_string(),
            static_dir: var_or("STATIC_DIR", "crates/server/static"),
            allowed_hosts,
            storage_backend,
            oss,
            transfer_ttl,
            max_upload_bytes,
            web_session_ttl,
            seed_admin_username: var_or("SEED_ADMIN_USERNAME", "admin"),
            seed_admin_password: var_or("SEED_ADMIN_PASSWORD", "admin"),
            seed_default_project: var_or("SEED_DEFAULT_PROJECT", "default"),
            db_max_connections,
        })
    }

    pub fn is_test(&self) -> bool {
        self.environment == "test"
    }
}
