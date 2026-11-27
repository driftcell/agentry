use schemars::JsonSchema;
use serde::Deserialize;
#[derive(Debug, Deserialize, JsonSchema)]
#[serde(deny_unknown_fields)]
pub(super) struct StageArgs {
    #[serde(default, alias = "project")]
    pub(super) project_slug: Option<String>,
    pub(super) files: Vec<StageFile>,
}

#[derive(Debug, Deserialize, JsonSchema)]
#[serde(deny_unknown_fields)]
pub(super) struct StageFile {
    pub(super) remote_path: String,
    #[serde(default)]
    pub(super) local_path_hint: Option<String>,
    #[serde(default)]
    pub(super) content_type: Option<String>,
    #[serde(default)]
    pub(super) expected_sha256: Option<String>,
    #[serde(default)]
    pub(super) expected_size: Option<i64>,
}

#[derive(Debug, Deserialize, JsonSchema)]
#[serde(deny_unknown_fields)]
pub(super) struct ProposeArgs {
    #[serde(default, alias = "project")]
    pub(super) project_slug: Option<String>,
    #[serde(default)]
    pub(super) session_id: Option<String>,
    #[serde(default)]
    pub(super) inline_patches: Option<Vec<InlinePatch>>,
    #[serde(default)]
    pub(super) deletions: Option<Vec<String>>,
    #[serde(default)]
    pub(super) base_revision_id: Option<String>,
    pub(super) commit_message: String,
}

#[derive(Debug, Deserialize, JsonSchema)]
#[serde(deny_unknown_fields)]
pub(super) struct InlinePatch {
    pub(super) path: String,
    pub(super) content: String,
    #[serde(default)]
    pub(super) content_type: Option<String>,
    #[serde(default)]
    pub(super) base_sha256: Option<String>,
}

#[derive(Debug, Deserialize, JsonSchema)]
#[serde(deny_unknown_fields)]
pub(super) struct StatusArgs {
    #[serde(default, alias = "project")]
    pub(super) project_slug: Option<String>,
    pub(super) revision_id: String,
}

#[derive(Debug, Deserialize, JsonSchema)]
#[serde(deny_unknown_fields)]
pub(super) struct ActivateArgs {
    #[serde(default, alias = "project")]
    pub(super) project_slug: Option<String>,
    pub(super) revision_id: String,
}

#[derive(Debug, Deserialize, JsonSchema)]
#[serde(deny_unknown_fields)]
pub(super) struct RebaseArgs {
    #[serde(default, alias = "project")]
    pub(super) project_slug: Option<String>,
    pub(super) revision_id: String,
}

#[derive(Debug, Deserialize, JsonSchema)]
#[serde(deny_unknown_fields)]
pub(super) struct ResolveArgs {
    #[serde(default, alias = "project")]
    pub(super) project_slug: Option<String>,
    pub(super) revision_id: String,
    pub(super) resolutions: Vec<ResolutionInput>,
    pub(super) commit_message: String,
}

#[derive(Debug, Deserialize, JsonSchema)]
#[serde(deny_unknown_fields)]
pub(super) struct ResolutionInput {
    pub(super) path: String,
    #[serde(default)]
    pub(super) content: Option<String>,
    #[serde(default)]
    pub(super) oss_key: Option<String>,
}

#[derive(Debug, Clone, Copy, Deserialize, JsonSchema, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub(super) enum PlatformAction {
    CreateProject,
    IssueApiKey,
    RevokeApiKey,
    ListUsers,
}

#[derive(Debug, Deserialize, JsonSchema)]
#[serde(deny_unknown_fields)]
pub(super) struct PlatformArgs {
    pub(super) action: PlatformAction,
    #[serde(default)]
    pub(super) slug: Option<String>,
    #[serde(default)]
    pub(super) name: Option<String>,
    #[serde(default)]
    pub(super) description: Option<String>,
    #[serde(default)]
    pub(super) token_budget: Option<i64>,
    #[serde(default)]
    pub(super) user_id: Option<String>,
    #[serde(default)]
    pub(super) project_slug: Option<String>,
    #[serde(default)]
    pub(super) scopes: Option<Vec<String>>,
    #[serde(default)]
    pub(super) is_global: Option<bool>,
    #[serde(default)]
    pub(super) api_key_id: Option<String>,
}
