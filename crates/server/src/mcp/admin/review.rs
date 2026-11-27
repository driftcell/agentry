use serde_json::{Value, json};

use crate::error::ToolError;
use crate::project::{ProjectContext, resolve_tool_project};
use crate::revisions::{self, Actor, Resolution, get_revision_for_tool, review_status};

use super::args::*;

impl super::AdminServer {
    pub(super) async fn check_review_status(
        &self,
        ctx: &ProjectContext,
        args: StatusArgs,
    ) -> Result<Value, ToolError> {
        ctx.require_scope("admin:propose")?;
        let project = resolve_tool_project(&self.state, ctx, args.project_slug.as_deref()).await?;
        let revision = get_revision_for_tool(&self.state.db, &project, args.revision_id).await?;
        let status = review_status(&self.state.db, &project, &revision)
            .await
            .map_err(ToolError::from)?;
        Ok(json!({
            "revision_id": status.revision_id,
            "status": status.status,
            "commit_message": status.commit_message,
            "comment": status.comment,
            "reviewer": status.reviewer,
            "token_added": status.token_added,
            "token_removed": status.token_removed,
            "total_tokens": status.total_tokens,
            "stale": status.stale,
            "conflicts": status.conflicts,
        }))
    }

    pub(super) async fn rebase_revision(
        &self,
        ctx: &ProjectContext,
        args: RebaseArgs,
    ) -> Result<Value, ToolError> {
        ctx.require_scope("admin:propose")?;
        let project = resolve_tool_project(&self.state, ctx, args.project_slug.as_deref()).await?;
        let actor = Actor::from_mcp(ctx);
        let revision = revisions::rebase_revision(&self.state, &project, args.revision_id, &actor)
            .await
            .map_err(ToolError::from)?;
        Ok(json!({
            "revision_id": revision.id,
            "status": revision.status,
            "token_added": revision.token_added,
            "token_removed": revision.token_removed,
            "total_tokens": revision.total_tokens,
            "stale": false,
            "next": "a human must approve the rebased revision before it can be activated",
        }))
    }

    pub(super) async fn activate_revision(
        &self,
        ctx: &ProjectContext,
        args: ActivateArgs,
    ) -> Result<Value, ToolError> {
        ctx.require_scope("admin:activate")?;
        let project = resolve_tool_project(&self.state, ctx, args.project_slug.as_deref()).await?;
        let actor = Actor::from_mcp(ctx);
        let revision =
            revisions::activate_revision(&self.state, project.id, args.revision_id, Some(&actor))
                .await
                .map_err(ToolError::from)?;
        Ok(json!({
            "revision_id": revision.id,
            "project": project.slug,
            "status": revision.status,
            "activated_at": revision.activated_at,
        }))
    }

    pub(super) async fn resolve_conflict(
        &self,
        ctx: &ProjectContext,
        args: ResolveArgs,
    ) -> Result<Value, ToolError> {
        ctx.require_scope("admin:propose")?;
        let project = resolve_tool_project(&self.state, ctx, args.project_slug.as_deref()).await?;
        let actor = Actor::from_mcp(ctx);
        let resolutions: Vec<Resolution> = args
            .resolutions
            .into_iter()
            .map(|r| Resolution {
                path: r.path,
                content: r.content,
                oss_key: r.oss_key,
            })
            .collect();
        let revision = revisions::resolve_conflict(
            &self.state,
            &project,
            args.revision_id,
            &actor,
            resolutions,
            &args.commit_message,
        )
        .await
        .map_err(ToolError::from)?;
        Ok(json!({
            "revision_id": revision.id,
            "status": revision.status,
            "token_added": revision.token_added,
            "token_removed": revision.token_removed,
            "next": "a human must approve the resolved revision before it can be activated",
        }))
    }
}
