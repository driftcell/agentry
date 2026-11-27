use rmcp::model::{Annotations, Role};

use crate::paths::{project_uri_prefix, resource_uri};
use crate::project::Project;

use super::model::WorkspaceFile;

pub fn resource_for_file(project: &Project, file: &WorkspaceFile) -> rmcp::model::Resource {
    let mut resource =
        rmcp::model::Resource::new(resource_uri(&project.slug, &file.path), file.path.clone())
            .with_mime_type(file.media_type.clone())
            .with_size(file.size_bytes.max(0) as u64);
    if !file.description.is_empty() {
        resource = resource.with_description(file.description.clone());
    }
    let priority = if file.path == "CLAUDE.md" || file.path == "AGENTS.md" {
        Some(1.0)
    } else if file.path.ends_with("/SKILL.md") || file.path.starts_with("agents/") {
        Some(0.8)
    } else {
        None
    };
    if let Some(p) = priority {
        let mut annotations = Annotations::default();
        annotations.audience = Some(vec![Role::Assistant]);
        annotations.priority = Some(p);
        resource = resource.with_annotations(annotations);
    }
    resource
}

pub fn resource_for_directory(project: &Project, directory: &str) -> rmcp::model::Resource {
    // SEP-2640: directory URIs have no trailing slash.
    let uri = if directory.is_empty() {
        project_uri_prefix(&project.slug)
    } else {
        resource_uri(&project.slug, directory)
    };
    rmcp::model::Resource::new(uri, directory.to_string())
        .with_mime_type(rmcp::model::DIRECTORY_MIME_TYPE)
}
