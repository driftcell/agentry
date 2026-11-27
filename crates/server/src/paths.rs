use std::collections::HashSet;

use crate::error::ToolError;

pub const MAX_PATH_LEN: usize = 512;

/// Normalize a workspace path. Workspace paths are POSIX relative paths with no
/// empty, `.` or `..` segments, no backslashes, no absolute roots and no
/// control characters. The returned value is the canonical path stored in the
/// database and used in object keys.
pub fn normalize_path(input: &str) -> Result<String, String> {
    if input.is_empty() {
        return Err("path must not be empty".into());
    }
    if input.len() > MAX_PATH_LEN {
        return Err(format!("path exceeds {MAX_PATH_LEN} characters"));
    }
    if input.starts_with('/') || input.starts_with('\\') {
        return Err("absolute paths are not allowed".into());
    }
    if input.contains('\\') {
        return Err("backslashes are not allowed in workspace paths".into());
    }
    if input.len() >= 2 && input.as_bytes()[1] == b':' && input.as_bytes()[0].is_ascii_alphabetic()
    {
        return Err("drive-letter paths are not allowed".into());
    }
    if input.chars().any(|c| c.is_control()) {
        return Err("control characters are not allowed in paths".into());
    }
    let mut segments = Vec::new();
    for segment in input.split('/') {
        match segment {
            "" => return Err("empty path segments are not allowed".into()),
            "." | ".." => return Err("dot segments are not allowed".into()),
            _ => segments.push(segment),
        }
    }
    let normalized = segments.join("/");
    if normalized.len() > MAX_PATH_LEN {
        return Err(format!("path exceeds {MAX_PATH_LEN} characters"));
    }
    Ok(normalized)
}

/// Normalize a set of paths and reject duplicates after normalization.
pub fn normalize_path_set(paths: &[String]) -> Result<Vec<String>, String> {
    let mut seen = HashSet::new();
    let mut out = Vec::with_capacity(paths.len());
    for path in paths {
        let normalized = normalize_path(path)?;
        if !seen.insert(normalized.clone()) {
            return Err(format!("duplicate path after normalization: {normalized}"));
        }
        out.push(normalized);
    }
    Ok(out)
}

/// Decode a URI path segment and normalize it. Rejects traversal both before
/// and after percent-decoding.
pub fn path_from_uri(uri_path: &str) -> Result<String, String> {
    let decoded = percent_encoding::percent_decode_str(uri_path)
        .decode_utf8()
        .map_err(|_| "URI path is not valid UTF-8".to_string())?;
    normalize_path(&decoded)
}

pub fn validate_slug(slug: &str) -> Result<(), String> {
    let bytes = slug.as_bytes();
    if bytes.len() < 3 || bytes.len() > 64 {
        return Err("project slug must be 3-64 characters".into());
    }
    if !bytes.first().is_some_and(u8::is_ascii_lowercase)
        && !bytes.first().is_some_and(u8::is_ascii_digit)
    {
        return Err("project slug must start with a lowercase letter or digit".into());
    }
    if !bytes
        .last()
        .is_some_and(|b| b.is_ascii_lowercase() || b.is_ascii_digit())
    {
        return Err("project slug must end with a lowercase letter or digit".into());
    }
    if !bytes
        .iter()
        .all(|b| b.is_ascii_lowercase() || b.is_ascii_digit() || *b == b'-')
    {
        return Err("project slug may contain only lowercase letters, digits and dashes".into());
    }
    if slug.contains("--") {
        return Err("project slug must not contain consecutive dashes".into());
    }
    Ok(())
}

pub fn blob_key(sha256: &str) -> String {
    format!("blobs/{sha256}")
}

pub fn staging_key(project_id: uuid::Uuid, session_id: uuid::Uuid, path: &str) -> String {
    format!("staging/{project_id}/{session_id}/{path}")
}

pub fn bundle_key(project_id: uuid::Uuid, bundle_id: uuid::Uuid) -> String {
    format!("bundles/{project_id}/{bundle_id}.tar.gz")
}

pub fn single_bundle_key(project_id: uuid::Uuid, bundle_id: uuid::Uuid, path: &str) -> String {
    format!(
        "bundles/{project_id}/{bundle_id}/{}",
        sanitize_object_component(path)
    )
}

fn sanitize_object_component(path: &str) -> String {
    // Object keys may include slashes, which is fine under the per-bundle
    // prefix. Control characters and traversal are already rejected upstream.
    path.replace(['\r', '\n'], "_")
}

pub fn shell_quote(value: &str) -> String {
    if value.is_empty() {
        return "''".to_string();
    }
    let mut out = String::with_capacity(value.len() + 2);
    out.push('\'');
    for ch in value.chars() {
        if ch == '\'' {
            out.push_str("'\\''");
        } else {
            out.push(ch);
        }
    }
    out.push('\'');
    out
}

/// A local download target is chosen by the client, but must still be a
/// relative path without traversal or shell metacharacter surprises. The
/// command is only a text suggestion; this validation keeps it safe to paste.
pub fn validate_local_target(input: &str) -> Result<String, ToolError> {
    let trimmed = input.trim();
    if trimmed.is_empty() {
        return Err(ToolError::bad_request("local_target_dir must not be empty"));
    }
    if trimmed.len() > 256 {
        return Err(ToolError::bad_request("local_target_dir is too long"));
    }
    if trimmed.starts_with('/') || trimmed.starts_with('~') {
        return Err(ToolError::bad_request(
            "local_target_dir must be a relative path inside the client workspace",
        ));
    }
    if trimmed.chars().any(|c| c.is_control()) {
        return Err(ToolError::bad_request(
            "local_target_dir must not contain control characters",
        ));
    }
    for segment in trimmed.split('/') {
        if segment.is_empty() || segment == "." || segment == ".." {
            return Err(ToolError::bad_request(
                "local_target_dir must not contain empty, '.' or '..' segments",
            ));
        }
    }
    Ok(trimmed.to_string())
}

/// The URI prefix for a project's workspace resources.
pub fn project_uri_prefix(slug: &str) -> String {
    format!("mcp://{slug}")
}

pub fn resource_uri(slug: &str, path: &str) -> String {
    format!(
        "mcp://{slug}/{}",
        path.split('/')
            .map(|s| percent_encoding::utf8_percent_encode(s, PATH_SEGMENT).to_string())
            .collect::<Vec<_>>()
            .join("/")
    )
}

pub fn skill_uri(slug: &str, name: &str) -> String {
    format!(
        "skill://{slug}/{}/SKILL.md",
        percent_encoding::utf8_percent_encode(name, PATH_SEGMENT)
    )
}

pub fn skill_file_uri(slug: &str, name: &str, relative: &str) -> String {
    format!(
        "skill://{slug}/{}/{}",
        percent_encoding::utf8_percent_encode(name, PATH_SEGMENT),
        relative
            .split('/')
            .map(|segment| percent_encoding::utf8_percent_encode(segment, PATH_SEGMENT).to_string())
            .collect::<Vec<_>>()
            .join("/")
    )
}

pub fn encode_path_segment(segment: &str) -> String {
    percent_encoding::utf8_percent_encode(segment, PATH_SEGMENT).to_string()
}

const PATH_SEGMENT: &percent_encoding::AsciiSet = &percent_encoding::CONTROLS
    .add(b' ')
    .add(b'"')
    .add(b'#')
    .add(b'%')
    .add(b'<')
    .add(b'>')
    .add(b'?')
    .add(b'`')
    .add(b'{')
    .add(b'}');

/// Parse `skill://<slug>/<name>/SKILL.md` into (slug, name).
pub fn parse_skill_uri(uri: &str) -> Option<(String, String)> {
    let rest = uri.strip_prefix("skill://")?;
    let (slug, rest) = rest.split_once('/')?;
    let name = rest.strip_suffix("/SKILL.md")?;
    if name.contains('/') || name.is_empty() {
        return None;
    }
    Some((slug.to_string(), name.to_string()))
}

/// Parse `mcp://<slug>/<path>` into (slug, path).
pub fn parse_resource_uri(uri: &str) -> Option<(String, String)> {
    let rest = uri.strip_prefix("mcp://")?;
    let (slug, rest) = rest.split_once('/')?;
    if rest.is_empty() {
        return Some((slug.to_string(), String::new()));
    }
    path_from_uri(rest).ok().map(|p| (slug.to_string(), p))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn rejects_traversal_and_absolute_paths() {
        for bad in [
            "/etc/passwd",
            "../secret",
            "a/../../b",
            "a//b",
            "a/./b",
            "C:/x",
            "a\\b",
            "",
        ] {
            assert!(normalize_path(bad).is_err(), "{bad:?} should be rejected");
        }
    }

    #[test]
    fn accepts_normal_workspace_paths() {
        assert_eq!(normalize_path("CLAUDE.md").unwrap(), "CLAUDE.md");
        assert_eq!(
            normalize_path("skills/reviewer/SKILL.md").unwrap(),
            "skills/reviewer/SKILL.md"
        );
        assert_eq!(
            normalize_path("docs/with space.md").unwrap(),
            "docs/with space.md"
        );
    }

    #[test]
    fn rejects_duplicate_after_normalization() {
        let err = normalize_path_set(&["a/b".into(), "a/b".into()]).unwrap_err();
        assert!(err.contains("duplicate"));
    }

    #[test]
    fn shell_quote_is_safe() {
        assert_eq!(shell_quote("abc"), "'abc'");
        assert_eq!(shell_quote("a'b"), "'a'\\''b'");
        assert_eq!(shell_quote("$(rm -rf /)"), "'$(rm -rf /)'");
    }

    #[test]
    fn uri_traversal_is_rejected() {
        assert!(path_from_uri("skills/%2e%2e/SKILL.md").is_err());
        assert!(parse_skill_uri("skill://demo/reviewer/SKILL.md").is_some());
        assert!(parse_skill_uri("skill://demo/a/b/SKILL.md").is_none());
    }
}
