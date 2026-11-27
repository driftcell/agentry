import { describe, expect, test } from "bun:test";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { ClientSetupHelper } from "@/components/ClientSetupHelper";
import { ConfirmDialog } from "@/components/ConfirmDialog";
import { ConflictMerger } from "@/components/ConflictMerger";
import { DiffViewer } from "@/components/DiffViewer";
import { WorkspaceFileTree, useExpandedDirs } from "@/components/WorkspaceFileTree";
import { api } from "@/lib/api";
import type { FileSideResponse, Project, Revision } from "@/lib/types";
import { buildFileTree, collectDirectoryPaths } from "@/lib/workspace";

function TreeHarness({ onSelect }: { onSelect: (path: string) => void }) {
  const nodes = buildFileTree(
    [
      {
        path: "CLAUDE.md",
        tokens: 120,
        size: 400,
        sha256: "a".repeat(64),
        media_type: "text/markdown",
        is_text: true,
        description: "Root instructions",
      },
      {
        path: "skills/reviewer/SKILL.md",
        tokens: 220,
        size: 800,
        sha256: "b".repeat(64),
        media_type: "text/markdown",
        is_text: true,
        description: "Review skill",
      },
    ],
    "all",
    "",
  );
  const dirs = collectDirectoryPaths(nodes);
  const { expanded, toggle } = useExpandedDirs(dirs);
  return (
    <WorkspaceFileTree
      nodes={nodes}
      selectedPath="CLAUDE.md"
      onSelectFile={onSelect}
      expandedDirs={expanded}
      onToggleDir={toggle}
    />
  );
}

describe("Base UI & workbench components", () => {
  test("WorkspaceFileTree renders Base UI Collapsible folders and Button file items", () => {
    const selected: string[] = [];
    render(<TreeHarness onSelect={(p) => selected.push(p)} />);

    expect(screen.getByText("CLAUDE.md")).toBeDefined();
    expect(screen.getByText("SKILL.md")).toBeDefined();
    expect(screen.getAllByText("220 tok")).toHaveLength(2);

    fireEvent.click(screen.getByText("SKILL.md"));
    expect(selected).toEqual(["skills/reviewer/SKILL.md"]);
  });

  test("ClientSetupHelper disables admin endpoint modes until an admin scope is selected", () => {
    const projects: Project[] = [
      {
        id: "11111111-1111-1111-1111-111111111111",
        slug: "default",
        name: "Default Project",
        description: "",
        token_budget: 200000,
        active_revision_id: null,
      },
    ];
    render(<ClientSetupHelper projects={projects} defaultProjectSlug="default" />);

    const fixedAdminBtn = screen.getByRole("button", { name: /标准管理/i });
    expect((fixedAdminBtn as HTMLButtonElement).disabled).toBe(true);

    const proposeScopeBtn = screen.getByRole("button", { name: "admin:propose" });
    fireEvent.click(proposeScopeBtn);
    expect((fixedAdminBtn as HTMLButtonElement).disabled).toBe(false);

    fireEvent.click(fixedAdminBtn);
    expect(screen.getByText(/地址：.*\/admin\/mcp/)).toBeDefined();
  });

  test("ConfirmDialog invokes onConfirm through Base UI Dialog", () => {
    let confirmed = false;
    render(
      <ConfirmDialog
        open={true}
        onOpenChange={() => {}}
        title="批准并立即激活？"
        description="确认切换当前生效版本。"
        confirmLabel="确认激活"
        onConfirm={() => {
          confirmed = true;
        }}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "确认激活" }));
    expect(confirmed).toBe(true);
  });

  test("DiffViewer renders Split lines, full context for identical sides, and binary download links", () => {
    const baseSide: FileSideResponse = {
      path: "CLAUDE.md",
      side: "active",
      content: "line one\nline two\n",
      url: null,
      sha256: "1".repeat(64),
      size_bytes: 18,
      is_text: true,
      media_type: "text/markdown",
      token_count: 5,
    };
    const nextSide: FileSideResponse = {
      ...baseSide,
      side: "incoming",
      content: "line one\nline two updated\n",
      sha256: "2".repeat(64),
      token_count: 6,
    };

    const { rerender } = render(
      <DiffViewer
        path="CLAUDE.md"
        mode="split"
        leftLabel="当前生效"
        rightLabel="本次变更"
        leftSide={baseSide}
        rightSide={nextSide}
      />,
    );

    expect(screen.getByText("+1 行")).toBeDefined();
    expect(screen.getByText("-1 行")).toBeDefined();
    expect(screen.getByText("line two updated")).toBeDefined();

    rerender(
      <DiffViewer
        path="CLAUDE.md"
        mode="unified"
        leftLabel="当前生效"
        rightLabel="本次变更"
        leftSide={baseSide}
        rightSide={baseSide}
      />,
    );
    expect(screen.queryByText("两侧内容无差异")).toBeNull();
    expect(screen.getAllByText("line one").length).toBeGreaterThan(0);

    rerender(
      <DiffViewer
        path="assets/mark.png"
        mode="split"
        leftLabel="当前生效"
        rightLabel="本次变更"
        leftSide={{
          path: "assets/mark.png",
          side: "active",
          content: null,
          url: "https://oss.example.com/old.png",
          sha256: "3".repeat(64),
          size_bytes: 68,
          is_text: false,
          media_type: "image/png",
          token_count: null,
        }}
        rightSide={{
          path: "assets/mark.png",
          side: "incoming",
          content: null,
          url: "https://oss.example.com/new.png",
          sha256: "4".repeat(64),
          size_bytes: 72,
          is_text: false,
          media_type: "image/png",
          token_count: null,
        }}
      />,
    );
    expect(screen.getByText("下载 当前生效")).toBeDefined();
    expect(screen.getByText("下载 本次变更")).toBeDefined();
  });

  test("ConflictMerger resolves conflict hunks via Accept Incoming and submits clean resolution", async () => {
    const origRevisionFile = api.revisionFile;
    const origResolve = api.resolveRevision;
    let submittedPayload: unknown = null;

    api.revisionFile = async (_id, path, side) => {
      const contentBySide = {
        base: "# Title\noriginal line\n",
        active: "# Title\nactive line\n",
        incoming: "# Title\n<<<<<<< ours\nactive line\n=======\nincoming line\n>>>>>>> theirs\n",
      };
      return {
        path,
        side,
        content: contentBySide[side],
        url: null,
        sha256: "a".repeat(64),
        size_bytes: 40,
        is_text: true,
        media_type: "text/markdown",
        token_count: 10,
      };
    };

    const revision: Revision = {
      id: "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa",
      short_code: "amber-oak",
      project_id: "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb",
      base_revision_id: "cccccccc-cccc-cccc-cccc-cccccccccccc",
      merged_against_revision_id: "dddddddd-dddd-dddd-dddd-dddddddddddd",
      status: "conflict",
      commit_message: "Resolve conflict in CLAUDE.md",
      author_user_id: null,
      author_api_key_id: null,
      token_added: 5,
      token_removed: 2,
      total_tokens: 10,
      file_count: 1,
      conflict_summary: null,
      review_comment: null,
      reviewed_by: null,
      reviewed_at: null,
      activated_at: null,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    };

    api.resolveRevision = async (_id, input) => {
      submittedPayload = input;
      return { revision: { ...revision, status: "pending_review" } };
    };

    try {
      const queryClient = new QueryClient({
        defaultOptions: { queries: { retry: false } },
      });
      const resolvedRevisions: Revision[] = [];
      render(
        <QueryClientProvider client={queryClient}>
          <ConflictMerger
            revision={revision}
            hasActiveRevision={true}
            conflicts={[
              {
                path: "CLAUDE.md",
                hunks: 1,
                lines: [2],
                base_sha256: "1".repeat(64),
                active_sha256: "2".repeat(64),
                incoming_sha256: "3".repeat(64),
                merged_sha256: "4".repeat(64),
                preview: "<<<<<<< ours",
              },
            ]}
            canApprove={true}
            onResolved={(rev) => {
              resolvedRevisions.push(rev);
            }}
          />
        </QueryClientProvider>,
      );

      const acceptIncomingButtons = await screen.findAllByRole("button", {
        name: /使用传入/,
      });
      expect(acceptIncomingButtons).toHaveLength(2);
      const saveBtn = screen.getByRole("button", {
        name: /保存解决结果/i,
      }) as HTMLButtonElement;
      expect(saveBtn.disabled).toBe(true);

      const firstAcceptIncoming = acceptIncomingButtons[0];
      expect(firstAcceptIncoming).toBeDefined();
      if (firstAcceptIncoming) {
        fireEvent.click(firstAcceptIncoming);
      }
      expect(saveBtn.disabled).toBe(false);

      fireEvent.click(saveBtn);
      await waitFor(() => expect(submittedPayload).not.toBeNull());
      expect(submittedPayload).toEqual({
        resolutions: [{ path: "CLAUDE.md", content: "# Title\nincoming line\n" }],
        commit_message: "Resolve conflict in CLAUDE.md",
      });
      expect(resolvedRevisions[0]?.status).toBe("pending_review");
    } finally {
      api.revisionFile = origRevisionFile;
      api.resolveRevision = origResolve;
    }
  });
});
