use std::time::Instant;

use rmcp::ErrorData;
use rmcp::RoleServer;
use rmcp::ServerHandler;
use rmcp::model::{
    CacheScope, CallToolRequestParams, CallToolResponse, CallToolResult, GetPromptRequestParams,
    GetPromptResponse, GetPromptResult, GetSkillRequestParams, GetSkillResult, Implementation,
    ListPromptsResult, ListResourceTemplatesResult, ListResourcesResult, ListSkillsResult,
    ListToolsResult, PaginatedRequestParams, Prompt, PromptMessage,
    ReadResourceDirectoryRequestParams, ReadResourceRequestParams, ReadResourceResponse,
    ReadResourceResult, ResourceTemplate, Role, ServerCapabilities, ServerConfig, Tool,
    ToolAnnotations,
};
use rmcp::service::RequestContext;

use crate::AppState;
use crate::content::blob_by_id;
use crate::error::ToolError;
use crate::paths::parse_skill_uri;
use crate::project::ProjectContext;
use crate::workspace::{collect_skill_entries, collect_skill_entry, load_active_files, paginate};

use super::{parse_args, request_project_context, tool_dual};

mod args;
mod outputs;
mod resources;
mod tools;

use self::args::{BundleArgs, InspectArgs, ReadSliceArgs};
use self::resources::read_resource_contents;

#[derive(Clone)]
pub struct ReadServer {
    state: AppState,
}

impl ReadServer {
    pub fn new(state: AppState) -> Self {
        Self { state }
    }

    fn tools() -> Vec<Tool> {
        vec![
            Tool::new(
                "inspect_workspace",
                "Compact workspace tree with one-line descriptions and token counts for CLAUDE.md, AGENTS.md, skills/* and agents/*.",
                serde_json::Map::new(),
            )
            .with_input_schema::<InspectArgs>()
            .with_output_schema::<outputs::InspectOutput>()
            .with_annotations(ToolAnnotations::new().read_only(true).open_world(false)),
            Tool::new(
                "read_slice",
                "Read a workspace file by outline, section or full text. Outline returns H1-H3 and section token counts; section returns only the named section (or __preamble__); full honours max_tokens and reports truncation.",
                serde_json::Map::new(),
            )
            .with_input_schema::<ReadSliceArgs>()
            .with_output_schema::<outputs::ReadSliceOutput>()
            .with_annotations(ToolAnnotations::new().read_only(true).open_world(false)),
            Tool::new(
                "pull_bundle_url",
                "Create a short-lived presigned download for a selected file set and return a shell-safe download/unpack command. The server never executes the command.",
                serde_json::Map::new(),
            )
            .with_input_schema::<BundleArgs>()
            .with_output_schema::<outputs::PullBundleOutput>()
            .with_annotations(ToolAnnotations::new().read_only(true).open_world(false)),
        ]
    }

    async fn dispatch(
        &self,
        ctx: &ProjectContext,
        request: &CallToolRequestParams,
    ) -> Result<CallToolResult, ToolError> {
        match request.name.as_ref() {
            "inspect_workspace" => {
                let args: InspectArgs = parse_args(request.arguments.clone())?;
                let out = self.inspect_workspace(ctx, args).await?;
                tool_dual(&out)
            }
            "read_slice" => {
                let args: ReadSliceArgs = parse_args(request.arguments.clone())?;
                let out = self.read_slice(ctx, args).await?;
                tool_dual(&out)
            }
            "pull_bundle_url" => {
                let args: BundleArgs = parse_args(request.arguments.clone())?;
                let out = self.pull_bundle_url(ctx, args).await?;
                tool_dual(&out)
            }
            other => Err(ToolError::new(
                "UNKNOWN_TOOL",
                format!("unknown tool {other}"),
            )),
        }
    }
}

impl ServerHandler for ReadServer {
    fn get_info(&self) -> ServerConfig {
        ServerConfig::new(
            ServerCapabilities::builder()
                .enable_tools()
                .enable_resources()
                .enable_prompts()
                .enable_skills_with_directory_read()
                .build(),
        )
        .with_server_info(
            Implementation::new("agentry-read", env!("CARGO_PKG_VERSION"))
                .with_description("Project-isolated read-only MCP workspace"),
        )
        .with_instructions(
            "Reads are scoped to the project active revision. Start with inspect_workspace, then read_slice(outline), then read_slice(section). Use pull_bundle_url only when a local file set is needed; the returned command is a suggestion and is never executed by the server.",
        )
    }

    async fn list_tools(
        &self,
        _request: Option<PaginatedRequestParams>,
        context: RequestContext<RoleServer>,
    ) -> Result<ListToolsResult, ErrorData> {
        let started = Instant::now();
        let result = ListToolsResult::with_all_items(Self::tools())
            .with_ttl_ms(300_000)
            .with_cache_scope(CacheScope::Public);
        if let Ok(ctx) = request_project_context(&context) {
            crate::stats::record(
                &self.state.db,
                Some(&ctx),
                ctx.endpoint(),
                "tools/list",
                "ok",
                started,
            );
        }
        Ok(result)
    }

    async fn call_tool(
        &self,
        request: CallToolRequestParams,
        context: RequestContext<RoleServer>,
    ) -> Result<CallToolResponse, ErrorData> {
        let started = Instant::now();
        let ctx = match request_project_context(&context) {
            Ok(ctx) => ctx,
            Err(error) => {
                crate::stats::record(&self.state.db, None, "mcp", &request.name, "error", started);
                return Ok(error.into_call_result().into());
            }
        };
        let method = request.name.clone();
        let result = self.dispatch(&ctx, &request).await;
        crate::stats::record(
            &self.state.db,
            Some(&ctx),
            ctx.endpoint(),
            &method,
            if result.is_ok() { "ok" } else { "error" },
            started,
        );
        Ok(match result {
            Ok(result) => result.into(),
            Err(error) => error.into_call_result().into(),
        })
    }

    async fn list_resources(
        &self,
        request: Option<PaginatedRequestParams>,
        context: RequestContext<RoleServer>,
    ) -> Result<ListResourcesResult, ErrorData> {
        let started = Instant::now();
        let ctx = request_project_context(&context).map_err(protocol_error)?;
        let project = ctx.project().map_err(protocol_error)?;
        let result = self
            .list_resources_page(project, request)
            .await
            .map(|r| r.with_ttl_ms(60_000).with_cache_scope(CacheScope::Private));
        crate::stats::record(
            &self.state.db,
            Some(&ctx),
            ctx.endpoint(),
            "resources/list",
            if result.is_ok() { "ok" } else { "error" },
            started,
        );
        result.map_err(protocol_error)
    }

    async fn list_resource_templates(
        &self,
        _request: Option<PaginatedRequestParams>,
        context: RequestContext<RoleServer>,
    ) -> Result<ListResourceTemplatesResult, ErrorData> {
        let started = Instant::now();
        let ctx = request_project_context(&context).map_err(protocol_error)?;
        let project = ctx.project().map_err(protocol_error)?;
        let templates = vec![
            ResourceTemplate::new(
                format!("mcp://{}/{{+path}}", project.slug),
                "Workspace Files",
            )
            .with_description("Active revision files in this project"),
            ResourceTemplate::new(
                format!("skill://{}/{{skill}}/{{+path}}", project.slug),
                "Skill Files",
            )
            .with_description("Skill instructions and supporting files in this project"),
        ];
        crate::stats::record(
            &self.state.db,
            Some(&ctx),
            ctx.endpoint(),
            "resources/templates/list",
            "ok",
            started,
        );
        Ok(ListResourceTemplatesResult::with_all_items(templates)
            .with_ttl_ms(300_000)
            .with_cache_scope(CacheScope::Private))
    }

    async fn read_resource(
        &self,
        request: ReadResourceRequestParams,
        context: RequestContext<RoleServer>,
    ) -> Result<ReadResourceResponse, ErrorData> {
        let started = Instant::now();
        let ctx = request_project_context(&context).map_err(protocol_error)?;
        let project = ctx.project().map_err(protocol_error)?;
        let result = async {
            let files = load_active_files(&self.state.db, project)
                .await
                .map_err(ToolError::from)?;
            let contents =
                read_resource_contents(&self.state, project, &files, &request.uri).await?;
            Ok::<_, ToolError>(
                ReadResourceResult::new(vec![contents])
                    .with_ttl_ms(60_000)
                    .with_cache_scope(CacheScope::Private),
            )
        }
        .await;
        crate::stats::record(
            &self.state.db,
            Some(&ctx),
            ctx.endpoint(),
            "resources/read",
            if result.is_ok() { "ok" } else { "error" },
            started,
        );
        result.map(|result| result.into()).map_err(protocol_error)
    }

    async fn read_resource_directory(
        &self,
        request: ReadResourceDirectoryRequestParams,
        context: RequestContext<RoleServer>,
    ) -> Result<ListResourcesResult, ErrorData> {
        let started = Instant::now();
        let ctx = request_project_context(&context).map_err(protocol_error)?;
        let project = ctx.project().map_err(protocol_error)?;
        let result = self
            .directory_page(project, &request.uri, request.cursor.as_deref())
            .await
            .map(|r| r.with_ttl_ms(60_000).with_cache_scope(CacheScope::Private));
        crate::stats::record(
            &self.state.db,
            Some(&ctx),
            ctx.endpoint(),
            "resources/directory/read",
            if result.is_ok() { "ok" } else { "error" },
            started,
        );
        result.map_err(protocol_error)
    }

    async fn list_prompts(
        &self,
        request: Option<PaginatedRequestParams>,
        context: RequestContext<RoleServer>,
    ) -> Result<ListPromptsResult, ErrorData> {
        let started = Instant::now();
        let ctx = request_project_context(&context).map_err(protocol_error)?;
        let project = ctx.project().map_err(protocol_error)?;
        let result = async {
            let files = load_active_files(&self.state.db, project)
                .await
                .map_err(ToolError::from)?;
            let mut prompts = Vec::new();
            let mut paths: Vec<&String> = files.keys().collect();
            paths.sort();
            for path in paths {
                let Some(file) = files.get(path) else {
                    continue;
                };
                if !file.is_text {
                    continue;
                }
                let prompt_name = prompt_name_for_path(path);
                if let Some(name) = prompt_name {
                    let desc = (!file.description.is_empty()).then_some(file.description.clone());
                    prompts.push(Prompt::new(name, desc, None));
                }
            }
            let (page, next) = paginate(
                &prompts,
                request.as_ref().and_then(|r| r.cursor.as_deref()),
                50,
            )?;
            let mut res = ListPromptsResult::with_all_items(page)
                .with_ttl_ms(60_000)
                .with_cache_scope(CacheScope::Private);
            res.next_cursor = next;
            Ok::<_, ToolError>(res)
        }
        .await;
        crate::stats::record(
            &self.state.db,
            Some(&ctx),
            ctx.endpoint(),
            "prompts/list",
            if result.is_ok() { "ok" } else { "error" },
            started,
        );
        result.map_err(protocol_error)
    }

    async fn get_prompt(
        &self,
        request: GetPromptRequestParams,
        context: RequestContext<RoleServer>,
    ) -> Result<GetPromptResponse, ErrorData> {
        let started = Instant::now();
        let ctx = request_project_context(&context).map_err(protocol_error)?;
        let project = ctx.project().map_err(protocol_error)?;
        let result = async {
            let path = path_for_prompt_name(&request.name)
                .ok_or_else(|| ToolError::not_found("prompt not found"))?;
            let files = load_active_files(&self.state.db, project)
                .await
                .map_err(ToolError::from)?;
            let file = files
                .get(&path)
                .ok_or_else(|| ToolError::not_found("prompt not found"))?;
            let blob = blob_by_id(&self.state.db, file.blob_id)
                .await
                .map_err(|e| ToolError::internal(format!("load prompt blob: {e}")))?
                .ok_or_else(|| ToolError::not_found("prompt not found"))?;
            let text = blob.text_content.unwrap_or_default();
            let mut res = GetPromptResult::new(vec![PromptMessage::new_text(Role::User, text)]);
            if !file.description.is_empty() {
                res = res.with_description(file.description.clone());
            }
            Ok::<_, ToolError>(res)
        }
        .await;
        crate::stats::record(
            &self.state.db,
            Some(&ctx),
            ctx.endpoint(),
            "prompts/get",
            if result.is_ok() { "ok" } else { "error" },
            started,
        );
        result.map(Into::into).map_err(protocol_error)
    }

    async fn list_skills(
        &self,
        request: Option<PaginatedRequestParams>,
        context: RequestContext<RoleServer>,
    ) -> Result<ListSkillsResult, ErrorData> {
        let started = Instant::now();
        let ctx = request_project_context(&context).map_err(protocol_error)?;
        let project = ctx.project().map_err(protocol_error)?;
        let result = async {
            let files = load_active_files(&self.state.db, project)
                .await
                .map_err(ToolError::from)?;
            let entries = collect_skill_entries(&self.state.db, project, &files)
                .await
                .map_err(ToolError::from)?;
            let skills: Vec<_> = entries.into_iter().map(|e| e.skill).collect();
            let (page, next) = paginate(
                &skills,
                request.as_ref().and_then(|r| r.cursor.as_deref()),
                50,
            )?;
            let mut result = ListSkillsResult::with_all_items(page)
                .with_ttl_ms(60_000)
                .with_cache_scope(CacheScope::Private);
            result.next_cursor = next;
            Ok::<_, ToolError>(result)
        }
        .await;
        crate::stats::record(
            &self.state.db,
            Some(&ctx),
            ctx.endpoint(),
            "skills/list",
            if result.is_ok() { "ok" } else { "error" },
            started,
        );
        result.map_err(protocol_error)
    }

    async fn get_skill(
        &self,
        request: GetSkillRequestParams,
        context: RequestContext<RoleServer>,
    ) -> Result<GetSkillResult, ErrorData> {
        let started = Instant::now();
        let ctx = request_project_context(&context).map_err(protocol_error)?;
        let project = ctx.project().map_err(protocol_error)?;
        let result = async {
            let (slug, name) = parse_skill_uri(&request.uri)
                .ok_or_else(|| ToolError::not_found("skill not found"))?;
            if slug != project.slug {
                return Err(ToolError::not_found("skill not found"));
            }
            let files = load_active_files(&self.state.db, project)
                .await
                .map_err(ToolError::from)?;
            let entry = collect_skill_entry(&self.state.db, project, &files, &name)
                .await
                .map_err(ToolError::from)?
                .ok_or_else(|| ToolError::not_found("skill not found"))?;
            Ok::<_, ToolError>(
                GetSkillResult::new(entry.skill)
                    .with_ttl_ms(60_000)
                    .with_cache_scope(CacheScope::Private),
            )
        }
        .await;
        crate::stats::record(
            &self.state.db,
            Some(&ctx),
            ctx.endpoint(),
            "skills/get",
            if result.is_ok() { "ok" } else { "error" },
            started,
        );
        result.map_err(protocol_error)
    }
}

fn prompt_name_for_path(path: &str) -> Option<String> {
    if path == "CLAUDE.md" {
        return Some("claude".to_string());
    }
    if path == "AGENTS.md" {
        return Some("agents".to_string());
    }
    if let Some(rest) = path.strip_prefix("agents/")
        && let Some(stem) = rest.strip_suffix(".md")
        && !stem.is_empty()
        && !stem.contains('/')
    {
        return Some(format!("agent:{stem}"));
    }
    None
}

fn path_for_prompt_name(name: &str) -> Option<String> {
    if name == "claude" {
        return Some("CLAUDE.md".to_string());
    }
    if name == "agents" {
        return Some("AGENTS.md".to_string());
    }
    if let Some(stem) = name.strip_prefix("agent:")
        && !stem.is_empty()
        && !stem.contains('/')
        && !stem.contains("..")
    {
        return Some(format!("agents/{stem}.md"));
    }
    None
}

fn protocol_error(error: ToolError) -> ErrorData {
    ErrorData::invalid_params(error.message, None)
}
