use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use serde_json::Value;
use uuid::Uuid;

use crate::auth::WebUser;
use crate::content::ContentBlob;
use crate::error::ToolError;
use crate::project::{Project, ProjectContext};

pub const STATUS_PENDING: &str = "pending_review";
pub const STATUS_APPROVED: &str = "approved";
pub const STATUS_REJECTED: &str = "rejected";
pub const STATUS_CONFLICT: &str = "conflict";
pub const STATUS_ACTIVE: &str = "active";
pub const STATUS_SUPERSEDED: &str = "superseded";

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum RevisionStatus {
    PendingReview,
    Approved,
    Rejected,
    Conflict,
    Active,
    Superseded,
}

impl RevisionStatus {
    pub fn parse(value: &str) -> Option<Self> {
        match value {
            STATUS_PENDING => Some(Self::PendingReview),
            STATUS_APPROVED => Some(Self::Approved),
            STATUS_REJECTED => Some(Self::Rejected),
            STATUS_CONFLICT => Some(Self::Conflict),
            STATUS_ACTIVE => Some(Self::Active),
            STATUS_SUPERSEDED => Some(Self::Superseded),
            _ => None,
        }
    }

    pub fn as_str(self) -> &'static str {
        match self {
            Self::PendingReview => STATUS_PENDING,
            Self::Approved => STATUS_APPROVED,
            Self::Rejected => STATUS_REJECTED,
            Self::Conflict => STATUS_CONFLICT,
            Self::Active => STATUS_ACTIVE,
            Self::Superseded => STATUS_SUPERSEDED,
        }
    }

    /// The only transitions the domain permits. Activation and supersession
    /// are system transitions performed inside the activation transaction.
    pub fn can_transition_to(self, next: Self) -> bool {
        matches!(
            (self, next),
            (Self::PendingReview, Self::Approved)
                | (Self::PendingReview, Self::Rejected)
                | (Self::Conflict, Self::PendingReview)
                | (Self::Conflict, Self::Rejected)
                | (Self::Approved, Self::Active)
                | (Self::Active, Self::Superseded)
        )
    }
}

#[derive(Debug, Clone, Serialize, sqlx::FromRow)]
pub struct Revision {
    pub id: Uuid,
    pub project_id: Uuid,
    pub base_revision_id: Option<Uuid>,
    pub merged_against_revision_id: Option<Uuid>,
    pub status: String,
    pub commit_message: String,
    pub author_user_id: Option<Uuid>,
    pub author_api_key_id: Option<Uuid>,
    pub token_added: i32,
    pub token_removed: i32,
    pub total_tokens: i64,
    pub file_count: i32,
    pub conflict_summary: Option<sqlx::types::Json<Value>>,
    pub review_comment: Option<String>,
    pub reviewed_by: Option<Uuid>,
    pub reviewed_at: Option<DateTime<Utc>>,
    pub activated_at: Option<DateTime<Utc>>,
    pub created_at: DateTime<Utc>,
    pub updated_at: DateTime<Utc>,
}

#[derive(Debug, Clone, Serialize, sqlx::FromRow)]
pub struct RevisionFileView {
    pub path: String,
    pub change_type: String,
    pub token_delta: i32,
    pub token_count: i32,
    pub is_text: bool,
    pub size_bytes: i64,
    pub blob_id: Uuid,
    pub sha256: String,
    pub previous_sha256: Option<String>,
    pub base_sha256: Option<String>,
    pub active_sha256: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ConflictDetail {
    pub path: String,
    pub hunks: usize,
    pub lines: Vec<usize>,
    pub base_sha256: Option<String>,
    pub active_sha256: Option<String>,
    pub incoming_sha256: Option<String>,
    pub merged_sha256: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub preview: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
pub struct ConflictView {
    pub path: String,
    pub hunks: usize,
    pub lines: Vec<usize>,
}

impl From<&ConflictDetail> for ConflictView {
    fn from(detail: &ConflictDetail) -> Self {
        Self {
            path: detail.path.clone(),
            hunks: detail.hunks,
            lines: detail.lines.clone(),
        }
    }
}

#[derive(Debug, Clone, Serialize)]
pub struct ProposalOutcome {
    pub revision: Revision,
    pub conflicts: Vec<ConflictView>,
}

#[derive(Debug, Clone)]
pub struct Actor {
    pub user_id: Option<Uuid>,
    pub api_key_id: Option<Uuid>,
    pub label: String,
}

impl Actor {
    pub fn from_web(user: &WebUser) -> Self {
        Self {
            user_id: Some(user.id),
            api_key_id: None,
            label: user.label(),
        }
    }

    pub fn from_mcp(ctx: &ProjectContext) -> Self {
        Self {
            user_id: Some(ctx.key.user_id),
            api_key_id: Some(ctx.key.api_key_id),
            label: ctx.key.label(),
        }
    }
}

#[derive(Debug, Clone)]
pub struct ProposedFile {
    pub path: String,
    pub media_type: Option<String>,
    pub bytes: Vec<u8>,
}

#[derive(Debug, Clone)]
pub enum ProposedChange {
    Upsert(ProposedFile),
    Delete(String),
}

#[derive(Debug, Clone)]
pub struct Resolution {
    pub path: String,
    pub content: Option<String>,
    pub oss_key: Option<String>,
}

/// Load the files present in a revision snapshot. Deleted rows are part of the
/// diff history but are not part of the current tree.
pub fn revision_is_stale(project: &Project, revision: &Revision) -> bool {
    revision.merged_against_revision_id != project.active_revision_id
}

pub fn ensure_revision_project(revision: &Revision, project: &Project) -> Result<(), ToolError> {
    if revision.project_id == project.id {
        Ok(())
    } else {
        Err(ToolError::not_found("revision not found"))
    }
}

pub(super) fn sha_of(blob: Option<&ContentBlob>) -> Option<String> {
    blob.map(|b| b.sha256.clone())
}

pub(super) fn tokens_of(blob: Option<&ContentBlob>) -> i32 {
    blob.and_then(|b| b.token_count).unwrap_or(0)
}

pub(super) fn is_text(blob: &ContentBlob) -> bool {
    blob.is_text
}
