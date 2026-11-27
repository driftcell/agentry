use std::collections::{BTreeSet, HashMap};

use sqlx::PgPool;

use crate::content::blob_by_id;
use crate::error::AppError;
use crate::markdown::parse_frontmatter;
use crate::paths::skill_uri;
use crate::project::Project;

use super::model::WorkspaceFile;

#[derive(Debug, Clone)]
pub struct SkillEntry {
    pub name: String,
    pub uri: String,
    pub blob_id: uuid::Uuid,
    pub skill: rmcp::model::Skill,
}

pub async fn collect_skill_entries(
    db: &PgPool,
    project: &Project,
    files: &HashMap<String, WorkspaceFile>,
) -> Result<Vec<SkillEntry>, AppError> {
    let mut names = BTreeSet::new();
    for path in files.keys() {
        let Some(rest) = path.strip_prefix("skills/") else { continue };
        let mut parts = rest.split('/');
        let (Some(name), Some("SKILL.md")) = (parts.next(), parts.next()) else { continue };
        if parts.next().is_none() && !name.is_empty() {
            names.insert(name.to_string());
        }
    }

    let mut skills = Vec::new();
    for name in names {
        let root = format!("skills/{name}");
        let skill_md_path = format!("{root}/SKILL.md");
        let Some(workspace_file) = files.get(&skill_md_path) else { continue };
        let Some(blob) = blob_by_id(db, workspace_file.blob_id)
            .await
            .map_err(|e| AppError::internal(format!("load skill blob: {e}")))?
        else {
            continue;
        };
        let Some(text) = blob.text_content.as_deref() else { continue };
        let Some(front) = parse_frontmatter(text) else { continue };
        let Some(name_value) = front.value.get("name").and_then(|v| v.as_str()) else { continue };
        let Some(description) = front.value.get("description").and_then(|v| v.as_str()) else {
            continue;
        };
        let mut extra = serde_json::Map::new();
        if let serde_yaml_ng::Value::Mapping(mapping) = &front.value {
            for (key, value) in mapping {
                let Some(key) = key.as_str() else { continue };
                if key == "name" || key == "description" {
                    continue;
                }
                if let Ok(value) = serde_json::to_value(value) {
                    extra.insert(key.to_string(), value);
                }
            }
        }
        let mut frontmatter = rmcp::model::SkillFrontmatter::new(
            name_value.to_string(),
            description.to_string(),
        );
        for (key, value) in extra {
            frontmatter = frontmatter.with_field(key, value);
        }

        let mut resources = Vec::new();
        let prefix = format!("{root}/");
        let mut file_paths: Vec<&String> = files
            .keys()
            .filter(|path| path.starts_with(&prefix) || **path == skill_md_path)
            .collect();
        file_paths.sort();
        for path in file_paths {
            let Some(file) = files.get(path) else { continue };
            let relative = path.strip_prefix(&prefix).unwrap_or("SKILL.md");
            let uri = if relative == "SKILL.md" {
                skill_uri(&project.slug, &name)
            } else {
                format!(
                    "skill://{}/{}/{}",
                    project.slug,
                    percent_encoding::utf8_percent_encode(&name, percent_encoding::NON_ALPHANUMERIC),
                    relative
                        .split('/')
                        .map(|segment| percent_encoding::utf8_percent_encode(
                            segment,
                            percent_encoding::NON_ALPHANUMERIC
                        )
                        .to_string())
                        .collect::<Vec<_>>()
                        .join("/")
                )
            };
            resources.push(rmcp::model::SkillResource::new(
                uri,
                format!("sha256:{}", file.sha256),
                file.size_bytes.max(0) as u64,
            ));
        }

        let skill = rmcp::model::Skill::new(
            skill_uri(&project.slug, &name),
            frontmatter,
            rmcp::model::SkillResources::Files(resources),
        );
        if skill.validate().is_err() {
            tracing::warn!(project = %project.slug, skill = %name, "skipping invalid skill manifest");
            continue;
        }
        skills.push(SkillEntry {
            name: name.clone(),
            uri: skill.uri.clone(),
            blob_id: workspace_file.blob_id,
            skill,
        });
    }
    Ok(skills)
}


