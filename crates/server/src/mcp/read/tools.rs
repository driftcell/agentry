use std::io::Write;
use std::time::Duration;

use crate::content::blob_by_id;
use crate::error::ToolError;
use crate::markdown::{Outline, OutlineSection, render_outline};
use crate::paths::{
    bundle_key, normalize_path, shell_quote, single_bundle_key, validate_local_target,
};
use crate::project::ProjectContext;
use crate::tokens::{count_tokens, truncate_to_tokens};
use crate::workspace::{KindFilter, load_active_files, render_tree};
use flate2::Compression;
use flate2::write::GzEncoder;

use super::args::*;
use super::outputs::*;

impl super::ReadServer {
    pub(super) async fn inspect_workspace(
        &self,
        ctx: &ProjectContext,
        args: InspectArgs,
    ) -> Result<InspectOutput, ToolError> {
        let project = ctx.project()?;
        let filter = KindFilter::parse(args.kind_filter.as_deref())?;
        let files = load_active_files(&self.state.db, project)
            .await
            .map_err(ToolError::from)?;
        let mut summary = render_tree(&files, filter);
        summary.project = project.slug.clone();
        summary.revision_id = project.active_revision_id;
        let revision_code = if let Some(rev_id) = project.active_revision_id {
            sqlx::query_scalar::<_, String>("SELECT short_code FROM revisions WHERE id = $1")
                .bind(rev_id)
                .fetch_optional(&self.state.db)
                .await
                .map_err(|e| ToolError::internal(format!("load revision short_code: {e}")))?
                .unwrap_or_else(|| rev_id.to_string())
        } else {
            "none".to_string()
        };
        Ok(InspectOutput {
            project: summary.project,
            revision: revision_code,
            revision_uuid: summary.revision_id,
            files: summary.files,
            tokens: summary.tokens,
            tree: summary.tree,
        })
    }

    pub(super) async fn read_slice(
        &self,
        ctx: &ProjectContext,
        args: ReadSliceArgs,
    ) -> Result<ReadSliceOutput, ToolError> {
        let project = ctx.project()?;
        let path = normalize_path(&args.path).map_err(ToolError::bad_request)?;
        let files = load_active_files(&self.state.db, project)
            .await
            .map_err(ToolError::from)?;
        let file = files
            .get(&path)
            .ok_or_else(|| ToolError::not_found(format!("{path} is not in the active revision")))?;
        let blob = blob_by_id(&self.state.db, file.blob_id)
            .await
            .map_err(|e| ToolError::internal(format!("load blob: {e}")))?
            .ok_or_else(|| ToolError::not_found("file content not found"))?;
        if !blob.is_text {
            return Err(ToolError::new(
                "NOT_TEXT",
                "this is a binary attachment; use resources/read to obtain a signed URL",
            ));
        }
        let text = blob.text_content.clone().unwrap_or_default();
        let file_tokens = blob
            .token_count
            .unwrap_or_else(|| count_tokens(&text) as i32);
        let mode = args.mode;

        let max_tokens = args.max_tokens.unwrap_or(20_000);
        if max_tokens == 0 || max_tokens > 200_000 {
            return Err(ToolError::bad_request(
                "max_tokens must be between 1 and 200000",
            ));
        }

        match mode {
            ReadMode::Outline => {
                let outline = blob
                    .outline
                    .as_ref()
                    .map(|json| json.0.clone())
                    .unwrap_or_else(|| Outline {
                        total_tokens: file_tokens as usize,
                        preamble_tokens: file_tokens as usize,
                        sections: Vec::new(),
                    });
                let content = render_outline(&outline);
                let returned_tokens = count_tokens(&content);
                Ok(ReadSliceOutput {
                    path,
                    mode: "outline".to_string(),
                    section: None,
                    tokens: returned_tokens,
                    file_tokens,
                    truncated: false,
                    max_tokens: None,
                    sections: Some(outline.sections.len()),
                    content,
                })
            }
            ReadMode::Section => {
                let query = args.section.as_deref().ok_or_else(|| {
                    ToolError::bad_request("section is required when mode=section")
                })?;
                let outline = blob
                    .outline
                    .as_ref()
                    .map(|json| json.0.clone())
                    .ok_or_else(|| {
                        ToolError::new("NOT_MARKDOWN", "this file has no Markdown outline")
                    })?;
                let lines: Vec<&str> = text.split('\n').collect();
                let (section_title, raw_content, raw_tokens) =
                    if query.eq_ignore_ascii_case("__preamble__") {
                        let end = outline
                            .sections
                            .first()
                            .map(|s| s.line.saturating_sub(1))
                            .unwrap_or(lines.len())
                            .min(lines.len());
                        (
                            "__preamble__".to_string(),
                            lines[..end].join("\n"),
                            outline.preamble_tokens,
                        )
                    } else {
                        let section = find_outline_section(&outline, query).ok_or_else(|| {
                            let available = outline
                                .sections
                                .iter()
                                .take(12)
                                .map(|s| s.title.as_str())
                                .collect::<Vec<_>>()
                                .join(", ");
                            ToolError::new(
                                "SECTION_NOT_FOUND",
                                format!("no section named {query:?}; available: {available}"),
                            )
                        })?;
                        let start = section.line.saturating_sub(1).min(lines.len());
                        let end = section.end_line.saturating_sub(1).min(lines.len());
                        (
                            section.title.clone(),
                            lines[start..end].join("\n"),
                            section.tokens,
                        )
                    };
                let (content, returned_tokens, truncated) = if raw_tokens > max_tokens {
                    let (content, returned) = truncate_to_tokens(&raw_content, max_tokens);
                    (content, returned, true)
                } else {
                    (raw_content, raw_tokens, false)
                };
                Ok(ReadSliceOutput {
                    path,
                    mode: "section".to_string(),
                    section: Some(section_title),
                    tokens: returned_tokens,
                    file_tokens,
                    truncated,
                    max_tokens: truncated.then_some(max_tokens),
                    sections: None,
                    content,
                })
            }
            ReadMode::Full => {
                let (content, returned_tokens, truncated) = if file_tokens as usize > max_tokens {
                    let (content, returned) = truncate_to_tokens(&text, max_tokens);
                    (content, returned, true)
                } else {
                    (text, file_tokens as usize, false)
                };
                Ok(ReadSliceOutput {
                    path,
                    mode: "full".to_string(),
                    section: None,
                    tokens: returned_tokens,
                    file_tokens,
                    truncated,
                    max_tokens: Some(max_tokens),
                    sections: None,
                    content,
                })
            }
        }
    }

    pub(super) async fn pull_bundle_url(
        &self,
        ctx: &ProjectContext,
        args: BundleArgs,
    ) -> Result<PullBundleOutput, ToolError> {
        let project = ctx.project()?;
        let files = load_active_files(&self.state.db, project)
            .await
            .map_err(ToolError::from)?;
        let local_target =
            validate_local_target(args.local_target_dir.as_deref().unwrap_or("agentry-bundle"))?;
        let mut selected = if let Some(paths) = &args.paths {
            if paths.is_empty() {
                return Err(ToolError::bad_request(
                    "paths must not be empty when provided",
                ));
            }
            let normalized =
                crate::paths::normalize_path_set(paths).map_err(ToolError::bad_request)?;
            for path in &normalized {
                if !files.contains_key(path) {
                    return Err(ToolError::not_found(format!(
                        "{path} is not in the active revision"
                    )));
                }
            }
            normalized
        } else {
            let mut all: Vec<String> = files.keys().cloned().collect();
            all.sort();
            all
        };
        selected.sort();
        selected.dedup();
        if selected.len() > 500 {
            return Err(ToolError::bad_request("select at most 500 files"));
        }

        let mut total_bytes = 0u64;
        let mut total_tokens = 0i64;
        let mut contents: Vec<(String, Vec<u8>)> = Vec::new();
        for path in &selected {
            let file = files.get(path).expect("selected path exists");
            let blob = blob_by_id(&self.state.db, file.blob_id)
                .await
                .map_err(|e| ToolError::internal(format!("load blob: {e}")))?
                .ok_or_else(|| ToolError::not_found("file content not found"))?;
            let bytes = if let Some(text) = blob.text_content {
                text.into_bytes()
            } else {
                let key = blob
                    .object_key
                    .as_deref()
                    .ok_or_else(|| ToolError::internal("binary blob has no object key"))?;
                self.state
                    .storage
                    .get(key)
                    .await
                    .map_err(|e| ToolError::internal(format!("fetch binary: {e}")))?
                    .to_vec()
            };
            total_bytes += bytes.len() as u64;
            total_tokens += i64::from(blob.token_count.unwrap_or(0));
            if total_bytes > 128 * 1024 * 1024 {
                return Err(ToolError::new(
                    "BUNDLE_TOO_LARGE",
                    "the selected files exceed the 128 MiB bundle limit; select fewer paths",
                ));
            }
            contents.push((path.clone(), bytes));
        }

        let bundle_id = uuid::Uuid::new_v4();
        let format = args.format.unwrap_or(BundleFormat::TarGz);
        let (key, object, suggested_name) = match format {
            BundleFormat::TarGz => {
                let tar = build_tar(&contents)
                    .map_err(|e| ToolError::internal(format!("build tar: {e}")))?;
                let gz = gzip(&tar).map_err(|e| ToolError::internal(format!("gzip tar: {e}")))?;
                (
                    bundle_key(project.id, bundle_id),
                    gz,
                    "agentry-bundle.tar.gz".to_string(),
                )
            }
            BundleFormat::Single => {
                if contents.len() != 1 {
                    return Err(ToolError::bad_request(
                        "format=single requires exactly one path",
                    ));
                }
                let (path, bytes) = &contents[0];
                let name = path
                    .rsplit('/')
                    .next()
                    .unwrap_or("download.bin")
                    .to_string();
                (
                    single_bundle_key(project.id, bundle_id, path),
                    bytes.clone(),
                    name,
                )
            }
        };
        let ttl = self
            .state
            .config
            .oss
            .as_ref()
            .map(|o| o.bundle_ttl)
            .unwrap_or(Duration::from_secs(900));
        self.state
            .storage
            .put(
                &key,
                bytes::Bytes::from(object),
                Some(match format {
                    BundleFormat::TarGz => "application/gzip",
                    BundleFormat::Single => "application/octet-stream",
                }),
            )
            .await
            .map_err(|e| ToolError::internal(format!("store bundle: {e}")))?;
        let url = self
            .state
            .storage
            .presign_get(&key, ttl)
            .await
            .map_err(|e| ToolError::internal(format!("sign bundle: {e}")))?;
        let expires = chrono::Utc::now() + chrono::Duration::seconds(ttl.as_secs() as i64);
        let _ = sqlx::query(
            "INSERT INTO bundle_exports (project_id, object_key, expires_at) VALUES ($1, $2, $3)",
        )
        .bind(project.id)
        .bind(&key)
        .bind(expires)
        .execute(&self.state.db)
        .await;

        let command = bundle_command(format, &url, &local_target, &suggested_name);
        Ok(PullBundleOutput {
            format: match format {
                BundleFormat::TarGz => "tar_gz",
                BundleFormat::Single => "single",
            }
            .to_string(),
            url,
            expires_at: expires.to_rfc3339(),
            file_count: selected.len(),
            files: selected,
            bytes: total_bytes,
            tokens: total_tokens,
            local_target_dir: local_target,
            command,
        })
    }
}

fn bundle_command(
    format: BundleFormat,
    url: &str,
    local_target: &str,
    suggested_name: &str,
) -> String {
    match format {
        BundleFormat::TarGz => {
            let archive = format!("{local_target}/{suggested_name}");
            format!(
                "mkdir -p {} && curl -fsSL --output {} {} && tar -xzf {} -C {}",
                shell_quote(local_target),
                shell_quote(&archive),
                shell_quote(url),
                shell_quote(&archive),
                shell_quote(local_target)
            )
        }
        BundleFormat::Single => {
            let file = format!("{local_target}/{suggested_name}");
            format!(
                "mkdir -p {} && curl -fsSL --output {} {}",
                shell_quote(local_target),
                shell_quote(&file),
                shell_quote(url)
            )
        }
    }
}

fn build_tar(contents: &[(String, Vec<u8>)]) -> std::io::Result<Vec<u8>> {
    let mut builder = tar::Builder::new(Vec::new());
    for (path, bytes) in contents {
        let mut header = tar::Header::new_gnu();
        header.set_size(bytes.len() as u64);
        header.set_mode(0o644);
        header.set_mtime(0);
        header.set_cksum();
        builder.append_data(&mut header, path, std::io::Cursor::new(bytes))?;
    }
    builder.into_inner()
}

fn gzip(bytes: &[u8]) -> std::io::Result<Vec<u8>> {
    let mut encoder = GzEncoder::new(Vec::new(), Compression::default());
    encoder.write_all(bytes)?;
    encoder.finish()
}

fn find_outline_section<'a>(outline: &'a Outline, query: &str) -> Option<&'a OutlineSection> {
    let query = query.trim().trim_start_matches('#').trim();
    outline
        .sections
        .iter()
        .find(|section| section.title.eq_ignore_ascii_case(query) || section.title == query)
}
