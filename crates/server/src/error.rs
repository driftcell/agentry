use axum::Json;
use axum::http::StatusCode;
use axum::response::{IntoResponse, Response};
use serde_json::json;

pub type Result<T, E = AppError> = std::result::Result<T, E>;

/// An API error that is safe to render to a client. Internal details are
/// logged by the conversion layer and never sent over the wire.
#[derive(Debug, Clone)]
pub struct AppError {
    pub status: StatusCode,
    pub code: &'static str,
    pub message: String,
}

impl AppError {
    pub fn new(status: StatusCode, code: &'static str, message: impl Into<String>) -> Self {
        Self {
            status,
            code,
            message: message.into(),
        }
    }

    pub fn bad_request(code: &'static str, message: impl Into<String>) -> Self {
        Self::new(StatusCode::BAD_REQUEST, code, message)
    }

    pub fn unauthorized(code: &'static str, message: impl Into<String>) -> Self {
        Self::new(StatusCode::UNAUTHORIZED, code, message)
    }

    pub fn forbidden(code: &'static str, message: impl Into<String>) -> Self {
        Self::new(StatusCode::FORBIDDEN, code, message)
    }

    pub fn not_found(code: &'static str, message: impl Into<String>) -> Self {
        Self::new(StatusCode::NOT_FOUND, code, message)
    }

    pub fn conflict(code: &'static str, message: impl Into<String>) -> Self {
        Self::new(StatusCode::CONFLICT, code, message)
    }

    pub fn internal(message: impl Into<String>) -> Self {
        tracing::error!(error = %message.into(), "internal error");
        Self::new(
            StatusCode::INTERNAL_SERVER_ERROR,
            "INTERNAL_ERROR",
            "internal server error",
        )
    }

    pub fn from_db(err: sqlx::Error) -> Self {
        tracing::error!(error = %err, "database error");
        Self::new(
            StatusCode::INTERNAL_SERVER_ERROR,
            "INTERNAL_ERROR",
            "internal server error",
        )
    }
}

impl std::fmt::Display for AppError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        write!(f, "{}: {}", self.code, self.message)
    }
}

impl std::error::Error for AppError {}

impl IntoResponse for AppError {
    fn into_response(self) -> Response {
        let body = Json(json!({
            "error": {
                "code": self.code,
                "message": self.message,
            }
        }));
        (self.status, body).into_response()
    }
}

impl From<sqlx::Error> for AppError {
    fn from(value: sqlx::Error) -> Self {
        match value {
            sqlx::Error::RowNotFound => {
                AppError::not_found("NOT_FOUND", "the requested resource does not exist")
            }
            other => AppError::from_db(other),
        }
    }
}

impl From<anyhow::Error> for AppError {
    fn from(value: anyhow::Error) -> Self {
        tracing::error!(error = %value, "internal error");
        AppError::new(
            StatusCode::INTERNAL_SERVER_ERROR,
            "INTERNAL_ERROR",
            "internal server error",
        )
    }
}

impl From<std::io::Error> for AppError {
    fn from(value: std::io::Error) -> Self {
        tracing::error!(error = %value, "io error");
        AppError::new(
            StatusCode::INTERNAL_SERVER_ERROR,
            "INTERNAL_ERROR",
            "internal server error",
        )
    }
}

/// Error returned inside an MCP tool result. Codes are stable and compact.
#[derive(Debug, Clone)]
pub struct ToolError {
    pub code: &'static str,
    pub message: String,
}

impl ToolError {
    pub fn new(code: &'static str, message: impl Into<String>) -> Self {
        Self {
            code,
            message: message.into(),
        }
    }

    pub fn bad_request(message: impl Into<String>) -> Self {
        Self::new("INVALID_ARGUMENT", message)
    }

    pub fn forbidden(message: impl Into<String>) -> Self {
        Self::new("FORBIDDEN", message)
    }

    pub fn not_found(message: impl Into<String>) -> Self {
        Self::new("NOT_FOUND", message)
    }

    pub fn conflict(message: impl Into<String>) -> Self {
        Self::new("CONFLICT", message)
    }

    pub fn internal(message: impl Into<String>) -> Self {
        tracing::error!(error = %message.into(), "tool internal error");
        Self::new("INTERNAL_ERROR", "internal error")
    }

    pub fn to_json(&self) -> serde_json::Value {
        json!({"error": {"code": self.code, "message": self.message}})
    }

    pub fn into_call_result(self) -> rmcp::model::CallToolResult {
        rmcp::model::CallToolResult::error(vec![rmcp::model::ContentBlock::text(
            self.to_json().to_string(),
        )])
    }
}

impl From<AppError> for ToolError {
    fn from(value: AppError) -> Self {
        if value.status.is_server_error() {
            tracing::error!(code = value.code, original = %value.message, "tool error mapped to internal");
            return ToolError::new("INTERNAL_ERROR", "internal error");
        }
        // Client-safe domain code and message are preserved so agents can see
        // REVISION_STALE, REVISION_STATE, PROJECT_ACCESS_DENIED, etc.
        ToolError::new(value.code, value.message)
    }
}
