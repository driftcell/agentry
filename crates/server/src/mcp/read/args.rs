use schemars::JsonSchema;
use serde::Deserialize;

#[derive(Debug, Deserialize, JsonSchema)]
#[serde(deny_unknown_fields)]
pub(super) struct InspectArgs {
    /// all | root | claude | agents | skills | subagents
    #[serde(default)]
    pub(super) kind_filter: Option<String>,
}

#[derive(Debug, Clone, Copy, Deserialize, JsonSchema, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub(super) enum ReadMode {
    Outline,
    Section,
    Full,
}

#[derive(Debug, Deserialize, JsonSchema)]
#[serde(deny_unknown_fields)]
pub(super) struct ReadSliceArgs {
    pub(super) path: String,
    pub(super) mode: ReadMode,
    #[serde(default)]
    pub(super) section: Option<String>,
    #[serde(default)]
    pub(super) max_tokens: Option<usize>,
}

#[derive(Debug, Clone, Copy, Deserialize, JsonSchema, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub(super) enum BundleFormat {
    TarGz,
    Single,
}

#[derive(Debug, Deserialize, JsonSchema)]
#[serde(deny_unknown_fields)]
pub(super) struct BundleArgs {
    #[serde(default)]
    pub(super) paths: Option<Vec<String>>,
    #[serde(default)]
    pub(super) local_target_dir: Option<String>,
    #[serde(default)]
    pub(super) format: Option<BundleFormat>,
}
