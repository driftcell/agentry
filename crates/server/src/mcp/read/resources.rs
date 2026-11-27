use std::time::Duration;

use rmcp::model::{
    ListResourcesResult,
    PaginatedRequestParams, ResourceContents,
};

use crate::AppState;
use crate::content::blob_by_id;
use crate::error::ToolError;
use crate::paths::normalize_path;
use crate::project::Project;
use crate::workspace::{
    all_directories, direct_children, load_active_files,
    paginate, resource_for_directory, resource_for_file,
};


pub(super) fn skill_path_from_uri(project: &Project, uri: &str) -> Option<String> {
    let rest = uri.strip_prefix("skill://")?;
    let (slug, rest) = rest.split_once('/')?;
    if slug != project.slug {
        return None;
    }
    let (name, relative) = rest.split_once('/')?;
    if name.is_empty() || relative.is_empty() || name.contains('/') {
        return None;
    }
    let relative = percent_encoding::percent_decode_str(relative)
        .decode_utf8()
        .ok()?;
    let path = format!("skills/{name}/{relative}");
    normalize_path(&path).ok()
}

pub(super) async fn read_resource_contents(
    state: &AppState,
    project: &Project,
    files: &std::collections::HashMap<String, crate::workspace::WorkspaceFile>,
    uri: &str,
) -> Result<ResourceContents, ToolError> {
    let path = if let Some((slug, path)) = crate::paths::parse_resource_uri(uri) {
        if slug != project.slug {
            return Err(ToolError::not_found("resource not found"));
        }
        if path.is_empty() {
            return Err(ToolError::new(
                "DIRECTORY_RESOURCE",
                "use resources/directory/read for directories",
            ));
        }
        path
    } else if let Some(path) = skill_path_from_uri(project, uri) {
        path
    } else {
        return Err(ToolError::not_found("resource not found"));
    };
    let file = files
        .get(&path)
        .ok_or_else(|| ToolError::not_found("resource not found"))?;
    let blob = blob_by_id(&state.db, file.blob_id)
        .await
        .map_err(|e| ToolError::internal(format!("load blob: {e}")))?
        .ok_or_else(|| ToolError::not_found("resource not found"))?;
    if blob.is_text {
        Ok(ResourceContents::text(
            blob.text_content.unwrap_or_default(),
            uri,
        )
        .with_mime_type(blob.media_type))
    } else {
        let key = blob
            .object_key
            .as_deref()
            .ok_or_else(|| ToolError::internal("binary blob has no object key"))?;
        let ttl = state
            .config
            .oss
            .as_ref()
            .map(|o| o.presign_ttl)
            .unwrap_or(Duration::from_secs(600));
        let url = state
            .storage
            .presign_get(key, ttl)
            .await
            .map_err(|e| ToolError::internal(format!("sign attachment: {e}")))?;
        Ok(ResourceContents::text(url, uri).with_mime_type("text/uri-list"))
    }
}

impl super::ReadServer {
    pub(super) async fn list_resources_page(
        &self,
        project: &Project,
        request: Option<PaginatedRequestParams>,
    ) -> Result<ListResourcesResult, ToolError> {
        let files = load_active_files(&self.state.db, project)
            .await
            .map_err(ToolError::from)?;
        let mut paths: Vec<String> = files.keys().cloned().collect();
        paths.sort();
        let (page, next) = paginate(&paths, request.as_ref().and_then(|r| r.cursor.as_deref()), 100)?;
        let resources = page
            .iter()
            .filter_map(|path| files.get(path))
            .map(|file| resource_for_file(project, file))
            .collect();
        let mut result = ListResourcesResult::with_all_items(resources);
        result.next_cursor = next;
        Ok(result)
    }

    pub(super) async fn directory_page(
        &self,
        project: &Project,
        uri: &str,
        cursor: Option<&str>,
    ) -> Result<ListResourcesResult, ToolError> {
        let (slug, mut directory) = crate::paths::parse_resource_uri(uri)
            .ok_or_else(|| ToolError::not_found("directory resource not found"))?;
        if slug != project.slug {
            return Err(ToolError::not_found("directory resource not found"));
        }
        directory = directory.trim_end_matches('/').to_string();
        if !directory.is_empty() {
            directory = normalize_path(&directory).map_err(ToolError::bad_request)?;
        }
        let files = load_active_files(&self.state.db, project)
            .await
            .map_err(ToolError::from)?;
        let directories = all_directories(&files);
        if !directories.contains(&directory) {
            return Err(ToolError::not_found("directory not found"));
        }
        let (dirs, file_paths) = direct_children(&files, &directory);
        let mut children: Vec<rmcp::model::Resource> = dirs
            .iter()
            .map(|dir| resource_for_directory(project, dir))
            .collect();
        children.extend(
            file_paths
                .iter()
                .filter_map(|path| files.get(path))
                .map(|file| resource_for_file(project, file)),
        );
        let (page, next) = paginate(&children, cursor, 100)?;
        let mut result = ListResourcesResult::with_all_items(page);
        result.next_cursor = next;
        Ok(result)
    }
}

