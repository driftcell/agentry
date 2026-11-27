use std::collections::HashMap;

use sqlx::PgPool;
use uuid::Uuid;

use crate::error::AppError;
use crate::markdown::{one_line_description, parse_frontmatter};
use crate::project::Project;

use super::model::WorkspaceFile;

pub async fn load_active_files(
    db: &PgPool,
    project: &Project,
) -> Result<HashMap<String, WorkspaceFile>, AppError> {
    let Some(active_id) = project.active_revision_id else {
        return Ok(HashMap::new());
    };
    #[derive(sqlx::FromRow)]
    struct MetaRow {
        path: String,
        blob_id: Uuid,
        sha256: String,
        size_bytes: i64,
        is_text: bool,
        media_type: String,
        token_count: Option<i32>,
        text_preview: Option<String>,
    }
    let rows = sqlx::query_as::<_, MetaRow>(
        r#"
        SELECT rf.path, b.id AS blob_id, b.sha256, b.size_bytes, b.is_text,
               b.media_type, b.token_count,
               CASE WHEN b.is_text THEN left(b.text_content, 1024) ELSE NULL END AS text_preview
        FROM revision_files rf
        JOIN content_blobs b ON b.id = rf.blob_id
        WHERE rf.revision_id = $1 AND rf.change_type <> 'deleted'
        "#,
    )
    .bind(active_id)
    .fetch_all(db)
    .await
    .map_err(AppError::from_db)?;

    Ok(rows
        .into_iter()
        .map(|row| {
            let description = if row.is_text {
                let text = row.text_preview.as_deref().unwrap_or("");
                if row.path.ends_with("/SKILL.md") || row.path == "SKILL.md" {
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
                format!("{} attachment", row.media_type)
            };
            (
                row.path.clone(),
                WorkspaceFile {
                    path: row.path,
                    blob_id: row.blob_id,
                    sha256: row.sha256,
                    size_bytes: row.size_bytes,
                    is_text: row.is_text,
                    media_type: row.media_type,
                    token_count: row.token_count,
                    description,
                },
            )
        })
        .collect())
}
