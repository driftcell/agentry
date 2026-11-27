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
    resource
}

pub fn resource_for_directory(project: &Project, directory: &str) -> rmcp::model::Resource {
    let uri = if directory.is_empty() {
        format!("{}/", project_uri_prefix(&project.slug))
    } else {
        resource_uri(&project.slug, directory) + "/"
    };
    rmcp::model::Resource::new(uri, directory.to_string())
        .with_mime_type(rmcp::model::DIRECTORY_MIME_TYPE)
}
