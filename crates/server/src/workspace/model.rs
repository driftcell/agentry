use serde::Serialize;

use crate::error::ToolError;

#[derive(Debug, Clone)]
pub struct WorkspaceFile {
    pub path: String,
    pub blob_id: uuid::Uuid,
    pub sha256: String,
    pub size_bytes: i64,
    pub is_text: bool,
    pub media_type: String,
    pub token_count: Option<i32>,
    pub description: String,
}

#[derive(Debug, Clone, Serialize)]
pub struct WorkspaceSummary {
    pub project: String,
    pub revision_id: Option<uuid::Uuid>,
    pub files: usize,
    pub tokens: i64,
    pub tree: String,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum KindFilter {
    All,
    Root,
    Claude,
    Agents,
    Skills,
    Subagents,
}

impl KindFilter {
    pub fn parse(value: Option<&str>) -> Result<Self, ToolError> {
        match value.unwrap_or("all").trim().to_ascii_lowercase().as_str() {
            "all" | "" => Ok(Self::All),
            "root" => Ok(Self::Root),
            "claude" => Ok(Self::Claude),
            "agents" | "agents-md" => Ok(Self::Agents),
            "skills" => Ok(Self::Skills),
            "subagents" | "agents-dir" => Ok(Self::Subagents),
            other => Err(ToolError::bad_request(format!(
                "kind_filter must be one of all, root, claude, agents, skills, subagents (got {other:?})"
            ))),
        }
    }

    pub(super) fn matches(self, path: &str) -> bool {
        match self {
            Self::All => true,
            Self::Root => !path.contains('/'),
            Self::Claude => path == "CLAUDE.md" || path.ends_with("/CLAUDE.md"),
            Self::Agents => path == "AGENTS.md" || path.ends_with("/AGENTS.md"),
            Self::Skills => path.starts_with("skills/"),
            Self::Subagents => path.starts_with("agents/"),
        }
    }
}
