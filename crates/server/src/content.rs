use anyhow::{Context, Result};
use bytes::Bytes;
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use sqlx::PgPool;
use uuid::Uuid;

use crate::markdown::{Outline, parse_markdown};
use crate::paths::blob_key;
use crate::tokens::try_count_tokens;

#[derive(Debug, Clone, sqlx::FromRow)]
pub struct ContentBlob {
    pub id: Uuid,
    pub sha256: String,
    pub size_bytes: i64,
    pub media_type: String,
    pub is_text: bool,
    pub text_content: Option<String>,
    pub object_key: Option<String>,
    pub token_count: Option<i32>,
    pub token_status: String,
    pub token_error: Option<String>,
    pub outline: Option<sqlx::types::Json<Outline>>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct IngestResult {
    pub id: Uuid,
    pub sha256: String,
    pub size_bytes: i64,
    pub media_type: String,
    pub is_text: bool,
    pub token_count: Option<i32>,
    pub token_status: String,
}

impl From<&ContentBlob> for IngestResult {
    fn from(blob: &ContentBlob) -> Self {
        Self {
            id: blob.id,
            sha256: blob.sha256.clone(),
            size_bytes: blob.size_bytes,
            media_type: blob.media_type.clone(),
            is_text: blob.is_text,
            token_count: blob.token_count,
            token_status: blob.token_status.clone(),
        }
    }
}

pub fn sha256_hex(bytes: &[u8]) -> String {
    let hash = Sha256::digest(bytes);
    hex::encode(hash)
}

pub fn media_type_for_path(path: &str, declared: Option<&str>) -> String {
    if let Some(declared) = declared {
        if !declared.trim().is_empty() {
            return declared.trim().to_ascii_lowercase();
        }
    }
    let lower = path.to_ascii_lowercase();
    if lower.ends_with(".md") || lower.ends_with(".markdown") {
        return "text/markdown".into();
    }
    mime_guess::from_path(path)
        .first_or_octet_stream()
        .essence_str()
        .to_string()
}

pub fn is_text_media_type(media_type: &str) -> bool {
    let media_type = media_type.split(';').next().unwrap_or(media_type).trim();
    media_type.starts_with("text/")
        || matches!(
            media_type,
            "application/json"
                | "application/xml"
                | "application/javascript"
                | "application/x-yaml"
                | "application/yaml"
                | "application/toml"
                | "application/x-sh"
                | "application/sql"
                | "image/svg+xml"
        )
}

pub fn is_markdown_path(path: &str) -> bool {
    let lower = path.to_ascii_lowercase();
    lower.ends_with(".md") || lower.ends_with(".markdown")
}

/// Ingest bytes into the content-addressed store. The returned blob is the
/// canonical row; identical content always maps to the same row, which keeps
/// revisions immutable and avoids duplicate token work.
pub async fn ingest_bytes(
    db: &PgPool,
    storage: &crate::storage::StorageHandle,
    path: &str,
    declared_media_type: Option<&str>,
    bytes: &[u8],
) -> Result<ContentBlob> {
    let sha256 = sha256_hex(bytes);
    if let Some(existing) = blob_by_sha(db, &sha256).await? {
        return Ok(existing);
    }

    let media_type = media_type_for_path(path, declared_media_type);
    let text = if is_text_media_type(&media_type) {
        std::str::from_utf8(bytes).ok().map(|s| s.to_string())
    } else {
        None
    };
    let is_text = text.is_some();
    let (token_count, token_status, token_error, outline) = if let Some(text) = &text {
        match try_count_tokens(text) {
            Ok(count) => {
                let outline = is_markdown_path(path)
                    .then(|| sqlx::types::Json(parse_markdown(text).outline));
                (Some(count as i32), "ok".to_string(), None, outline)
            }
            Err(error) => (None, "failed".to_string(), Some(error), None),
        }
    } else {
        (None, "ok".to_string(), None, None)
    };

    let object_key = if is_text {
        None
    } else {
        let key = blob_key(&sha256);
        storage
            .put(&key, Bytes::copy_from_slice(bytes))
            .await
            .with_context(|| format!("upload blob {sha256}"))?;
        Some(key)
    };

    let inserted = sqlx::query_as::<_, ContentBlob>(
        r#"
        INSERT INTO content_blobs
            (sha256, size_bytes, media_type, is_text, text_content, object_key,
             token_count, token_status, token_error, outline)
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
        ON CONFLICT (sha256) DO NOTHING
        RETURNING id, sha256, size_bytes, media_type, is_text, text_content,
                  object_key, token_count, token_status, token_error, outline
        "#,
    )
    .bind(&sha256)
    .bind(bytes.len() as i64)
    .bind(&media_type)
    .bind(is_text)
    .bind(&text)
    .bind(&object_key)
    .bind(token_count)
    .bind(&token_status)
    .bind(&token_error)
    .bind(outline.as_ref())
    .fetch_optional(db)
    .await
    .context("insert content blob")?;

    if let Some(blob) = inserted {
        return Ok(blob);
    }
    // A concurrent ingest won the race; reuse the existing canonical row.
    blob_by_sha(db, &sha256)
        .await?
        .ok_or_else(|| anyhow::anyhow!("blob {sha256} vanished after conflict"))
}

pub async fn blob_by_sha(db: &PgPool, sha256: &str) -> Result<Option<ContentBlob>> {
    let blob = sqlx::query_as::<_, ContentBlob>(
        r#"
        SELECT id, sha256, size_bytes, media_type, is_text, text_content,
               object_key, token_count, token_status, token_error, outline
        FROM content_blobs WHERE sha256 = $1
        "#,
    )
    .bind(sha256)
    .fetch_optional(db)
    .await?;
    Ok(blob)
}

pub async fn blob_by_id(db: &PgPool, id: Uuid) -> Result<Option<ContentBlob>> {
    let blob = sqlx::query_as::<_, ContentBlob>(
        r#"
        SELECT id, sha256, size_bytes, media_type, is_text, text_content,
               object_key, token_count, token_status, token_error, outline
        FROM content_blobs WHERE id = $1
        "#,
    )
    .bind(id)
    .fetch_optional(db)
    .await?;
    Ok(blob)
}

pub async fn read_blob_text(db: &PgPool, blob_id: Uuid) -> Result<Option<String>> {
    let text: Option<String> =
        sqlx::query_scalar("SELECT text_content FROM content_blobs WHERE id = $1")
            .bind(blob_id)
            .fetch_optional(db)
            .await?;
    Ok(text)
}

/// Retry token counting for blobs whose ingest count failed. Returns the
/// number of rows updated. This is deliberately explicit (called at startup
/// and from tests) rather than silently recalculating on every read.
pub async fn retry_failed_token_counts(db: &PgPool) -> Result<u64> {
    let rows = sqlx::query_as::<_, (Uuid, Option<String>, bool)>(
        "SELECT id, text_content, is_text FROM content_blobs WHERE token_status = 'failed'",
    )
    .fetch_all(db)
    .await?;
    let mut updated = 0u64;
    for (id, text, is_text) in rows {
        if !is_text {
            continue;
        }
        let Some(text) = text else { continue };
        match try_count_tokens(&text) {
            Ok(count) => {
                sqlx::query(
                    "UPDATE content_blobs SET token_count = $2, token_status = 'ok', token_error = NULL WHERE id = $1",
                )
                .bind(id)
                .bind(count as i32)
                .execute(db)
                .await?;
                updated += 1;
            }
            Err(error) => {
                sqlx::query("UPDATE content_blobs SET token_error = $2 WHERE id = $1")
                    .bind(id)
                    .bind(error)
                    .execute(db)
                    .await?;
            }
        }
    }
    Ok(updated)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn media_types_are_stable_for_markdown_and_binaries() {
        assert_eq!(media_type_for_path("CLAUDE.md", None), "text/markdown");
        assert_eq!(media_type_for_path("skills/x/SKILL.md", None), "text/markdown");
        assert_eq!(media_type_for_path("assets/logo.png", None), "image/png");
        assert_eq!(
            media_type_for_path("data.bin", Some("application/octet-stream")),
            "application/octet-stream"
        );
        assert!(is_text_media_type("text/markdown"));
        assert!(is_text_media_type("application/json; charset=utf-8"));
        assert!(!is_text_media_type("image/png"));
    }

    #[test]
    fn sha256_matches_the_known_vector() {
        assert_eq!(
            sha256_hex(b"abc"),
            "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad"
        );
    }
}
