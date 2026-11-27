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
  { id: "all", label: "全部" },
  { id: "claude", label: "CLAUDE" },
  { id: "agents", label: "AGENTS" },
  { id: "skills", label: "Skills" },
  { id: "subagents", label: "子智能体" },
  { id: "root", label: "根目录" },
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
    return <EmptyPanel title="暂无可用项目" description="请联系管理员创建项目或分配访问权限。" />;
  }

  const activeRevision = workspaceQuery.data?.detail.active_revision;
  const project = workspaceQuery.data?.workspace.project;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-hairline pb-3">
        <div className="flex flex-wrap items-center gap-3">
          <h1 className="text-base font-semibold tracking-tight text-ink">工作区</h1>
          {activeRevision ? (
            <span className="text-xs text-ink-secondary truncate max-w-xl">
              {firstLine(activeRevision.commit_message)}
            </span>
          ) : null}
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <Select
            id="explorer-project"
            aria-label="选择项目"
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
              title="查看当前生效版本详情"
            >
              <span>当前版本 {shortUuid(activeRevision.id)}</span>
              <span className="text-ink-muted">·</span>
              <span className="mono-num">
                {formatTokens(workspaceQuery.data?.workspace.tokens)} /{" "}
                {formatTokens(project?.token_budget)} tok
              </span>
              <ExternalLink className="h-3 w-3 text-ink-muted" aria-hidden="true" />
            </Link>
          ) : null}
        </div>
      </div>

      {workspaceQuery.isLoading ? (
        <LoadingPanel label="正在加载文件…" />
      ) : workspaceQuery.error ? (
        <ErrorPanel
          title="工作区加载失败"
          error={workspaceQuery.error}
          onRetry={() => void workspaceQuery.refetch()}
        />
      ) : workspaceQuery.data ? (
        <>
          {!activeRevision ? (
            <EmptyPanel
              title="该项目尚未激活任何版本"
              description="前往审批队列批准并激活修订后，文件将显示在这里。"
            />
          ) : null}

          {files.length > 0 ? (
            <div className="grid grid-cols-1 lg:grid-cols-12 border border-hairline bg-surface divide-y lg:divide-y-0 lg:divide-x divide-hairline min-h-[560px]">
              <aside aria-label="文件树" className="lg:col-span-4 xl:col-span-3 flex flex-col">
                <div className="border-b border-hairline p-2.5 space-y-2 bg-subtle/40">
                  <div className="relative">
                    <Search
                      className="pointer-events-none absolute top-2 left-2.5 h-3.5 w-3.5 text-ink-muted"
                      aria-hidden="true"
                    />
                    <Input
                      type="search"
                      aria-label="搜索文件"
                      value={searchQuery}
                      onChange={(e) => setSearchQuery(e.target.value)}
                      placeholder="搜索文件…"
                      className="pl-7 h-7 font-mono text-xs"
                    />
                  </div>

                  <div className="flex flex-wrap gap-1" role="group" aria-label="文件分类">
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

                  <div className="flex items-center justify-between text-[11px] text-ink-muted">
                    <span className="mono-num">共 {files.length} 个文件</span>
                    <div className="flex items-center gap-2">
                      <button
                        type="button"
                        onClick={expandAll}
                        className="hover:text-ink underline underline-offset-2 cursor-pointer"
                      >
                        展开
                      </button>
                      <button
                        type="button"
                        onClick={collapseAll}
                        className="hover:text-ink underline underline-offset-2 cursor-pointer"
                      >
                        折叠
                      </button>
                    </div>
                  </div>
                </div>

                <div className="p-2 overflow-y-auto max-h-[680px]">
                  {treeNodes.length === 0 ? (
                    <p className="px-2 py-4 text-xs text-ink-muted">没有找到匹配的文件。</p>
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
                aria-label="文件内容"
                className="lg:col-span-8 xl:col-span-9 flex flex-col min-w-0"
              >
                {!selectedPath ? (
                  <div className="p-6">
                    <EmptyPanel title="请选择左侧文件查看内容" />
                  </div>
                ) : fileQuery.isLoading ? (
                  <LoadingPanel label={`正在打开 ${selectedPath}…`} className="border-0" />
                ) : fileQuery.error ? (
                  <div className="p-4">
                    <ErrorPanel
                      title={`无法打开 ${selectedPath}`}
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
                        <CopyableHash value={fileData.sha256} label="复制 SHA-256" />
                        {fileData.is_text && fileData.content !== null ? (
                          <Button
                            variant="outline"
                            size="xs"
                            onClick={() => void handleCopyContent()}
                          >
                            {copiedSource ? (
                              <>
                                <Check className="h-3 w-3 text-emerald-700" aria-hidden="true" />
                                <span>已复制</span>
                              </>
                            ) : (
                              <>
                                <Copy className="h-3 w-3" aria-hidden="true" />
                                <span>复制</span>
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
                            aria-label="文档目录"
                            className="md:w-56 shrink-0 border-b md:border-b-0 md:border-r border-hairline p-3 bg-paper/60"
                          >
                            <div className="flex items-center gap-1.5 text-xs font-medium text-ink-muted mb-2">
                              <ListTree className="h-3.5 w-3.5" aria-hidden="true" />
                              <span>目录</span>
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
                                      {heading.line}
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
                              <span className="text-ink-secondary">
                                已显示前 {formatTokens(INITIAL_LINE_LIMIT)} 行（共{" "}
                                {formatTokens(lines.length)} 行）
                              </span>
                              <Button
                                variant="outline"
                                size="xs"
                                onClick={() => setShowAllLines(true)}
                              >
                                显示剩余 {formatTokens(hiddenLineCount)} 行
                              </Button>
                            </div>
                          ) : null}
                        </div>
                      </div>
                    ) : (
                      <div className="p-6 space-y-4">
                        <dl className="grid grid-cols-1 sm:grid-cols-3 gap-3 border border-hairline bg-paper p-4 text-xs">
                          <div>
                            <dt className="text-[11px] text-ink-muted">文件类型</dt>
                            <dd className="mt-0.5 font-mono text-ink">{fileData.media_type}</dd>
                          </div>
                          <div>
                            <dt className="text-[11px] text-ink-muted">文件大小</dt>
                            <dd className="mt-0.5 mono-num text-ink">
                              {formatBytes(fileData.size)}
                            </dd>
                          </div>
                          <div>
                            <dt className="text-[11px] text-ink-muted">SHA-256</dt>
                            <dd className="mt-0.5">
                              <CopyableHash value={fileData.sha256} length={16} />
                            </dd>
                          </div>
                        </dl>

                        {fileData.url &&
                        fileData.media_type.startsWith("image/") &&
                        !imageLoadFailed ? (
                          <div className="border border-hairline bg-white p-4 inline-block">
                            <img
                              src={fileData.url}
                              alt={`${fileData.path} 预览`}
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
                              <span>下载文件</span>
                            </a>
                            <p className="mt-1.5 text-[11px] text-ink-muted">
                              下载链接短期有效，过期后请刷新页面重新获取。
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
