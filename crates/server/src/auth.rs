use axum::extract::FromRequestParts;
use axum::http::request::Parts;
use chrono::{DateTime, Utc};
use sha2::{Digest, Sha256};
use sqlx::PgPool;
use uuid::Uuid;

use crate::AppState;
use crate::error::{AppError, Result};
use crate::seed::verify_password;

pub const SESSION_COOKIE: &str = "agentry_session";

#[derive(Debug, Clone, sqlx::FromRow)]
pub struct AuthKey {
    pub api_key_id: Uuid,
    pub user_id: Uuid,
    pub username: String,
    pub user_role: String,
    pub key_prefix: String,
    pub default_project_id: Option<Uuid>,
    pub is_global: bool,
    pub scopes: Vec<String>,
    pub expires_at: Option<DateTime<Utc>>,
    pub revoked_at: Option<DateTime<Utc>>,
}

impl AuthKey {
    pub fn has_scope(&self, scope: &str) -> bool {
        self.scopes.iter().any(|s| s == scope)
    }

    pub fn is_admin(&self) -> bool {
        self.scopes.iter().any(|s| s.starts_with("admin:"))
    }

    pub fn require_scope(&self, scope: &str) -> Result<(), AppError> {
        if self.has_scope(scope) {
            Ok(())
        } else {
            Err(AppError::forbidden(
                "INSUFFICIENT_SCOPE",
                format!("this API key does not carry the {scope} scope"),
            ))
        }
    }

    pub fn label(&self) -> String {
        format!("key:{}", self.key_prefix)
    }
}

#[derive(Debug, Clone, serde::Serialize, sqlx::FromRow)]
pub struct WebUser {
    pub id: Uuid,
    pub username: String,
    pub display_name: String,
    pub role: String,
}

impl WebUser {
    pub fn is_admin(&self) -> bool {
        matches!(self.role.as_str(), "superadmin" | "admin")
    }

    pub fn label(&self) -> String {
        format!("user:{}", self.username)
    }

    pub fn can_platform(&self) -> bool {
        self.role == "superadmin"
    }
}

pub fn sha256_hex(value: &[u8]) -> String {
    hex::encode(Sha256::digest(value))
}

/// Generate a high-entropy API key. Only the hash is stored; the plaintext is
/// returned exactly once to the caller that issued it.
pub fn generate_api_key() -> (String, String, String) {
    const ALPHABET: &[u8] = b"abcdefghijklmnopqrstuvwxyz0123456789";
    let random = rand::random::<[u8; 32]>();
    let prefix: String = random[..10]
        .iter()
        .map(|b| ALPHABET[*b as usize % ALPHABET.len()] as char)
        .collect();
    let secret = base64_url(&random[..32]);
    let key = format!("mreg_{prefix}_{secret}");
    let hash = sha256_hex(key.as_bytes());
    (key, prefix, hash)
}

pub fn base64_url(bytes: &[u8]) -> String {
    use base64::Engine;
    base64::engine::general_purpose::URL_SAFE_NO_PAD.encode(bytes)
}

pub fn key_prefix_from_token(token: &str) -> Option<&str> {
    let rest = token.strip_prefix("mreg_")?;
    // base64url secrets may contain `_`, so only split the first separator.
    let (prefix, secret) = rest.split_once('_')?;
    if prefix.len() != 10 || secret.len() < 16 || secret.contains(' ') {
        return None;
    }
    Some(prefix)
}

pub fn bearer_token(headers: &axum::http::HeaderMap) -> Option<String> {
    let value = headers
        .get(axum::http::header::AUTHORIZATION)?
        .to_str()
        .ok()?;
    let token = value
        .strip_prefix("Bearer ")
        .or_else(|| value.strip_prefix("bearer "))?;
    let token = token.trim();
    if token.is_empty() {
        return None;
    }
    Some(token.to_string())
}

/// Authenticate a Bearer API key. The key is looked up by prefix first (a
/// narrow index) and then verified by SHA-256; revoked or expired keys are
/// rejected exactly like unknown keys.
pub async fn authenticate_api_key(db: &PgPool, token: &str) -> Result<AuthKey> {
    let prefix = key_prefix_from_token(token)
        .ok_or_else(|| AppError::unauthorized("UNAUTHENTICATED", "invalid API key"))?;
    let hash = sha256_hex(token.as_bytes());
    let row = sqlx::query_as::<_, AuthKey>(
        r#"
        SELECT k.id AS api_key_id, k.user_id, u.username, u.role AS user_role,
               k.key_prefix, k.default_project_id, k.is_global, k.scopes,
               k.expires_at, k.revoked_at
        FROM api_keys k
        JOIN users u ON u.id = k.user_id
        WHERE k.key_prefix = $1 AND k.key_hash = $2
        "#,
    )
    .bind(prefix)
    .bind(hash)
    .fetch_optional(db)
    .await
    .map_err(AppError::from_db)?
    .ok_or_else(|| AppError::unauthorized("UNAUTHENTICATED", "invalid API key"))?;

    if row.revoked_at.is_some() {
        return Err(AppError::unauthorized("UNAUTHENTICATED", "invalid API key"));
    }
    if let Some(expires_at) = row.expires_at
        && expires_at <= Utc::now()
    {
        return Err(AppError::unauthorized("UNAUTHENTICATED", "invalid API key"));
    }
    Ok(row)
}

pub async fn touch_api_key(db: &PgPool, key_id: Uuid) {
    let pool = db.clone();
    tokio::spawn(async move {
        let _ = sqlx::query("UPDATE api_keys SET last_used_at = now() WHERE id = $1")
            .bind(key_id)
            .execute(&pool)
            .await;
    });
}

/// Issue a new API key. `plaintext` is returned to the caller and never
/// persisted.
pub async fn issue_api_key(
    db: &PgPool,
    user_id: Uuid,
    project_id: Option<Uuid>,
    name: &str,
    scopes: &[String],
    is_global: bool,
) -> Result<(Uuid, String)> {
    let mut last_error = None;
    for _ in 0..3 {
        let (plaintext, prefix, hash) = generate_api_key();
        let result: Result<Uuid, sqlx::Error> = sqlx::query_scalar(
            r#"
            INSERT INTO api_keys (user_id, name, key_prefix, key_hash, default_project_id, is_global, scopes)
            VALUES ($1, $2, $3, $4, $5, $6, $7)
            RETURNING id
            "#,
        )
        .bind(user_id)
        .bind(name)
        .bind(prefix)
        .bind(hash)
        .bind(project_id)
        .bind(is_global)
        .bind(scopes)
        .fetch_one(db)
        .await;
        match result {
            Ok(id) => return Ok((id, plaintext)),
            Err(error) => {
                let unique = matches!(&error, sqlx::Error::Database(db) if db.code().as_deref() == Some("23505"));
                if !unique {
                    return Err(AppError::from_db(error));
                }
                last_error = Some(error);
            }
        }
    }
    Err(AppError::internal(format!(
        "could not allocate a unique API key prefix after 3 attempts: {}",
        last_error.map(|e| e.to_string()).unwrap_or_default()
    )))
}

pub async fn login(db: &PgPool, username: &str, password: &str) -> Result<WebUser> {
    let row: Option<(Uuid, String, String, String, String)> = sqlx::query_as(
        "SELECT id, username, display_name, role, password_hash FROM users WHERE username = $1",
    )
    .bind(username)
    .fetch_optional(db)
    .await?;
    let Some((id, username, display_name, role, password_hash)) = row else {
        // Run a dummy verification to keep response time roughly constant.
        let _ = verify_password(
            password,
            "$argon2id$v=19$m=19456,t=2,p=1$c2FsdHNhbHRzYWx0$0",
        );
        return Err(AppError::unauthorized(
            "UNAUTHENTICATED",
            "invalid username or password",
        ));
    };
    if !verify_password(password, &password_hash) {
        return Err(AppError::unauthorized(
            "UNAUTHENTICATED",
            "invalid username or password",
        ));
    }
    Ok(WebUser {
        id,
        username,
        display_name,
        role,
    })
}

pub async fn create_session(
    db: &PgPool,
    user_id: Uuid,
    ttl: std::time::Duration,
) -> Result<String> {
    let token = base64_url(&rand::random::<[u8; 32]>());
    let hash = sha256_hex(token.as_bytes());
    let expires_at = Utc::now() + chrono::Duration::seconds(ttl.as_secs() as i64);
    sqlx::query("INSERT INTO web_sessions (user_id, token_hash, expires_at) VALUES ($1, $2, $3)")
        .bind(user_id)
        .bind(hash)
        .bind(expires_at)
        .execute(db)
        .await?;
    Ok(token)
}

pub fn session_cookie(token: &str, ttl: std::time::Duration, secure: bool) -> String {
    format!(
        "{SESSION_COOKIE}={token}; Path=/; HttpOnly; SameSite=Strict; Max-Age={}{}",
        ttl.as_secs(),
        if secure { "; Secure" } else { "" }
    )
}

pub fn clear_session_cookie() -> String {
    format!("{SESSION_COOKIE}=; Path=/; HttpOnly; SameSite=Strict; Max-Age=0")
}

pub fn cookie_value(headers: &axum::http::HeaderMap) -> Option<String> {
    let header = headers.get(axum::http::header::COOKIE)?.to_str().ok()?;
    for part in header.split(';') {
        let part = part.trim();
        if let Some(value) = part.strip_prefix(&format!("{SESSION_COOKIE}="))
            && !value.is_empty()
        {
            return Some(value.to_string());
        }
    }
    None
}

pub async fn logout(db: &PgPool, token: &str) -> Result<()> {
    let hash = sha256_hex(token.as_bytes());
    sqlx::query("DELETE FROM web_sessions WHERE token_hash = $1")
        .bind(hash)
        .execute(db)
        .await?;
    Ok(())
}

impl FromRequestParts<AppState> for WebUser {
    type Rejection = AppError;

    async fn from_request_parts(
        parts: &mut Parts,
        state: &AppState,
    ) -> Result<Self, Self::Rejection> {
        let token = cookie_value(&parts.headers)
            .ok_or_else(|| AppError::unauthorized("UNAUTHENTICATED", "web session required"))?;
        let hash = sha256_hex(token.as_bytes());
        let row = sqlx::query_as::<_, (Uuid, String, String, String)>(
            r#"
            SELECT u.id, u.username, u.display_name, u.role
            FROM web_sessions s JOIN users u ON u.id = s.user_id
            WHERE s.token_hash = $1 AND s.expires_at > now()
            "#,
        )
        .bind(hash)
        .fetch_optional(&state.db)
        .await
        .map_err(AppError::from_db)?
        .ok_or_else(|| AppError::unauthorized("UNAUTHENTICATED", "web session expired"))?;
        Ok(WebUser {
            id: row.0,
            username: row.1,
            display_name: row.2,
            role: row.3,
        })
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn generated_keys_have_prefix_and_do_not_expose_a_pattern() {
        let (key, prefix, hash) = generate_api_key();
        assert!(key.starts_with("mreg_"));
        assert_eq!(key_prefix_from_token(&key), Some(prefix.as_str()));
        assert_eq!(hash, sha256_hex(key.as_bytes()));
        assert_eq!(prefix.len(), 10);
        let (other, _, _) = generate_api_key();
        assert_ne!(key, other);
    }

    #[test]
    fn malformed_tokens_are_rejected_without_a_database_lookup() {
        assert!(key_prefix_from_token("mreg_short_x").is_none());
        assert!(key_prefix_from_token("Bearer something").is_none());
        assert!(key_prefix_from_token("mreg_abcdefghij_0123456789abcdef").is_some());
    }
}
