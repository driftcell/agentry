import { useMemo, useState } from "react";
import { Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { Check, Copy, Download, ExternalLink, ListTree, Search } from "lucide-react";
import { CopyableHash } from "@/components/CopyableHash";
import { EmptyPanel, ErrorPanel, LoadingPanel } from "@/components/StateViews";
import { WorkspaceFileTree, useExpandedDirs } from "@/components/WorkspaceFileTree";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input, Select } from "@/components/ui/input";
import { api } from "@/lib/api";
import { useAuth } from "@/lib/auth-context";
import { firstLine, formatBytes, formatTokens, shortUuid } from "@/lib/format";
import { cn } from "@/lib/utils";
import {
  buildFileTree,
  collectDirectoryPaths,
  extractMarkdownOutline,
  type FileKindFilter,
} from "@/lib/workspace";

const KIND_FILTERS: ReadonlyArray<{ id: FileKindFilter; label: string }> = [
  { id: "all", label: "All" },
  { id: "claude", label: "CLAUDE" },
  { id: "agents", label: "AGENTS" },
  { id: "skills", label: "Skills" },
  { id: "subagents", label: "Sub-agents" },
  { id: "root", label: "Root" },
];

const INITIAL_LINE_LIMIT = 800;

export function ExplorerPage({
  projectSlugOverride,
  initialPath,
  onProjectChange,
}: {
  projectSlugOverride?: string;
  initialPath?: string;
  onProjectChange?: (slug: string) => void;
}) {
  const { projects, selectedProjectSlug, setSelectedProjectSlug } = useAuth();
  const activeSlug = projectSlugOverride || selectedProjectSlug;

  const [kindFilter, setKindFilter] = useState<FileKindFilter>("all");
  const [searchQuery, setSearchQuery] = useState("");
  const [manualSelectedPath, setManualSelectedPath] = useState<string | null>(initialPath ?? null);
  const [highlightedLine, setHighlightedLine] = useState<number | null>(null);
  const [showAllLines, setShowAllLines] = useState(false);
  const [copiedSource, setCopiedSource] = useState(false);
  const [imageLoadFailed, setImageLoadFailed] = useState(false);

  const workspaceQuery = useQuery({
    queryKey: ["workspace", activeSlug],
    queryFn: async () => {
      const [workspace, detail] = await Promise.all([
        api.workspace(activeSlug),
        api.projectDetail(activeSlug),
      ]);
      return { workspace, detail };
    },
    enabled: Boolean(activeSlug),
  });

  const files = workspaceQuery.data?.workspace.files ?? [];
  const treeNodes = useMemo(
    () => buildFileTree(files, kindFilter, searchQuery),
    [files, kindFilter, searchQuery],
  );
  const allDirs = useMemo(() => collectDirectoryPaths(treeNodes), [treeNodes]);
  const { expanded, toggle, expandAll, collapseAll } = useExpandedDirs(allDirs);

  const selectedPath = useMemo(() => {
    if (files.length === 0) return null;
    if (manualSelectedPath && files.some((f) => f.path === manualSelectedPath)) {
      return manualSelectedPath;
    }
    const claude = files.find((f) => f.path === "CLAUDE.md");
    return claude?.path ?? files[0]?.path ?? null;
  }, [files, manualSelectedPath]);

  const fileQuery = useQuery({
    queryKey: ["project-file", activeSlug, selectedPath],
    queryFn: () => api.projectFile(activeSlug, selectedPath!),
    enabled: Boolean(activeSlug && selectedPath),
  });

  const fileData = fileQuery.data;
  const outline = useMemo(() => {
    if (!fileData?.is_text || !fileData.content) return [];
    if (!fileData.path.endsWith(".md") && !fileData.path.endsWith(".mdx")) return [];
    return extractMarkdownOutline(fileData.content);
  }, [fileData]);

  const lines = useMemo(() => {
    if (!fileData?.is_text || fileData.content === null) return [];
    return fileData.content.split(/\r?\n/);
  }, [fileData]);

  const visibleLines = showAllLines ? lines : lines.slice(0, INITIAL_LINE_LIMIT);
  const hiddenLineCount = Math.max(0, lines.length - visibleLines.length);

  const handleSelectFile = (path: string) => {
    setManualSelectedPath(path);
    setHighlightedLine(null);
    setShowAllLines(false);
    setImageLoadFailed(false);
  };

  const handleCopyContent = async () => {
    if (!fileData?.content) return;
    try {
      await navigator.clipboard.writeText(fileData.content);
      setCopiedSource(true);
      window.setTimeout(() => setCopiedSource(false), 1500);
    } catch {
      // Clipboard may be unavailable.
    }
  };

  const jumpToLine = (lineNo: number) => {
    if (lineNo > INITIAL_LINE_LIMIT && !showAllLines) {
      setShowAllLines(true);
    }
    setHighlightedLine(lineNo);
    window.requestAnimationFrame(() => {
      const el = document.getElementById(`explorer-line-${lineNo}`);
      el?.scrollIntoView({ block: "center" });
    });
  };

  if (!activeSlug) {
    return (
      <EmptyPanel
        title="No accessible projects"
        description="Ask an administrator to create a project or grant you project access."
      />
    );
  }

  const activeRevision = workspaceQuery.data?.detail.active_revision;
  const project = workspaceQuery.data?.workspace.project;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-hairline pb-3">
        <div>
          <h1 className="text-base font-semibold tracking-tight text-ink">Workspace Explorer</h1>
          <p className="mt-0.5 text-xs text-ink-secondary">
            Active revision tree with precomputed <code className="text-[11px]">o200k_base</code>{" "}
            token budgets and on-demand file inspection.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <label htmlFor="explorer-project" className="font-mono text-[11px] text-ink-muted">
            PROJECT
          </label>
          <Select
            id="explorer-project"
            value={activeSlug}
            onChange={(e) => {
              const nextSlug = e.target.value;
              setSelectedProjectSlug(nextSlug);
              onProjectChange?.(nextSlug);
              setManualSelectedPath(null);
              setHighlightedLine(null);
            }}
            className="h-7 min-w-[160px] font-mono"
          >
            {projects.map((p) => (
              <option key={p.id} value={p.slug}>
                {p.slug}
              </option>
            ))}
          </Select>

          {activeRevision ? (
            <Link
              to="/revisions/$revisionId"
              params={{ revisionId: activeRevision.id }}
              className="inline-flex items-center gap-1.5 rounded-sm border border-zinc-300 bg-white px-2.5 py-1 text-xs font-mono text-ink hover:bg-subtle no-underline"
            >
              <span>rev:{shortUuid(activeRevision.id)}</span>
              <span className="text-ink-muted">·</span>
              <span className="mono-num">
                {formatTokens(workspaceQuery.data?.workspace.tokens)} tok
              </span>
              <ExternalLink className="h-3 w-3 text-ink-muted" aria-hidden="true" />
            </Link>
          ) : null}
        </div>
      </div>

      {workspaceQuery.isLoading ? (
        <LoadingPanel label={`Loading workspace for ${activeSlug}…`} />
      ) : workspaceQuery.error ? (
        <ErrorPanel
          title="Failed to load workspace"
          error={workspaceQuery.error}
          onRetry={() => void workspaceQuery.refetch()}
        />
      ) : workspaceQuery.data ? (
        <>
          {activeRevision ? (
            <div className="flex flex-wrap items-center justify-between gap-2 border border-hairline bg-surface px-3 py-2 text-xs">
              <div className="flex items-center gap-2 min-w-0">
                <Badge variant="solid">ACTIVE</Badge>
                <span className="font-mono text-ink">{project?.slug}</span>
                <span className="text-ink-muted">·</span>
                <span className="truncate text-ink-secondary">
                  {firstLine(activeRevision.commit_message)}
                </span>
              </div>
              <span className="mono-num text-[11px] text-ink-muted">
                {files.length} files · {formatTokens(workspaceQuery.data.workspace.tokens)} /{" "}
                {formatTokens(project?.token_budget)} tokens
              </span>
            </div>
          ) : (
            <EmptyPanel
              title="No active revision"
              description="This project does not have an activated revision yet. Approve and activate a proposed revision in Review Queue."
            />
          )}

          {files.length > 0 ? (
            <div className="grid grid-cols-1 lg:grid-cols-12 border border-hairline bg-surface divide-y lg:divide-y-0 lg:divide-x divide-hairline min-h-[560px]">
              <aside
                aria-label="Workspace file tree"
                className="lg:col-span-4 xl:col-span-3 flex flex-col"
              >
                <div className="border-b border-hairline p-2.5 space-y-2 bg-subtle/40">
                  <div className="relative">
                    <Search
                      className="pointer-events-none absolute top-2 left-2.5 h-3.5 w-3.5 text-ink-muted"
                      aria-hidden="true"
                    />
                    <Input
                      type="search"
                      aria-label="Filter files by path"
                      value={searchQuery}
                      onChange={(e) => setSearchQuery(e.target.value)}
                      placeholder="Filter path or description…"
                      className="pl-7 h-7 font-mono text-xs"
                    />
                  </div>

                  <div className="flex flex-wrap gap-1" role="group" aria-label="File kind filter">
                    {KIND_FILTERS.map((f) => (
                      <button
                        key={f.id}
                        type="button"
                        onClick={() => setKindFilter(f.id)}
                        aria-pressed={kindFilter === f.id}
                        className={cn(
                          "rounded-sm px-1.5 py-0.5 font-mono text-[10px] border cursor-pointer transition-colors",
                          kindFilter === f.id
                            ? "border-zinc-950 bg-zinc-950 text-zinc-50"
                            : "border-hairline bg-white text-ink-secondary hover:border-zinc-400",
                        )}
                      >
                        {f.label}
                      </button>
                    ))}
                  </div>

                  <div className="flex items-center justify-between text-[11px] text-ink-muted font-mono">
                    <span>{files.length} indexed</span>
                    <div className="flex items-center gap-2">
                      <button
                        type="button"
                        onClick={expandAll}
                        className="hover:text-ink underline underline-offset-2 cursor-pointer"
                      >
                        Expand
                      </button>
                      <button
                        type="button"
                        onClick={collapseAll}
                        className="hover:text-ink underline underline-offset-2 cursor-pointer"
                      >
                        Collapse
                      </button>
                    </div>
                  </div>
                </div>

                <div className="p-2 overflow-y-auto max-h-[680px]">
                  {treeNodes.length === 0 ? (
                    <p className="px-2 py-4 text-xs text-ink-muted font-mono">
                      No files match the current filter.
                    </p>
                  ) : (
                    <WorkspaceFileTree
                      nodes={treeNodes}
                      selectedPath={selectedPath}
                      onSelectFile={handleSelectFile}
                      expandedDirs={expanded}
                      onToggleDir={toggle}
                    />
                  )}
                </div>
              </aside>

              <section
                aria-label="File content viewer"
                className="lg:col-span-8 xl:col-span-9 flex flex-col min-w-0"
              >
                {!selectedPath ? (
                  <div className="p-6">
                    <EmptyPanel
                      title="Select a file"
                      description="Choose a file from the workspace tree to inspect its content, outline, or presigned download."
                    />
                  </div>
                ) : fileQuery.isLoading ? (
                  <LoadingPanel label={`Loading ${selectedPath}…`} className="border-0" />
                ) : fileQuery.error ? (
                  <div className="p-4">
                    <ErrorPanel
                      title={`Failed to load ${selectedPath}`}
                      error={fileQuery.error}
                      onRetry={() => void fileQuery.refetch()}
                    />
                  </div>
                ) : fileData ? (
                  <>
                    <div className="flex flex-wrap items-center justify-between gap-2 border-b border-hairline px-4 py-2.5 bg-subtle/40">
                      <div className="flex flex-wrap items-center gap-2 min-w-0">
                        <code className="font-mono text-xs font-semibold text-ink break-all">
                          {fileData.path}
                        </code>
                        <Badge variant="muted">{fileData.media_type}</Badge>
                      </div>

                      <div className="flex flex-wrap items-center gap-2.5">
                        {fileData.is_text && fileData.tokens !== null ? (
                          <span className="mono-num text-xs text-ink">
                            {formatTokens(fileData.tokens)} tok
                          </span>
                        ) : null}
                        <span className="mono-num text-xs text-ink-muted">
                          {formatBytes(fileData.size)}
                        </span>
                        <CopyableHash value={fileData.sha256} label="Copy SHA-256" />
                        {fileData.is_text && fileData.content !== null ? (
                          <Button
                            variant="outline"
                            size="xs"
                            onClick={() => void handleCopyContent()}
                          >
                            {copiedSource ? (
                              <>
                                <Check className="h-3 w-3 text-emerald-700" aria-hidden="true" />
                                <span>Copied</span>
                              </>
                            ) : (
                              <>
                                <Copy className="h-3 w-3" aria-hidden="true" />
                                <span>Copy text</span>
                              </>
                            )}
                          </Button>
                        ) : null}
                      </div>
                    </div>

                    {fileData.is_text ? (
                      <div className="flex flex-col md:flex-row flex-1 min-h-0">
                        {outline.length > 0 ? (
                          <nav
                            aria-label="Document outline"
                            className="md:w-56 shrink-0 border-b md:border-b-0 md:border-r border-hairline p-3 bg-paper/60"
                          >
                            <div className="flex items-center gap-1.5 font-mono text-[11px] uppercase tracking-wider text-ink-muted mb-2">
                              <ListTree className="h-3.5 w-3.5" aria-hidden="true" />
                              <span>Outline</span>
                            </div>
                            <ul className="space-y-1">
                              {outline.map((heading) => (
                                <li key={`${heading.line}-${heading.title}`}>
                                  <button
                                    type="button"
                                    onClick={() => jumpToLine(heading.line)}
                                    className={cn(
                                      "w-full text-left text-xs py-0.5 px-1.5 rounded-sm hover:bg-subtle cursor-pointer flex items-baseline justify-between gap-2",
                                      heading.level === 1 && "font-semibold text-ink",
                                      heading.level === 2 && "pl-3 text-ink-secondary",
                                      heading.level === 3 && "pl-5 text-[11px] text-ink-muted",
                                      highlightedLine === heading.line && "bg-zinc-200/80 text-ink",
                                    )}
                                  >
                                    <span className="truncate">{heading.title}</span>
                                    <span className="mono-num text-[10px] text-ink-muted shrink-0">
                                      L{heading.line}
                                    </span>
                                  </button>
                                </li>
                              ))}
                            </ul>
                          </nav>
                        ) : null}

                        <div className="flex-1 overflow-x-auto overflow-y-auto max-h-[680px]">
                          <table className="w-full border-collapse font-mono text-xs leading-relaxed">
                            <tbody>
                              {visibleLines.map((line, index) => {
                                const lineNo = index + 1;
                                const isHighlighted = highlightedLine === lineNo;
                                return (
                                  <tr
                                    key={lineNo}
                                    id={`explorer-line-${lineNo}`}
                                    className={cn(
                                      isHighlighted ? "bg-amber-100/70" : "hover:bg-subtle/60",
                                    )}
                                  >
                                    <td className="w-12 select-none border-r border-hairline px-2.5 py-0.5 text-right text-[11px] text-ink-muted mono-num align-top">
                                      {lineNo}
                                    </td>
                                    <td className="px-3 py-0.5 whitespace-pre-wrap break-words text-ink">
                                      {line || " "}
                                    </td>
                                  </tr>
                                );
                              })}
                            </tbody>
                          </table>

                          {hiddenLineCount > 0 ? (
                            <div className="border-t border-hairline bg-subtle px-4 py-2.5 flex items-center justify-between text-xs">
                              <span className="font-mono text-ink-secondary">
                                Showing first {formatTokens(INITIAL_LINE_LIMIT)} of{" "}
                                {formatTokens(lines.length)} lines.
                              </span>
                              <Button
                                variant="outline"
                                size="xs"
                                onClick={() => setShowAllLines(true)}
                              >
                                Show remaining {formatTokens(hiddenLineCount)} lines
                              </Button>
                            </div>
                          ) : null}
                        </div>
                      </div>
                    ) : (
                      <div className="p-6 space-y-4">
                        <div className="border border-hairline bg-paper p-4 space-y-2">
                          <p className="text-xs font-semibold text-ink">
                            Binary Attachment (Object Storage Delivery)
                          </p>
                          <p className="text-xs text-ink-secondary">
                            Non-text assets are stored in external S3-compatible storage and served
                            via short-lived presigned URLs.
                          </p>
                          <dl className="grid grid-cols-1 sm:grid-cols-3 gap-2 pt-2 font-mono text-xs">
                            <div>
                              <dt className="text-[10px] uppercase text-ink-muted">Media Type</dt>
                              <dd className="text-ink">{fileData.media_type}</dd>
                            </div>
                            <div>
                              <dt className="text-[10px] uppercase text-ink-muted">Size</dt>
                              <dd className="mono-num text-ink">{formatBytes(fileData.size)}</dd>
                            </div>
                            <div>
                              <dt className="text-[10px] uppercase text-ink-muted">SHA-256</dt>
                              <dd>
                                <CopyableHash value={fileData.sha256} length={16} />
                              </dd>
                            </div>
                          </dl>
                        </div>

                        {fileData.url &&
                        fileData.media_type.startsWith("image/") &&
                        !imageLoadFailed ? (
                          <div className="border border-hairline bg-white p-4 inline-block">
                            <img
                              src={fileData.url}
                              alt={`Preview of ${fileData.path}`}
                              className="max-h-80 max-w-full object-contain"
                              onError={() => setImageLoadFailed(true)}
                            />
                          </div>
                        ) : null}

                        {fileData.url ? (
                          <div>
                            <a
                              href={fileData.url}
                              target="_blank"
                              rel="noreferrer"
                              className="inline-flex items-center gap-1.5 rounded-sm border border-zinc-950 bg-zinc-950 px-3 py-1.5 text-xs font-medium text-zinc-50 hover:bg-zinc-800 no-underline"
                            >
                              <Download className="h-3.5 w-3.5" aria-hidden="true" />
                              <span>Download via Presigned URL</span>
                            </a>
                            <p className="mt-1.5 text-[11px] text-ink-muted">
                              Presigned link is short-lived and scoped to this object key.
                            </p>
                          </div>
                        ) : null}
                      </div>
                    )}
                  </>
                ) : null}
              </section>
            </div>
          ) : null}
        </>
      ) : null}
    </div>
  );
}
