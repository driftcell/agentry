use std::time::Instant;

use rmcp::ErrorData;
use rmcp::RoleServer;
use rmcp::ServerHandler;
use rmcp::model::{
    CallToolRequestParams, CallToolResponse, CallToolResult, GetSkillRequestParams, GetSkillResult,
    Implementation, ListResourcesResult, ListSkillsResult, ListToolsResult, PaginatedRequestParams,
    ReadResourceDirectoryRequestParams, ReadResourceRequestParams, ReadResourceResponse,
    ReadResourceResult, ServerCapabilities, ServerConfig, Tool, ToolAnnotations,
};
use rmcp::service::RequestContext;

use crate::AppState;
use crate::error::ToolError;
use crate::project::ProjectContext;
use crate::workspace::{collect_skill_entries, load_active_files, paginate};

use super::{parse_args, request_project_context, tool_json};

mod args;
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
            .with_annotations(ToolAnnotations::new().read_only(true).open_world(false)),
            Tool::new(
                "read_slice",
                "Read a workspace file by outline, section or full text. Outline returns H1-H3 and section token counts; section returns only the named section; full honours max_tokens and reports truncation.",
                serde_json::Map::new(),
            )
            .with_input_schema::<ReadSliceArgs>()
            .with_annotations(ToolAnnotations::new().read_only(true).open_world(false)),
            Tool::new(
                "pull_bundle_url",
                "Create a short-lived presigned download for a selected file set and return a shell-safe download/unpack command. The server never executes the command.",
                serde_json::Map::new(),
            )
            .with_input_schema::<BundleArgs>()
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
                self.inspect_workspace(ctx, args).await.map(tool_json)
            }
            "read_slice" => {
                let args: ReadSliceArgs = parse_args(request.arguments.clone())?;
                self.read_slice(ctx, args).await.map(tool_json)
            }
            "pull_bundle_url" => {
                let args: BundleArgs = parse_args(request.arguments.clone())?;
                self.pull_bundle_url(ctx, args).await.map(tool_json)
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
        let result = ListToolsResult::with_all_items(Self::tools());
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
        let result = self.list_resources_page(project, request).await;
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
            Ok::<_, ToolError>(ReadResourceResult::new(vec![contents]))
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
            .await;
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
            let mut result = ListSkillsResult::with_all_items(page);
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
            let files = load_active_files(&self.state.db, project)
                .await
                .map_err(ToolError::from)?;
            let entries = collect_skill_entries(&self.state.db, project, &files)
                .await
                .map_err(ToolError::from)?;
            entries
                .into_iter()
                .find(|entry| entry.uri == request.uri)
                .map(|entry| GetSkillResult::new(entry.skill))
                .ok_or_else(|| ToolError::not_found("skill not found"))
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

fn protocol_error(error: ToolError) -> ErrorData {
    ErrorData::invalid_params(error.message, None)
}
