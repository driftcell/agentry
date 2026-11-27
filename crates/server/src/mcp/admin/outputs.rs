use askama::Template;
use chrono::{DateTime, Utc};
use schemars::JsonSchema;
use serde::Serialize;
use uuid::Uuid;

use crate::revisions::ConflictView;

#[derive(Debug, Clone, Serialize, JsonSchema)]
pub(super) struct StagedUploadView {
    pub path: String,
    pub method: String,
    pub url: String,
    pub content_type: String,
}

#[derive(Debug, Clone, Serialize, JsonSchema, Template)]
#[template(path = "mcp/stage_upload_urls.md", escape = "none")]
pub(super) struct StageOutput {
    pub session_id: String,
    pub session_uuid: Uuid,
    pub project: String,
    pub expires_at: String,
    pub uploads: Vec<StagedUploadView>,
    pub command: String,
    pub next: String,
}

#[derive(Debug, Clone, Serialize, JsonSchema, Template)]
#[template(path = "mcp/propose_revision.md", escape = "none")]
pub(super) struct ProposeOutput {
    pub revision_id: String,
    pub revision_uuid: Uuid,
    pub project: String,
    pub status: String,
    pub commit_message: String,
    pub token_added: i32,
    pub token_removed: i32,
    pub file_count: i32,
    pub conflicts: Vec<ConflictView>,
    pub next: String,
}

#[derive(Debug, Clone, Serialize, JsonSchema)]
pub(super) struct ConflictPreview {
    pub path: String,
    pub hunk_text: String,
}

#[derive(Debug, Clone, Serialize, JsonSchema, Template)]
#[template(path = "mcp/check_review_status.md", escape = "none")]
pub(super) struct ReviewStatusOutput {
    pub revision_id: String,
    pub revision_uuid: Uuid,
    pub status: String,
    pub commit_message: String,
    pub comment: Option<String>,
    pub reviewer: Option<String>,
    pub token_added: i32,
    pub token_removed: i32,
    pub total_tokens: i64,
    pub stale: bool,
    pub conflicts: Vec<ConflictView>,
    #[serde(skip_serializing_if = "Vec::is_empty")]
    pub conflict_previews: Vec<ConflictPreview>,
}

#[derive(Debug, Clone, Serialize, JsonSchema, Template)]
#[template(path = "mcp/rebase_revision.md", escape = "none")]
pub(super) struct RebaseOutput {
    pub revision_id: String,
    pub revision_uuid: Uuid,
    pub status: String,
    pub token_added: i32,
    pub token_removed: i32,
    pub total_tokens: i64,
    pub stale: bool,
    pub next: String,
}

#[derive(Debug, Clone, Serialize, JsonSchema, Template)]
#[template(path = "mcp/activate_revision.md", escape = "none")]
pub(super) struct ActivateOutput {
    pub revision_id: String,
    pub revision_uuid: Uuid,
    pub project: String,
    pub status: String,
    pub activated_at: Option<String>,
}

#[derive(Debug, Clone, Serialize, JsonSchema, Template)]
#[template(path = "mcp/resolve_conflict.md", escape = "none")]
pub(super) struct ResolveOutput {
    pub revision_id: String,
    pub revision_uuid: Uuid,
    pub status: String,
    pub token_added: i32,
    pub token_removed: i32,
    pub next: String,
}

#[derive(Debug, Clone, Serialize, JsonSchema)]
pub(super) struct PlatformUserView {
    pub id: Uuid,
    pub username: String,
    pub display_name: String,
    pub role: String,
    pub created_at: DateTime<Utc>,
}

#[derive(Debug, Clone, Serialize, JsonSchema, Template, Default)]
#[template(path = "mcp/manage_platform.md", escape = "none")]
pub(super) struct PlatformOutput {
    #[serde(skip)]
    pub action: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub project_id: Option<Uuid>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub slug: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub name: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub active_revision: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub api_key_id: Option<Uuid>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub api_key: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub project: Option<Option<String>>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub is_global: Option<bool>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub scopes: Option<Vec<String>>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub warning: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub revoked: Option<bool>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub deleted: Option<bool>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub users: Option<Vec<PlatformUserView>>,
}

impl PlatformOutput {
    pub fn scopes_csv(&self) -> String {
        self.scopes
            .as_ref()
            .map(|s| s.join(", "))
            .unwrap_or_default()
    }
}
