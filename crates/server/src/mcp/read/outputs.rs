use askama::Template;
use schemars::JsonSchema;
use serde::Serialize;
use uuid::Uuid;

#[derive(Debug, Clone, Serialize, JsonSchema, Template)]
#[template(path = "mcp/inspect_workspace.md", escape = "none")]
pub(super) struct InspectOutput {
    pub project: String,
    pub revision: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub revision_uuid: Option<Uuid>,
    pub files: usize,
    pub tokens: i64,
    pub tree: String,
}

#[derive(Debug, Clone, Serialize, JsonSchema, Template)]
#[template(path = "mcp/read_slice.md", escape = "none")]
pub(super) struct ReadSliceOutput {
    pub path: String,
    pub mode: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub section: Option<String>,
    pub tokens: usize,
    pub file_tokens: i32,
    pub truncated: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub max_tokens: Option<usize>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub sections: Option<usize>,
    pub content: String,
}

#[derive(Debug, Clone, Serialize, JsonSchema, Template)]
#[template(path = "mcp/pull_bundle.md", escape = "none")]
pub(super) struct PullBundleOutput {
    pub format: String,
    pub url: String,
    pub expires_at: String,
    pub files: Vec<String>,
    pub file_count: usize,
    pub bytes: u64,
    pub tokens: i64,
    pub local_target_dir: String,
    pub command: String,
}
