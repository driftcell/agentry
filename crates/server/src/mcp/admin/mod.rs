use std::time::Instant;

use rmcp::ErrorData;
use rmcp::RoleServer;
use rmcp::ServerHandler;
use rmcp::model::{
    CallToolRequestParams, CallToolResponse, CallToolResult, Implementation, ListToolsResult,
    PaginatedRequestParams, ServerCapabilities, ServerConfig, Tool, ToolAnnotations,
};
use rmcp::service::RequestContext;

use crate::AppState;
use crate::error::ToolError;
use crate::project::ProjectContext;

use super::{parse_args, request_project_context, tool_dual};

#[derive(Clone)]
pub struct AdminServer {
    pub(super) state: AppState,
}

impl AdminServer {
    pub fn new(state: AppState) -> Self {
        Self { state }
    }

    fn tools() -> Vec<Tool> {
        vec![
            Tool::new(
                "stage_upload_urls",
                "Create a transfer session and per-file presigned PUT URLs plus shell-safe curl commands. Uploaded objects are staged; they enter a revision only after propose_revision verifies them.",
                serde_json::Map::new(),
            )
            .with_input_schema::<StageArgs>()
            .with_output_schema::<outputs::StageOutput>()
            .with_annotations(ToolAnnotations::new().destructive(false).open_world(false)),
            Tool::new(
                "propose_revision",
                "Create an immutable revision proposal from staged uploads and/or inline patches, running a three-way merge against the current active revision.",
                serde_json::Map::new(),
            )
            .with_input_schema::<ProposeArgs>()
            .with_output_schema::<outputs::ProposeOutput>()
            .with_annotations(ToolAnnotations::new().destructive(false).open_world(false)),
            Tool::new(
                "check_review_status",
                "Return the true current status and human review comment for a revision in this project.",
                serde_json::Map::new(),
            )
            .with_input_schema::<StatusArgs>()
            .with_output_schema::<outputs::ReviewStatusOutput>()
            .with_annotations(ToolAnnotations::new().read_only(true).open_world(false)),
            Tool::new(
                "rebase_revision",
                "Rebase a stale pending_review revision in place onto the current active revision. The revision id is preserved; if the rebase produces overlaps the status becomes conflict and must be resolved.",
                serde_json::Map::new(),
            )
            .with_input_schema::<RebaseArgs>()
            .with_output_schema::<outputs::RebaseOutput>()
            .with_annotations(ToolAnnotations::new().destructive(false).open_world(false)),
            Tool::new(
                "activate_revision",
                "Atomically activate a revision that a human already approved. Any other status fails; there is no tool to approve.",
                serde_json::Map::new(),
            )
            .with_input_schema::<ActivateArgs>()
            .with_output_schema::<outputs::ActivateOutput>()
            .with_annotations(ToolAnnotations::new().destructive(true).open_world(false)),
            Tool::new(
                "resolve_conflict",
                "Resolve every conflict in a conflict revision. The revision returns to pending_review and must be approved again by a human.",
                serde_json::Map::new(),
            )
            .with_input_schema::<ResolveArgs>()
            .with_output_schema::<outputs::ResolveOutput>()
            .with_annotations(ToolAnnotations::new().destructive(false).open_world(false)),
            Tool::new(
                "manage_platform",
                "Platform actions: create_project, issue_api_key, revoke_api_key, list_users. Requires admin:platform. API key plaintext is shown once and never listed.",
                serde_json::Map::new(),
            )
            .with_input_schema::<PlatformArgs>()
            .with_output_schema::<outputs::PlatformOutput>()
            .with_annotations(ToolAnnotations::new().destructive(true).open_world(false)),
        ]
    }

    pub(super) async fn dispatch(
        &self,
        ctx: &ProjectContext,
        request: &CallToolRequestParams,
    ) -> Result<CallToolResult, ToolError> {
        match request.name.as_ref() {
            "stage_upload_urls" => {
                let args: StageArgs = parse_args(request.arguments.clone())?;
                let out = self.stage_upload_urls(ctx, args).await?;
                tool_dual(&out)
            }
            "propose_revision" => {
                let args: ProposeArgs = parse_args(request.arguments.clone())?;
                let out = self.propose_revision(ctx, args).await?;
                tool_dual(&out)
            }
            "check_review_status" => {
                let args: StatusArgs = parse_args(request.arguments.clone())?;
                let out = self.check_review_status(ctx, args).await?;
                tool_dual(&out)
            }
            "activate_revision" => {
                let args: ActivateArgs = parse_args(request.arguments.clone())?;
                let out = self.activate_revision(ctx, args).await?;
                tool_dual(&out)
            }
            "rebase_revision" => {
                let args: RebaseArgs = parse_args(request.arguments.clone())?;
                let out = self.rebase_revision(ctx, args).await?;
                tool_dual(&out)
            }
            "resolve_conflict" => {
                let args: ResolveArgs = parse_args(request.arguments.clone())?;
                let out = self.resolve_conflict(ctx, args).await?;
                tool_dual(&out)
            }
            "manage_platform" => {
                let args: PlatformArgs = parse_args(request.arguments.clone())?;
                let out = self.manage_platform(ctx, args).await?;
                tool_dual(&out)
            }
            other => Err(ToolError::new(
                "UNKNOWN_TOOL",
                format!("unknown tool {other}"),
            )),
        }
    }
}

impl ServerHandler for AdminServer {
    fn get_info(&self) -> ServerConfig {
        ServerConfig::new(
            ServerCapabilities::builder()
                .enable_tools()
                .build(),
        )
        .with_server_info(
            Implementation::new("agentry-admin", env!("CARGO_PKG_VERSION"))
                .with_description("Project-isolated administration MCP for the Agentry registry"),
        )
        .with_instructions(
            "Approval is a human-only Web action. Agents may stage uploads, propose revisions, resolve conflicts and activate revisions that a human already approved. Activation checks status=approved, base freshness and project isolation in one transaction.",
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
                crate::stats::record(
                    &self.state.db,
                    None,
                    "admin/mcp",
                    &request.name,
                    "error",
                    started,
                );
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
}

mod args;
mod outputs;
mod platform;
mod review;
mod uploads;

use self::args::*;
