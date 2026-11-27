use std::collections::HashMap;

use sqlx::PgPool;

use crate::error::AppError;
use crate::markdown::{one_line_description, parse_frontmatter};
use crate::project::Project;
use crate::revisions::load_snapshot;

use super::model::WorkspaceFile;

pub async fn load_active_files(
    db: &PgPool,
    project: &Project,
) -> Result<HashMap<String, WorkspaceFile>, AppError> {
    let Some(active_id) = project.active_revision_id else {
        return Ok(HashMap::new());
    };
    let snapshot = load_snapshot(db, active_id).await?;
    Ok(snapshot
        .into_iter()
        .map(|(path, blob)| {
            let description = if blob.is_text {
                let text = blob.text_content.as_deref().unwrap_or("");
                if path.ends_with("/SKILL.md") || path == "SKILL.md" {
                    parse_frontmatter(text)
                        .and_then(|front| {
                            front
                                .value
                                .get("description")
                                .and_then(|v| v.as_str())
                                .map(|s| s.to_string())
                        })
                        .unwrap_or_else(|| one_line_description(text, 100))
                } else {
                    one_line_description(text, 100)
                }
            } else {
                format!("{} attachment", blob.media_type)
            };
            (
                path.clone(),
                WorkspaceFile {
                    path,
                    blob_id: blob.id,
                    sha256: blob.sha256,
                    size_bytes: blob.size_bytes,
                    is_text: blob.is_text,
                    media_type: blob.media_type,
                    token_count: blob.token_count,
                    description,
                },
            )
        })
        .collect())
}
