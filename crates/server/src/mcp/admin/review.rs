use crate::content::blob_by_sha;
use crate::error::ToolError;
use crate::project::{ProjectContext, resolve_tool_project};
use crate::revisions::{
    self, Actor, Resolution, get_revision_for_tool_ref, review_status, revision_conflicts,
};

use super::args::*;
use super::outputs::*;

impl super::AdminServer {
    pub(super) async fn check_review_status(
        &self,
        ctx: &ProjectContext,
        args: StatusArgs,
    ) -> Result<ReviewStatusOutput, ToolError> {
        ctx.require_scope("admin:propose")?;
        let project = resolve_tool_project(&self.state, ctx, args.project_slug.as_deref()).await?;
        let revision =
            get_revision_for_tool_ref(&self.state.db, &project, &args.revision_id).await?;
        let status = review_status(&self.state.db, &project, &revision)
            .await
            .map_err(ToolError::from)?;

        let mut conflict_previews = Vec::new();
        if status.status == "conflict" {
            let details = revision_conflicts(&self.state.db, revision.id)
                .await
                .map_err(ToolError::from)?;
            for detail in details.into_iter().take(5) {
                if let Some(sha) = detail.merged_sha256.as_deref()
                    && let Ok(Some(blob)) = blob_by_sha(&self.state.db, sha).await
                    && let Some(text) = blob.text_content.as_deref()
                {
                    let hunk_text = extract_conflict_hunks(text, 40);
                    if !hunk_text.is_empty() {
                        conflict_previews.push(ConflictPreview {
                            path: detail.path,
                            hunk_text,
                        });
                    }
                }
            }
        }

        Ok(ReviewStatusOutput {
            revision_id: status.short_code,
            revision_uuid: status.revision_id,
            status: status.status,
            commit_message: status.commit_message,
            comment: status.comment,
            reviewer: status.reviewer,
            token_added: status.token_added,
            token_removed: status.token_removed,
            total_tokens: status.total_tokens,
            stale: status.stale,
            conflicts: status.conflicts,
            conflict_previews,
        })
    }

    pub(super) async fn rebase_revision(
        &self,
        ctx: &ProjectContext,
        args: RebaseArgs,
    ) -> Result<RebaseOutput, ToolError> {
        ctx.require_scope("admin:propose")?;
        let project = resolve_tool_project(&self.state, ctx, args.project_slug.as_deref()).await?;
        let actor = Actor::from_mcp(ctx);
        let target = get_revision_for_tool_ref(&self.state.db, &project, &args.revision_id).await?;
        let revision = revisions::rebase_revision(&self.state, &project, target.id, &actor)
            .await
            .map_err(ToolError::from)?;
        Ok(RebaseOutput {
            revision_id: revision.short_code,
            revision_uuid: revision.id,
            status: revision.status,
            token_added: revision.token_added,
            token_removed: revision.token_removed,
            total_tokens: revision.total_tokens,
            stale: false,
            next: "a human must approve the rebased revision before it can be activated"
                .to_string(),
        })
    }

    pub(super) async fn activate_revision(
        &self,
        ctx: &ProjectContext,
        args: ActivateArgs,
    ) -> Result<ActivateOutput, ToolError> {
        ctx.require_scope("admin:activate")?;
        let project = resolve_tool_project(&self.state, ctx, args.project_slug.as_deref()).await?;
        let actor = Actor::from_mcp(ctx);
        let target = get_revision_for_tool_ref(&self.state.db, &project, &args.revision_id).await?;
        let revision =
            revisions::activate_revision(&self.state, project.id, target.id, Some(&actor))
                .await
                .map_err(ToolError::from)?;
        Ok(ActivateOutput {
            revision_id: revision.short_code,
            revision_uuid: revision.id,
            project: project.slug,
            status: revision.status,
            activated_at: revision.activated_at.map(|dt| dt.to_rfc3339()),
        })
    }

    pub(super) async fn resolve_conflict(
        &self,
        ctx: &ProjectContext,
        args: ResolveArgs,
    ) -> Result<ResolveOutput, ToolError> {
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
        let target = get_revision_for_tool_ref(&self.state.db, &project, &args.revision_id).await?;
        let revision = revisions::resolve_conflict(
            &self.state,
            &project,
            target.id,
            &actor,
            resolutions,
            &args.commit_message,
        )
        .await
        .map_err(ToolError::from)?;
        Ok(ResolveOutput {
            revision_id: revision.short_code,
            revision_uuid: revision.id,
            status: revision.status,
            token_added: revision.token_added,
            token_removed: revision.token_removed,
            next: "a human must approve the resolved revision before it can be activated"
                .to_string(),
        })
    }
}

fn extract_conflict_hunks(text: &str, max_lines: usize) -> String {
    let lines: Vec<&str> = text.lines().collect();
    let mut out = Vec::new();
    let mut in_hunk = false;
    for (idx, line) in lines.iter().enumerate() {
        if line.starts_with("<<<<<<<") {
            in_hunk = true;
            if idx > 0 {
                out.push(format!("@@ L{} @@", idx + 1));
            }
        }
        if in_hunk {
            out.push((*line).to_string());
            if out.len() >= max_lines {
                out.push("... (truncated)".to_string());
                break;
            }
        }
        if line.starts_with(">>>>>>>") {
            in_hunk = false;
        }
    }
    out.join("\n")
}
