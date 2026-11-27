use std::collections::{BTreeMap, BTreeSet, HashMap};



use super::model::{KindFilter, WorkspaceFile, WorkspaceSummary};

pub fn render_tree(files: &HashMap<String, WorkspaceFile>, filter: KindFilter) -> WorkspaceSummary {
    #[derive(Default)]
    struct DirNode {
        tokens: i64,
        file_count: usize,
        children: BTreeMap<String, DirNode>,
        files: BTreeMap<String, (String, i32)>,
    }

    let mut root = DirNode::default();
    let mut selected: Vec<&WorkspaceFile> = files
        .values()
        .filter(|file| filter.matches(&file.path))
        .collect();
    selected.sort_by(|a, b| a.path.cmp(&b.path));

    for file in &selected {
        let mut components = file.path.split('/').peekable();
        let mut node = &mut root;
        let token = i64::from(file.token_count.unwrap_or(0));
        node.tokens += token;
        node.file_count += 1;
        while let Some(component) = components.next() {
            if components.peek().is_none() {
                node.files.insert(
                    component.to_string(),
                    (file.description.clone(), file.token_count.unwrap_or(0)),
                );
            } else {
                let child = node.children.entry(component.to_string()).or_default();
                child.tokens += token;
                child.file_count += 1;
                node = child;
            }
        }
    }

    let mut out = String::new();
    fn walk(node: &DirNode, prefix: &str, out: &mut String, files: &HashMap<String, WorkspaceFile>) {
        for (name, child) in &node.children {
            let path = if prefix.is_empty() { name.clone() } else { format!("{prefix}/{name}") };
            out.push_str(&format!(
                "{}{}/  [{} tokens, {} files]\n",
                "  ".repeat(path.matches('/').count()),
                name,
                child.tokens,
                child.file_count
            ));
            walk(child, &path, out, files);
        }
        for (name, (description, tokens)) in &node.files {
            let depth = prefix.matches('/').count() + usize::from(!prefix.is_empty());
            out.push_str(&format!(
                "{}{}  [{} tokens] {}\n",
                "  ".repeat(depth),
                name,
                tokens,
                description
            ));
        }
    }
    walk(&root, "", &mut out, files);

    WorkspaceSummary {
        project: String::new(),
        revision_id: None,
        files: selected.len(),
        tokens: root.tokens,
        tree: out,
    }
}

pub fn all_directories(files: &HashMap<String, WorkspaceFile>) -> BTreeSet<String> {
    let mut dirs = BTreeSet::new();
    dirs.insert(String::new());
    for path in files.keys() {
        let mut components: Vec<&str> = path.split('/').collect();
        components.pop();
        let mut current = String::new();
        for component in components {
            if current.is_empty() {
                current = component.to_string();
            } else {
                current.push('/');
                current.push_str(component);
            }
            dirs.insert(current.clone());
        }
    }
    dirs
}

pub fn direct_children(
    files: &HashMap<String, WorkspaceFile>,
    directory: &str,
) -> (Vec<String>, Vec<String>) {
    let prefix = if directory.is_empty() { String::new() } else { format!("{directory}/") };
    let mut dirs = BTreeSet::new();
    let mut file_paths = BTreeSet::new();
    for path in files.keys() {
        let Some(rest) = path.strip_prefix(&prefix) else { continue };
        if rest.is_empty() {
            continue;
        }
        if let Some((first, _)) = rest.split_once('/') {
            let child = if prefix.is_empty() { first.to_string() } else { format!("{prefix}{first}") };
            dirs.insert(child);
        } else {
            file_paths.insert(path.clone());
        }
    }
    (dirs.into_iter().collect(), file_paths.into_iter().collect())
}

