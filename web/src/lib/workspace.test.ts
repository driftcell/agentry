import { describe, expect, test } from "bun:test";
import type { WorkspaceFileView } from "@/lib/types";
import { buildFileTree, extractMarkdownOutline } from "@/lib/workspace";

const FILES: WorkspaceFileView[] = [
  {
    path: "CLAUDE.md",
    tokens: 500,
    size: 2000,
    sha256: "a".repeat(64),
    media_type: "text/markdown",
    is_text: true,
    description: "Main operating notes",
  },
  {
    path: "skills/reviewer/SKILL.md",
    tokens: 320,
    size: 1200,
    sha256: "b".repeat(64),
    media_type: "text/markdown",
    is_text: true,
    description: "Reviewer skill",
  },
  {
    path: "agents/code-reviewer.md",
    tokens: 180,
    size: 700,
    sha256: "c".repeat(64),
    media_type: "text/markdown",
    is_text: true,
    description: "Sub-agent brief",
  },
  {
    path: "assets/mark.png",
    tokens: 0,
    size: 68,
    sha256: "d".repeat(64),
    media_type: "image/png",
    is_text: false,
    description: "Logo",
  },
];

describe("workspace tree & markdown outline", () => {
  test("rolls up directory token counts and sorts directories before files", () => {
    const tree = buildFileTree(FILES, "all", "");
    expect(tree[0]?.type).toBe("dir");
    if (tree[0]?.type === "dir") {
      expect(tree[0].name).toBe("agents");
      expect(tree[0].tokens).toBe(180);
    }
    const skillsDir = tree.find((n) => n.type === "dir" && n.name === "skills");
    expect(skillsDir?.tokens).toBe(320);

    const claudeNode = tree.find((n) => n.type === "file" && n.name === "CLAUDE.md");
    expect(claudeNode?.type).toBe("file");
    if (claudeNode?.type === "file") {
      expect(claudeNode.classification.kind).toBe("claude");
    }
  });

  test("filters by kind and path search query", () => {
    const skillsOnly = buildFileTree(FILES, "skills", "");
    expect(skillsOnly).toHaveLength(1);
    expect(skillsOnly[0]?.name).toBe("skills");

    const searched = buildFileTree(FILES, "all", "code-reviewer");
    expect(searched).toHaveLength(1);
    expect(searched[0]?.name).toBe("agents");
  });

  test("extracts H1-H3 outline while skipping headings inside fenced code blocks", () => {
    const md = [
      "# Workspace",
      "## Agreements",
      "```sh",
      "# comment inside bash block",
      "## not a heading",
      "```",
      "### Checklist",
      "#### Too deep",
    ].join("\n");

    const outline = extractMarkdownOutline(md);
    expect(outline).toEqual([
      { level: 1, title: "Workspace", line: 1 },
      { level: 2, title: "Agreements", line: 2 },
      { level: 3, title: "Checklist", line: 7 },
    ]);
  });
});
