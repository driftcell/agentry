use serde::{Deserialize, Serialize};

use crate::tokens::count_tokens;

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct OutlineSection {
    pub level: u8,
    pub title: String,
    /// 1-based line of the heading.
    pub line: usize,
    /// 1-based, exclusive end line of the section (including subsections).
    pub end_line: usize,
    pub tokens: usize,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct Outline {
    pub total_tokens: usize,
    pub preamble_tokens: usize,
    pub sections: Vec<OutlineSection>,
}

#[derive(Debug, Clone)]
pub struct ParsedSection {
    pub meta: OutlineSection,
    pub content: String,
}

#[derive(Debug, Clone)]
pub struct ParsedMarkdown {
    pub outline: Outline,
    pub sections: Vec<ParsedSection>,
}

struct Heading {
    level: u8,
    title: String,
    line_index: usize,
}

fn heading_at(line: &str) -> Option<(u8, String)> {
    let trimmed = line.trim_end();
    let hashes = trimmed.bytes().take_while(|b| *b == b'#').count();
    if hashes == 0 || hashes > 3 {
        return None;
    }
    let rest = &trimmed[hashes..];
    if !rest.starts_with(' ') && !rest.starts_with('\t') {
        return None;
    }
    let title = rest.trim().trim_end_matches('#').trim();
    if title.is_empty() {
        return None;
    }
    Some((hashes as u8, title.to_string()))
}

fn fence_marker(line: &str) -> Option<(u8, usize)> {
    let trimmed = line.trim_start();
    let byte = trimmed.as_bytes().first().copied()?;
    if byte != b'`' && byte != b'~' {
        return None;
    }
    let count = trimmed.bytes().take_while(|b| *b == byte).count();
    if count < 3 {
        return None;
    }
    Some((byte, count))
}

fn scan_headings(text: &str) -> Vec<Heading> {
    let lines: Vec<&str> = text.split('\n').collect();
    let mut headings = Vec::new();
    let mut fence: Option<(u8, usize)> = None;
    for (index, line) in lines.iter().enumerate() {
        if let Some((byte, count)) = fence {
            let trimmed = line.trim_start();
            let closing = trimmed.bytes().take_while(|b| *b == byte).count();
            if closing >= count && trimmed[closing..].trim().is_empty() {
                fence = None;
            }
            continue;
        }
        if let Some(marker) = fence_marker(line) {
            fence = Some(marker);
            continue;
        }
        if let Some((level, title)) = heading_at(line) {
            headings.push(Heading {
                level,
                title,
                line_index: index,
            });
        }
    }
    headings
}

pub fn parse_markdown(text: &str) -> ParsedMarkdown {
    let lines: Vec<&str> = text.split('\n').collect();
    let headings = scan_headings(text);
    let total_tokens = count_tokens(text);
    let preamble_end = headings
        .first()
        .map(|h| h.line_index)
        .unwrap_or(lines.len());
    let preamble = lines[..preamble_end].join("\n");
    let preamble_tokens = count_tokens(&preamble);

    let mut sections = Vec::with_capacity(headings.len());
    for (index, heading) in headings.iter().enumerate() {
        let end_line_index = headings[index + 1..]
            .iter()
            .find(|next| next.level <= heading.level)
            .map(|next| next.line_index)
            .unwrap_or(lines.len());
        let content = lines[heading.line_index..end_line_index].join("\n");
        let tokens = count_tokens(&content);
        sections.push(ParsedSection {
            meta: OutlineSection {
                level: heading.level,
                title: heading.title.clone(),
                line: heading.line_index + 1,
                end_line: end_line_index + 1,
                tokens,
            },
            content,
        });
    }

    let outline = Outline {
        total_tokens,
        preamble_tokens,
        sections: sections
            .iter()
            .map(|section| section.meta.clone())
            .collect(),
    };
    ParsedMarkdown { outline, sections }
}

/// Render an outline as compact text. Only headings are included; this is the
/// primary mechanism for reading a large file without pulling the whole body.
pub fn render_outline(outline: &Outline) -> String {
    let mut out = String::new();
    out.push_str(&format!(
        "{} lines with {} sections; {} tokens total (preamble {} tokens)\n",
        outline
            .sections
            .last()
            .map(|s| s.end_line.saturating_sub(1))
            .unwrap_or(0),
        outline.sections.len(),
        outline.total_tokens,
        outline.preamble_tokens
    ));
    for section in &outline.sections {
        let indent = "  ".repeat((section.level - 1) as usize);
        out.push_str(&format!(
            "{indent}{} {}  [{} tokens, L{}-{}]\n",
            "#".repeat(section.level as usize),
            section.title,
            section.tokens,
            section.line,
            section.end_line.saturating_sub(1).max(section.line)
        ));
    }
    out
}

pub fn find_section<'a>(sections: &'a [ParsedSection], query: &str) -> Option<&'a ParsedSection> {
    let normalized = query.trim().trim_start_matches('#').trim();
    sections.iter().find(|section| {
        section.meta.title.eq_ignore_ascii_case(normalized) || section.meta.title == normalized
    })
}

/// First meaningful line of prose, used for the workspace tree description.
pub fn one_line_description(text: &str, max_len: usize) -> String {
    let body = strip_frontmatter(text).unwrap_or(text);
    for line in body.lines() {
        let trimmed = line.trim();
        if trimmed.is_empty()
            || trimmed.starts_with('#')
            || trimmed == "---"
            || trimmed.starts_with("```")
            || trimmed.starts_with("<!--")
        {
            continue;
        }
        let mut description = String::with_capacity(trimmed.len());
        let mut prev_space = false;
        for ch in trimmed.chars() {
            let ch = match ch {
                '*' | '_' | '`' | '>' | '[' | ']' => ' ',
                other => other,
            };
            if ch.is_whitespace() {
                if !prev_space {
                    description.push(' ');
                }
                prev_space = true;
            } else {
                description.push(ch);
                prev_space = false;
            }
        }
        let description = description.trim();
        if !description.is_empty() {
            return truncate_chars(description, max_len);
        }
    }
    String::new()
}

pub fn truncate_chars(value: &str, max_len: usize) -> String {
    if value.chars().count() <= max_len {
        return value.to_string();
    }
    let mut out: String = value.chars().take(max_len.saturating_sub(1)).collect();
    out.push('…');
    out
}

/// Returns the body after a leading `---` YAML block, if one exists.
pub fn strip_frontmatter(text: &str) -> Option<&str> {
    let rest = text.strip_prefix("---")?;
    let rest = rest
        .strip_prefix('\n')
        .or_else(|| rest.strip_prefix("\r\n"))?;
    let mut offset = 0usize;
    for line in rest.split_inclusive('\n') {
        if line.trim_end_matches(['\r', '\n']) == "---" {
            return Some(&rest[offset + line.len()..]);
        }
        offset += line.len();
    }
    None
}

pub struct Frontmatter<'a> {
    pub value: serde_yaml_ng::Value,
    pub body: &'a str,
}

pub fn parse_frontmatter(text: &str) -> Option<Frontmatter<'_>> {
    let rest = text.strip_prefix("---")?;
    let rest = rest
        .strip_prefix('\n')
        .or_else(|| rest.strip_prefix("\r\n"))?;
    let mut offset = 0usize;
    for line in rest.split_inclusive('\n') {
        if line.trim_end_matches(['\r', '\n']) == "---" {
            let raw = &rest[..offset];
            let value: serde_yaml_ng::Value = serde_yaml_ng::from_str(raw).ok()?;
            return Some(Frontmatter {
                value,
                body: &rest[offset + line.len()..],
            });
        }
        offset += line.len();
    }
    None
}

#[cfg(test)]
mod tests {
    use super::*;

    const SAMPLE: &str = r#"---
name: reviewer
description: Review changes
---

Intro paragraph.

# Top
Top body.
## Child
Child body.
### Grandchild
Grand text.
## Second child
Second body.
# Last
Last body.
"#;

    #[test]
    fn outline_tracks_levels_and_nested_boundaries() {
        let parsed = parse_markdown(SAMPLE);
        let titles: Vec<_> = parsed
            .outline
            .sections
            .iter()
            .map(|s| (s.level, s.title.as_str()))
            .collect();
        assert_eq!(
            titles,
            vec![
                (1, "Top"),
                (2, "Child"),
                (3, "Grandchild"),
                (2, "Second child"),
                (1, "Last"),
            ]
        );
        let top = find_section(&parsed.sections, "Top").unwrap();
        assert!(top.content.contains("Second body."));
        assert!(!top.content.contains("Last body."));
        let child = find_section(&parsed.sections, "Child").unwrap();
        assert!(child.content.contains("Grand text."));
        assert!(!child.content.contains("Second body."));
        let grandchild = find_section(&parsed.sections, "Grandchild").unwrap();
        assert!(grandchild.content.contains("Grand text."));
        assert!(!grandchild.content.contains("Child body."));
        assert!(parsed.outline.preamble_tokens > 0);
        assert_eq!(
            parsed
                .outline
                .sections
                .iter()
                .map(|s| s.tokens)
                .sum::<usize>(),
            parsed
                .sections
                .iter()
                .map(|s| crate::tokens::count_tokens(&s.content))
                .sum::<usize>()
        );
    }

    #[test]
    fn headings_in_fenced_code_are_ignored() {
        let text = "# Real\n```md\n# Not a heading\n```\n## Child\n";
        let parsed = parse_markdown(text);
        assert_eq!(parsed.outline.sections.len(), 2);
        assert_eq!(parsed.outline.sections[1].title, "Child");
    }

    #[test]
    fn section_lookup_is_case_insensitive_and_accepts_hash_prefix() {
        let parsed = parse_markdown(SAMPLE);
        let section = find_section(&parsed.sections, "## child").unwrap();
        assert!(section.content.contains("Child body."));
        assert!(find_section(&parsed.sections, "missing").is_none());
    }

    #[test]
    fn frontmatter_is_parsed_and_stripped() {
        let front = parse_frontmatter(SAMPLE).unwrap();
        assert_eq!(front.value["name"].as_str(), Some("reviewer"));
        assert!(front.body.starts_with("\nIntro paragraph."));
        assert_eq!(one_line_description(SAMPLE, 80), "Intro paragraph.");
    }
}
