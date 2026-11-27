use std::collections::HashMap;
use std::sync::Arc;
use std::time::{Duration, SystemTime, UNIX_EPOCH};

use anyhow::{Context, Result, anyhow};
use bytes::Bytes;

use object_store::aws::AmazonS3Builder;
use object_store::ObjectStoreExt;
use object_store::path::Path as ObjectPath;
use sha2::{Digest, Sha256};
use tokio::sync::RwLock;
use url::Url;

use crate::config::{Config, OssConfig, StorageBackend};

/// A concrete storage client. This is deliberately an enum rather than a
/// trait object: native async fn in traits is not dyn-compatible, and the two
/// backends are the entire supported set.
#[derive(Clone)]
pub struct StorageHandle {
    backend: Backend,
    memory: Option<Arc<MemoryStorage>>,
}

#[derive(Clone)]
enum Backend {
    S3(Arc<S3Storage>),
    Memory(Arc<MemoryStorage>),
}

impl std::fmt::Debug for StorageHandle {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        let name = match self.backend {
            Backend::S3(_) => "s3",
            Backend::Memory(_) => "memory",
        };
        f.debug_struct("StorageHandle").field("backend", &name).finish()
    }
}

impl StorageHandle {
    pub fn from_config(config: &Config) -> Result<Self> {
        match config.storage_backend {
            StorageBackend::Memory => {
                let memory = Arc::new(MemoryStorage::new(config.public_url.clone()));
                Ok(Self {
                    backend: Backend::Memory(memory.clone()),
                    memory: Some(memory),
                })
            }
            StorageBackend::S3 => {
                let oss = config
                    .oss
                    .as_ref()
                    .ok_or_else(|| anyhow!("OSS configuration missing"))?;
                let client = Arc::new(S3Storage { client: Arc::new(build_s3(oss)?) });
                Ok(Self { backend: Backend::S3(client), memory: None })
            }
        }
    }

    pub async fn put(&self, key: &str, bytes: Bytes) -> Result<()> {
        match &self.backend {
            Backend::S3(s3) => s3.put(key, bytes).await,
            Backend::Memory(memory) => memory.put(key, bytes).await,
        }
    }

    pub async fn get(&self, key: &str) -> Result<Bytes> {
        match &self.backend {
            Backend::S3(s3) => s3.get(key).await,
            Backend::Memory(memory) => memory.get(key).await,
        }
    }

    pub async fn delete(&self, key: &str) -> Result<()> {
        match &self.backend {
            Backend::S3(s3) => s3.delete(key).await,
            Backend::Memory(memory) => memory.delete(key).await,
        }
    }

    pub async fn presign_get(&self, key: &str, ttl: Duration) -> Result<String> {
        match &self.backend {
            Backend::S3(s3) => s3.presign_get(key, ttl).await,
            Backend::Memory(memory) => memory.signed_url("GET", key, ttl),
        }
    }

    pub async fn presign_put(&self, key: &str, ttl: Duration) -> Result<String> {
        match &self.backend {
            Backend::S3(s3) => s3.presign_put(key, ttl).await,
            Backend::Memory(memory) => memory.signed_url("PUT", key, ttl),
        }
    }

    pub fn memory(&self) -> Option<Arc<MemoryStorage>> {
        self.memory.clone()
    }

    pub fn is_memory(&self) -> bool {
        self.memory.is_some()
    }
}

struct S3Storage {
    client: Arc<object_store::aws::AmazonS3>,
}

impl S3Storage {
    async fn put(&self, key: &str, bytes: Bytes) -> Result<()> {
        self.client
            .put(&ObjectPath::from(key), bytes.into())
            .await
            .with_context(|| format!("upload object {key}"))?;
        Ok(())
    }

    async fn get(&self, key: &str) -> Result<Bytes> {
        let result = self
            .client
            .get(&ObjectPath::from(key))
            .await
            .with_context(|| format!("download object {key}"))?;
        result.bytes().await.with_context(|| format!("read object body {key}"))
    }

    async fn delete(&self, key: &str) -> Result<()> {
        self.client
            .delete(&ObjectPath::from(key))
            .await
            .with_context(|| format!("delete object {key}"))?;
        Ok(())
    }

    async fn presign_get(&self, key: &str, ttl: Duration) -> Result<String> {
        use object_store::signer::Signer;
        let url = self
            .client
            .signed_url(http::Method::GET, &ObjectPath::from(key), ttl)
            .await
            .with_context(|| format!("sign GET {key}"))?;
        Ok(url.to_string())
    }

    async fn presign_put(&self, key: &str, ttl: Duration) -> Result<String> {
        use object_store::signer::Signer;
        let url = self
            .client
            .signed_url(http::Method::PUT, &ObjectPath::from(key), ttl)
            .await
            .with_context(|| format!("sign PUT {key}"))?;
        Ok(url.to_string())
    }
}

/// In-process object storage used by tests and local development. It still
/// exercises the full presigned URL lifecycle through `/__oss/{key}` routes,
/// but is never selected in production configuration.
#[derive(Debug)]
pub struct MemoryStorage {
    objects: RwLock<HashMap<String, Bytes>>,
    secret: [u8; 32],
    public_base: String,
}

impl MemoryStorage {
    fn new(public_base: String) -> Self {
        let mut secret = [0u8; 32];
        for (i, byte) in secret.iter_mut().enumerate() {
            *byte = (i as u8).wrapping_mul(37).wrapping_add(11);
        }
        Self { objects: RwLock::new(HashMap::new()), secret, public_base }
    }

    fn signature(&self, method: &str, key: &str, expires: u64) -> String {
        let mut hasher = Sha256::new();
        hasher.update(self.secret);
        hasher.update(method.as_bytes());
        hasher.update(b"\n");
        hasher.update(key.as_bytes());
        hasher.update(b"\n");
        hasher.update(expires.to_string().as_bytes());
        hex::encode(hasher.finalize())
    }

    fn signed_url(&self, method: &str, key: &str, ttl: Duration) -> Result<String> {
        let expires = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap_or_default()
            .as_secs()
            + ttl.as_secs();
        let sig = self.signature(method, key, expires);
        let encoded = key
            .split('/')
            .map(urlencoding)
            .collect::<Vec<_>>()
            .join("/");
        Ok(format!(
            "{}/__oss/{encoded}?expires={expires}&sig={sig}",
            self.public_base
        ))
    }

    pub fn verify(&self, method: &str, key: &str, expires: u64, sig: &str) -> bool {
        let now = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap_or_default()
            .as_secs();
        if expires < now {
            return false;
        }
        let expected = self.signature(method, key, expires);
        if expected.len() != sig.len() {
            return false;
        }
        expected
            .bytes()
            .zip(sig.bytes())
            .fold(0u8, |acc, (a, b)| acc | (a ^ b))
            == 0
    }

    async fn put(&self, key: &str, bytes: Bytes) -> Result<()> {
        self.objects.write().await.insert(key.to_string(), bytes);
        Ok(())
    }

    async fn get(&self, key: &str) -> Result<Bytes> {
        self.objects
            .read()
            .await
            .get(key)
            .cloned()
            .ok_or_else(|| anyhow!("object {key} not found"))
    }

    async fn delete(&self, key: &str) -> Result<()> {
        self.objects.write().await.remove(key);
        Ok(())
    }
}

fn urlencoding(value: &str) -> String {
    use percent_encoding::{NON_ALPHANUMERIC, utf8_percent_encode};
    utf8_percent_encode(value, NON_ALPHANUMERIC).to_string()
}

fn build_s3(oss: &OssConfig) -> Result<object_store::aws::AmazonS3> {
    let allow_http = Url::parse(&oss.endpoint)
        .map(|u| u.scheme() == "http")
        .unwrap_or(false);
    let client = AmazonS3Builder::new()
        .with_bucket_name(&oss.bucket)
        .with_region(&oss.region)
        .with_endpoint(&oss.endpoint)
        .with_access_key_id(&oss.access_key_id)
        .with_secret_access_key(&oss.secret_access_key)
        .with_virtual_hosted_style_request(oss.virtual_host_style)
        .with_allow_http(allow_http)
        .build()
        .context("build S3 compatible client")?;
    Ok(client)
}
