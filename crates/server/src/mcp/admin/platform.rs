use serde_json::{Value, json};
use uuid::Uuid;

use crate::AppState;
use crate::error::ToolError;
use crate::paths::validate_slug;
use crate::project::{ProjectContext, resolve_tool_project};

use super::args::*;
use super::outputs::{PlatformOutput, PlatformUserView};

impl super::AdminServer {
    pub(super) async fn manage_platform(
        &self,
        ctx: &ProjectContext,
        args: PlatformArgs,
    ) -> Result<PlatformOutput, ToolError> {
        ctx.require_scope("admin:platform")?;
        match args.action {
            PlatformAction::CreateProject => {
                let slug = args
                    .slug
                    .ok_or_else(|| ToolError::bad_request("slug is required for create_project"))?;
                validate_slug(&slug).map_err(ToolError::bad_request)?;
                let name = args
                    .name
                    .ok_or_else(|| ToolError::bad_request("name is required for create_project"))?;
                let budget = args.token_budget.unwrap_or(200_000);
                if budget <= 0 {
                    return Err(ToolError::bad_request("token_budget must be positive"));
                }
                let id: Uuid = sqlx::query_scalar(
                    r#"
                    INSERT INTO projects (slug, name, description, token_budget)
                    VALUES ($1, $2, $3, $4)
                    RETURNING id
                    "#,
                )
                .bind(&slug)
                .bind(&name)
                .bind(args.description.unwrap_or_default())
                .bind(budget)
                .fetch_one(&self.state.db)
                .await
                .map_err(|e| duplicate_or_internal(e, "project slug already exists"))?;
                audit_platform(
                    &self.state,
                    ctx,
                    "create_project",
                    json!({"project_id": id, "slug": slug}),
                )
                .await;
                Ok(PlatformOutput {
                    action: "create_project".to_string(),
                    project_id: Some(id),
                    slug: Some(slug),
                    name: Some(name),
                    active_revision: None,
                    ..Default::default()
                })
            }
            PlatformAction::DeleteProject => {
                if ctx.key.user_role != "superadmin" {
                    return Err(ToolError::forbidden(
                        "project deletion requires a superadmin key",
                    ));
                }
                let slug = args
                    .project_slug
                    .or(args.slug)
                    .ok_or_else(|| ToolError::bad_request("slug is required for delete_project"))?;
                let project = resolve_tool_project(&self.state, ctx, Some(&slug)).await?;
                let project_id: Uuid = sqlx::query_scalar(
                    r#"
                    UPDATE projects
                    SET deleted_at = now(), updated_at = now()
                    WHERE id = $1 AND deleted_at IS NULL
                    RETURNING id
                    "#,
                )
                .bind(project.id)
                .fetch_optional(&self.state.db)
                .await
                .map_err(|e| ToolError::internal(format!("delete project: {e}")))?
                .ok_or_else(|| ToolError::not_found("project not found"))?;
                let slug = project.slug;
                audit_platform(
                    &self.state,
                    ctx,
                    "delete_project",
                    json!({"project_id": project_id, "slug": &slug}),
                )
                .await;
                Ok(PlatformOutput {
                    action: "delete_project".to_string(),
                    project_id: Some(project_id),
                    slug: Some(slug),
                    deleted: Some(true),
                    ..Default::default()
                })
            }
            PlatformAction::IssueApiKey => {
                let name = args
                    .name
                    .ok_or_else(|| ToolError::bad_request("name is required for issue_api_key"))?;
                let mut scopes = args.scopes.unwrap_or_else(|| vec!["mcp:read".into()]);
                scopes.sort();
                scopes.dedup();
                validate_scopes(&scopes)?;
                let is_global = args.is_global.unwrap_or(false);
                let target_user = if let Some(ref user_ref) = args.user_id {
                    if let Ok(uuid) = Uuid::parse_str(user_ref.trim()) {
                        let exists: Option<Uuid> =
                            sqlx::query_scalar("SELECT id FROM users WHERE id = $1")
                                .bind(uuid)
                                .fetch_optional(&self.state.db)
                                .await
                                .map_err(|e| ToolError::internal(format!("load user: {e}")))?;
                        exists
                            .ok_or_else(|| ToolError::bad_request("target user does not exist"))?
                    } else {
                        let by_name: Option<Uuid> =
                            sqlx::query_scalar("SELECT id FROM users WHERE username = $1")
                                .bind(user_ref.trim())
                                .fetch_optional(&self.state.db)
                                .await
                                .map_err(|e| ToolError::internal(format!("load user: {e}")))?;
                        by_name
                            .ok_or_else(|| ToolError::bad_request("target user does not exist"))?
                    }
                } else {
                    ctx.key.user_id
                };
                if (target_user != ctx.key.user_id
                    || is_global
                    || scopes.iter().any(|s| s == "admin:platform"))
                    && ctx.key.user_role != "superadmin"
                {
                    return Err(ToolError::forbidden(
                        "only a superadmin key may issue global, platform-scoped, or other users' keys",
                    ));
                }
                let project = if is_global {
                    None
                } else if let Some(slug) = args.project_slug.as_deref() {
                    let project = resolve_tool_project(&self.state, ctx, Some(slug)).await?;
                    Some(project)
                } else {
                    Some(resolve_tool_project(&self.state, ctx, None).await?)
                };
                let (id, token) = crate::auth::issue_api_key(
                    &self.state.db,
                    target_user,
                    project.as_ref().map(|p| p.id),
                    &name,
                    &scopes,
                    is_global,
                )
                .await
                .map_err(ToolError::from)?;
                audit_platform(
                    &self.state,
                    ctx,
                    "issue_api_key",
                    json!({"api_key_id": id, "project": project.as_ref().map(|p| p.slug.clone()), "scopes": scopes, "global": is_global}),
                )
                .await;
                Ok(PlatformOutput {
                    action: "issue_api_key".to_string(),
                    api_key_id: Some(id),
                    name: Some(name),
                    api_key: Some(token),
                    project: Some(project.as_ref().map(|p| p.slug.clone())),
                    is_global: Some(is_global),
                    scopes: Some(scopes),
                    warning: Some(
                        "this plaintext key is shown once; store it securely and never commit it"
                            .to_string(),
                    ),
                    ..Default::default()
                })
            }
            PlatformAction::RevokeApiKey => {
                let key_ref = args.api_key_id.as_deref().ok_or_else(|| {
                    ToolError::bad_request("api_key_id is required for revoke_api_key")
                })?;
                let row: Option<(Uuid, Option<Uuid>, bool)> = if let Ok(uuid) =
                    Uuid::parse_str(key_ref.trim())
                {
                    sqlx::query_as(
                        "SELECT id, default_project_id, is_global FROM api_keys WHERE id = $1",
                    )
                    .bind(uuid)
                    .fetch_optional(&self.state.db)
                    .await
                    .map_err(|e| ToolError::internal(format!("load api key: {e}")))?
                } else {
                    sqlx::query_as(
                        "SELECT id, default_project_id, is_global FROM api_keys WHERE key_prefix = $1",
                    )
                    .bind(key_ref.trim())
                    .fetch_optional(&self.state.db)
                    .await
                    .map_err(|e| ToolError::internal(format!("load api key: {e}")))?
                };

                let (id, default_project, is_global) =
                    row.ok_or_else(|| ToolError::not_found("API key not found"))?;
                if !ctx.key.is_global {
                    let bound = ctx.project().ok().map(|p| p.id);
                    if is_global || default_project != bound {
                        return Err(ToolError::forbidden(
                            "this API key cannot revoke keys outside its project",
                        ));
                    }
                }
                sqlx::query("UPDATE api_keys SET revoked_at = now() WHERE id = $1")
                    .bind(id)
                    .execute(&self.state.db)
                    .await
                    .map_err(|e| ToolError::internal(format!("revoke api key: {e}")))?;
                audit_platform(
                    &self.state,
                    ctx,
                    "revoke_api_key",
                    json!({"api_key_id": id}),
                )
                .await;
                Ok(PlatformOutput {
                    action: "revoke_api_key".to_string(),
                    api_key_id: Some(id),
                    revoked: Some(true),
                    ..Default::default()
                })
            }
            PlatformAction::ListUsers => {
                let rows: Vec<(Uuid, String, String, String, chrono::DateTime<chrono::Utc>)> =
                    sqlx::query_as(
                        "SELECT id, username, display_name, role, created_at FROM users ORDER BY username",
                    )
                    .fetch_all(&self.state.db)
                    .await
                    .map_err(|e| ToolError::internal(format!("list users: {e}")))?;
                let users: Vec<PlatformUserView> = rows
                    .into_iter()
                    .map(
                        |(id, username, display_name, role, created_at)| PlatformUserView {
                            id,
                            username,
                            display_name,
                            role,
                            created_at,
                        },
                    )
                    .collect();
                Ok(PlatformOutput {
                    action: "list_users".to_string(),
                    users: Some(users),
                    ..Default::default()
                })
            }
        }
    }
}

async fn audit_platform(state: &AppState, ctx: &ProjectContext, action: &str, detail: Value) {
    let _ = sqlx::query(
        r#"
        INSERT INTO audit_events
            (project_id, actor_user_id, actor_api_key_id, actor_label, action, result, detail)
        VALUES ($1, $2, $3, $4, $5, 'ok', $6)
        "#,
    )
    .bind(ctx.project.as_ref().map(|p| p.id))
    .bind(ctx.key.user_id)
    .bind(ctx.key.api_key_id)
    .bind(ctx.key.label())
    .bind(format!("platform:{action}"))
    .bind(sqlx::types::Json(detail))
    .execute(&state.db)
    .await;
}

fn duplicate_or_internal(error: sqlx::Error, duplicate_message: &str) -> ToolError {
    if let sqlx::Error::Database(db) = &error {
        if db.code().as_deref() == Some("23505") {
            return ToolError::conflict(duplicate_message.to_string());
        }
        if db.code().as_deref() == Some("23514") || db.code().as_deref() == Some("23503") {
            return ToolError::bad_request("value violates a platform constraint");
        }
    }
    ToolError::internal(format!("database error: {error}"))
}

fn validate_scopes(scopes: &[String]) -> Result<(), ToolError> {
    let allowed = [
        "mcp:read",
        "admin:propose",
        "admin:activate",
        "admin:platform",
    ];
    if scopes.is_empty() {
        return Err(ToolError::bad_request("scopes must not be empty"));
    }
    for scope in scopes {
        if !allowed.contains(&scope.as_str()) {
            return Err(ToolError::bad_request(format!("unknown scope {scope}")));
        }
    }
    Ok(())
}
