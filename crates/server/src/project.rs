use axum::http::HeaderMap;
use serde::Serialize;
use sqlx::PgPool;
use uuid::Uuid;

use crate::AppState;
use crate::auth::{AuthKey, WebUser, authenticate_api_key, bearer_token, touch_api_key};
use crate::error::{AppError, ToolError};
use crate::paths::validate_slug;

pub const PROJECT_HEADER: &str = "x-mcp-project";

#[derive(Debug, Clone, Serialize, sqlx::FromRow)]
pub struct Project {
    pub id: Uuid,
    pub slug: String,
    pub name: String,
    pub description: String,
    pub token_budget: i64,
    pub active_revision_id: Option<Uuid>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum RouteKind {
    Read,
    Admin,
}

impl RouteKind {
    pub fn endpoint(self) -> &'static str {
        match self {
            RouteKind::Read => "mcp",
            RouteKind::Admin => "admin/mcp",
        }
    }

    pub fn is_admin(self) -> bool {
        matches!(self, RouteKind::Admin)
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ProjectSource {
    Path,
    Header,
    KeyDefault,
    None,
}

impl ProjectSource {
    pub fn as_str(self) -> &'static str {
        match self {
            ProjectSource::Path => "path",
            ProjectSource::Header => "header",
            ProjectSource::KeyDefault => "key_default",
            ProjectSource::None => "none",
        }
    }
}

/// The resolved, auditable context for one MCP request. Every tool handler
/// receives exactly this value; Tool parameters cannot silently change it.
#[derive(Debug, Clone)]
pub struct ProjectContext {
    pub key: AuthKey,
    pub project: Option<Project>,
    pub route: RouteKind,
    pub source: ProjectSource,
}

impl ProjectContext {
    pub fn endpoint(&self) -> &'static str {
        self.route.endpoint()
    }

    pub fn project(&self) -> Result<&Project, ToolError> {
        self.project.as_ref().ok_or_else(|| {
            ToolError::new("PROJECT_CONTEXT_REQUIRED", "a project context is required")
        })
    }

    pub fn project_app(&self) -> Result<&Project, AppError> {
        self.project.as_ref().ok_or_else(|| {
            AppError::bad_request("PROJECT_CONTEXT_REQUIRED", "a project context is required")
        })
    }

    pub fn require_scope(&self, scope: &str) -> Result<(), ToolError> {
        if self.key.has_scope(scope) {
            Ok(())
        } else {
            Err(ToolError::forbidden(format!(
                "this API key does not carry the {scope} scope"
            )))
        }
    }
}

pub async fn load_project_by_slug(db: &PgPool, slug: &str) -> Result<Option<Project>, AppError> {
    sqlx::query_as::<_, Project>(
        "SELECT id, slug, name, description, token_budget, active_revision_id FROM projects WHERE slug = $1 AND deleted_at IS NULL",
    )
    .bind(slug)
    .fetch_optional(db)
    .await
    .map_err(AppError::from_db)
}

pub async fn load_project_by_id(db: &PgPool, id: Uuid) -> Result<Option<Project>, AppError> {
    sqlx::query_as::<_, Project>(
        "SELECT id, slug, name, description, token_budget, active_revision_id FROM projects WHERE id = $1 AND deleted_at IS NULL",
    )
    .bind(id)
    .fetch_optional(db)
    .await
    .map_err(AppError::from_db)
}

fn parse_route(path: &str) -> Result<(RouteKind, Option<String>), AppError> {
    let path = path.trim_end_matches('/');
    let segments: Vec<&str> = path.split('/').filter(|s| !s.is_empty()).collect();
    match segments.as_slice() {
        ["mcp"] => Ok((RouteKind::Read, None)),
        ["mcp", "projects", slug] => Ok((RouteKind::Read, Some((*slug).to_string()))),
        ["admin", "mcp"] => Ok((RouteKind::Admin, None)),
        ["admin", "mcp", "projects", slug] => Ok((RouteKind::Admin, Some((*slug).to_string()))),
        _ => Err(AppError::not_found("NOT_FOUND", "unknown MCP endpoint")),
    }
}

/// Authentication and fixed project resolution for the four MCP route shapes.
///
/// Priority is deliberately fixed:
///   `/projects/{slug}` route > `X-MCP-Project` header > key default.
/// Only an admin endpoint reached by a global key may leave the project
/// unresolved, in which case a Tool `project_slug` parameter may supply it.
pub async fn resolve_mcp_context(
    state: &AppState,
    headers: &HeaderMap,
    path: &str,
) -> Result<ProjectContext, AppError> {
    let (route, path_slug) = parse_route(path)?;
    let token = bearer_token(headers)
        .ok_or_else(|| AppError::unauthorized("UNAUTHENTICATED", "Bearer API key required"))?;
    let key = authenticate_api_key(&state.db, &token).await?;
    touch_api_key(&state.db, key.api_key_id).await;

    if route.is_admin() {
        if !key.is_admin() {
            return Err(AppError::forbidden(
                "INSUFFICIENT_SCOPE",
                "this API key does not carry an admin scope",
            ));
        }
    } else if !key.has_scope("mcp:read") {
        return Err(AppError::forbidden(
            "INSUFFICIENT_SCOPE",
            "this API key does not carry the mcp:read scope",
        ));
    }

    let header_slug = match headers.get(PROJECT_HEADER) {
        Some(value) => {
            let value = value.to_str().map_err(|_| {
                AppError::bad_request("INVALID_PROJECT", "invalid X-MCP-Project header")
            })?;
            let value = value.trim();
            validate_slug(value).map_err(|e| {
                AppError::bad_request("INVALID_PROJECT", format!("invalid X-MCP-Project: {e}"))
            })?;
            Some(value.to_string())
        }
        None => None,
    };

    let (slug, source) = if let Some(slug) = path_slug {
        if let Some(header) = &header_slug
            && header != &slug
        {
            return Err(AppError::bad_request(
                "PROJECT_CONTEXT_CONFLICT",
                "X-MCP-Project disagrees with the project in the URL path",
            ));
        }
        (Some(slug), ProjectSource::Path)
    } else if let Some(header) = header_slug {
        (Some(header), ProjectSource::Header)
    } else if key.default_project_id.is_some() {
        (None, ProjectSource::KeyDefault)
    } else {
        (None, ProjectSource::None)
    };

    let project = if let Some(slug) = slug {
        resolve_authorized_project(&state.db, &key, &slug, route.is_admin()).await?
    } else if let Some(project_id) = key.default_project_id {
        // The key is bound to this project by database constraint.
        let project = load_project_by_id(&state.db, project_id)
            .await?
            .filter(|p| key.is_global || key.default_project_id == Some(p.id));
        match project {
            Some(project) => project,
            None if key.is_global => return Err(project_context_error(route, &key)),
            None => {
                return Err(AppError::forbidden(
                    "PROJECT_ACCESS_DENIED",
                    "the API key's default project is no longer accessible",
                ));
            }
        }
    } else {
        if route.is_admin() && key.is_global {
            return Ok(ProjectContext {
                key,
                project: None,
                route,
                source: ProjectSource::None,
            });
        }
        return Err(project_context_error(route, &key));
    };

    Ok(ProjectContext {
        key,
        project: Some(project),
        route,
        source,
    })
}

fn project_context_error(route: RouteKind, key: &AuthKey) -> AppError {
    if route.is_admin() && key.is_global {
        AppError::bad_request(
            "PROJECT_CONTEXT_REQUIRED",
            "pass X-MCP-Project, use /admin/mcp/projects/{slug}, or provide project_slug to the Tool",
        )
    } else {
        AppError::bad_request(
            "PROJECT_CONTEXT_REQUIRED",
            "this API key has no default project; pass X-MCP-Project or use /projects/{slug}",
        )
    }
}

async fn resolve_authorized_project(
    db: &PgPool,
    key: &AuthKey,
    slug: &str,
    _admin: bool,
) -> Result<Project, AppError> {
    if !key.is_global {
        // Non-global keys are bound to one project. Resolve the requested slug
        // only to compare ids, and never reveal whether another project exists.
        let Some(bound_id) = key.default_project_id else {
            return Err(AppError::forbidden(
                "PROJECT_ACCESS_DENIED",
                "this API key is not authorized for the requested project",
            ));
        };
        let bound = load_project_by_id(db, bound_id).await?;
        let allowed = bound.as_ref().is_some_and(|project| project.slug == slug);
        if !allowed {
            return Err(AppError::forbidden(
                "PROJECT_ACCESS_DENIED",
                "this API key is not authorized for the requested project",
            ));
        }
        return bound.ok_or_else(|| {
            AppError::forbidden(
                "PROJECT_ACCESS_DENIED",
                "this API key is not authorized for the requested project",
            )
        });
    }
    load_project_by_slug(db, slug)
        .await?
        .ok_or_else(|| AppError::not_found("PROJECT_NOT_FOUND", "project not found"))
}

/// Resolve the project for a Tool call, allowing only an admin endpoint with a
/// global key to use the `project_slug` fallback. All other combinations must
/// agree with the middleware-resolved context.
pub async fn resolve_tool_project(
    state: &AppState,
    ctx: &ProjectContext,
    project_slug: Option<&str>,
) -> Result<Project, ToolError> {
    if let Some(slug) = project_slug {
        validate_slug(slug)
            .map_err(|e| ToolError::bad_request(format!("invalid project_slug: {e}")))?;
    }
    match (&ctx.project, project_slug) {
        (Some(project), None) => Ok(project.clone()),
        (Some(project), Some(slug)) if project.slug == slug => Ok(project.clone()),
        (Some(_), Some(_)) => Err(ToolError::conflict(
            "project_slug conflicts with the resolved project context; use the project path or X-MCP-Project to choose a project",
        )),
        (None, Some(slug)) => {
            if ctx.route.is_admin() && ctx.key.is_global {
                load_project_by_slug(&state.db, slug)
                    .await
                    .map_err(ToolError::from)?
                    .ok_or_else(|| ToolError::not_found("project not found"))
            } else {
                Err(ToolError::new(
                    "PROJECT_CONTEXT_REQUIRED",
                    "a project context is required",
                ))
            }
        }
        (None, None) => Err(ToolError::new(
            "PROJECT_CONTEXT_REQUIRED",
            "provide project_slug because this route has no fixed project",
        )),
    }
}

pub async fn list_projects_for_user(db: &PgPool, user: &WebUser) -> Result<Vec<Project>, AppError> {
    let projects = if user.is_admin() {
        sqlx::query_as::<_, Project>(
            "SELECT id, slug, name, description, token_budget, active_revision_id FROM projects WHERE deleted_at IS NULL ORDER BY slug",
        )
        .fetch_all(db)
        .await?
    } else {
        sqlx::query_as::<_, Project>(
            r#"
            SELECT p.id, p.slug, p.name, p.description, p.token_budget, p.active_revision_id
            FROM projects p
            JOIN project_members m ON m.project_id = p.id
            WHERE m.user_id = $1
              AND p.deleted_at IS NULL
            ORDER BY p.slug
            "#,
        )
        .bind(user.id)
        .fetch_all(db)
        .await?
    };
    Ok(projects)
}

pub async fn user_can_access_project(
    db: &PgPool,
    user: &WebUser,
    project_id: Uuid,
) -> Result<bool, AppError> {
    if user.is_admin() {
        return Ok(load_project_by_id(db, project_id).await?.is_some());
    }
    let exists: Option<i32> =
        sqlx::query_scalar("SELECT 1 FROM project_members WHERE project_id = $1 AND user_id = $2")
            .bind(project_id)
            .bind(user.id)
            .fetch_optional(db)
            .await?;
    Ok(exists.is_some())
}

pub async fn require_project_access(
    db: &PgPool,
    user: &WebUser,
    project_id: Uuid,
) -> Result<(), AppError> {
    if user_can_access_project(db, user, project_id).await? {
        Ok(())
    } else {
        Err(AppError::forbidden(
            "PROJECT_ACCESS_DENIED",
            "you do not have access to this project",
        ))
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn four_route_shapes_parse() {
        assert_eq!(parse_route("/mcp").unwrap(), (RouteKind::Read, None));
        assert_eq!(
            parse_route("/mcp/projects/default").unwrap(),
            (RouteKind::Read, Some("default".into()))
        );
        assert_eq!(parse_route("/admin/mcp").unwrap(), (RouteKind::Admin, None));
        assert_eq!(
            parse_route("/admin/mcp/projects/default").unwrap(),
            (RouteKind::Admin, Some("default".into()))
        );
        assert!(parse_route("/mcp/other").is_err());
    }
}
