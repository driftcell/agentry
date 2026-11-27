import type { WorkspaceFileView } from "./types";

export type FileKindFilter = "all" | "root" | "claude" | "agents" | "skills" | "subagents";

export type WorkspaceFileKind =
  "claude" | "agents" | "skill" | "subagent" | "doc" | "asset" | "file";

export interface FileClassification {
  kind: WorkspaceFileKind;
  badgeLabel: string | null;
  skillName: string | null;
}

export interface DirectoryTreeNode {
  type: "dir";
  name: string;
  path: string;
  tokens: number;
  fileCount: number;
  children: WorkspaceTreeNode[];
}

export interface FileTreeNode {
  type: "file";
  name: string;
  path: string;
  tokens: number;
  file: WorkspaceFileView;
  classification: FileClassification;
}

export type WorkspaceTreeNode = DirectoryTreeNode | FileTreeNode;

export interface MarkdownHeading {
  level: 1 | 2 | 3;
  title: string;
  line: number;
}

export function matchesKindFilter(path: string, filter: FileKindFilter): boolean {
  switch (filter) {
    case "all":
      return true;
    case "root":
      return !path.includes("/");
    case "claude":
      return path === "CLAUDE.md" || path.endsWith("/CLAUDE.md");
    case "agents":
      return path === "AGENTS.md" || path.endsWith("/AGENTS.md");
    case "skills":
      return path.startsWith("skills/");
    case "subagents":
      return path.startsWith("agents/");
  }
}

export function classifyWorkspaceFile(path: string, isText: boolean): FileClassification {
  if (path === "CLAUDE.md" || path.endsWith("/CLAUDE.md")) {
    return { kind: "claude", badgeLabel: "CLAUDE", skillName: null };
  }
  if (path === "AGENTS.md" || path.endsWith("/AGENTS.md")) {
    return { kind: "agents", badgeLabel: "AGENTS", skillName: null };
  }
  const skillMatch = /^skills\/([^/]+)\/SKILL\.md$/.exec(path);
  if (skillMatch) {
    return { kind: "skill", badgeLabel: "SKILL", skillName: skillMatch[1] ?? null };
  }
  if (path.startsWith("agents/") && isText) {
    return { kind: "subagent", badgeLabel: "SUB-AGENT", skillName: null };
  }
  if (!isText) {
    return { kind: "asset", badgeLabel: "BINARY", skillName: null };
  }
  if (path.endsWith(".md") || path.endsWith(".mdx")) {
    return { kind: "doc", badgeLabel: null, skillName: null };
  }
  return { kind: "file", badgeLabel: null, skillName: null };
}

interface MutableDir {
  name: string;
  path: string;
  tokens: number;
  fileCount: number;
  dirs: Map<string, MutableDir>;
  files: FileTreeNode[];
}

export function buildFileTree(
  files: WorkspaceFileView[],
  filter: FileKindFilter,
  searchQuery: string,
): WorkspaceTreeNode[] {
  const normalizedQuery = searchQuery.trim().toLowerCase();
  const filtered = files.filter((file) => {
    if (!matchesKindFilter(file.path, filter)) return false;
    if (normalizedQuery.length === 0) return true;
    return (
      file.path.toLowerCase().includes(normalizedQuery) ||
      file.description.toLowerCase().includes(normalizedQuery)
    );
  });

  const root: MutableDir = {
    name: "",
    path: "",
    tokens: 0,
    fileCount: 0,
    dirs: new Map(),
    files: [],
  };

  for (const file of filtered) {
    const parts = file.path.split("/").filter(Boolean);
    if (parts.length === 0) continue;

    let current = root;
    current.tokens += file.tokens;
    current.fileCount += 1;

    for (let i = 0; i < parts.length; i += 1) {
      const part = parts[i] ?? "";
      const isLast = i === parts.length - 1;
      if (isLast) {
        current.files.push({
          type: "file",
          name: part,
          path: file.path,
          tokens: file.tokens,
          file,
          classification: classifyWorkspaceFile(file.path, file.is_text),
        });
      } else {
        const dirPath = current.path ? `${current.path}/${part}` : part;
        let child = current.dirs.get(part);
        if (!child) {
          child = {
            name: part,
            path: dirPath,
            tokens: 0,
            fileCount: 0,
            dirs: new Map(),
            files: [],
          };
          current.dirs.set(part, child);
        }
        child.tokens += file.tokens;
        child.fileCount += 1;
        current = child;
      }
    }
  }

  function finalize(dir: MutableDir): WorkspaceTreeNode[] {
    const dirs: DirectoryTreeNode[] = Array.from(dir.dirs.values())
      .sort((a, b) => a.name.localeCompare(b.name))
      .map((child) => ({
        type: "dir",
        name: child.name,
        path: child.path,
        tokens: child.tokens,
        fileCount: child.fileCount,
        children: finalize(child),
      }));

    const sortedFiles = [...dir.files].sort((a, b) => a.name.localeCompare(b.name));
    return [...dirs, ...sortedFiles];
  }

  return finalize(root);
}

export function collectDirectoryPaths(nodes: WorkspaceTreeNode[]): string[] {
  const paths: string[] = [];
  for (const node of nodes) {
    if (node.type === "dir") {
      paths.push(node.path);
      paths.push(...collectDirectoryPaths(node.children));
    }
  }
  return paths;
}

export function extractMarkdownOutline(content: string): MarkdownHeading[] {
  const lines = content.split(/\r?\n/);
  const headings: MarkdownHeading[] = [];
  let activeFence: string | null = null;

  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i] ?? "";
    const trimmed = line.trim();

    if (trimmed.startsWith("```") || trimmed.startsWith("~~~")) {
      const marker = trimmed.slice(0, 3);
      if (activeFence === null) {
        activeFence = marker;
      } else if (activeFence === marker) {
        activeFence = null;
      }
      continue;
    }

    if (activeFence !== null) continue;

    const match = /^(#{1,3})\s+(.+?)\s*#*$/.exec(trimmed);
    if (match) {
      const hashes = match[1] ?? "#";
      const title = (match[2] ?? "").trim();
      if (title.length > 0) {
        const level = hashes.length as 1 | 2 | 3;
        headings.push({ level, title, line: i + 1 });
      }
    }
  }

  return headings;
}
