import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Download, ListTree } from "lucide-react";
import { CopyableHash } from "@/components/CopyableHash";
import { CopyButton } from "@/components/CopyButton";
import { FadeTransition } from "@/components/FadeTransition";
import { EmptyPanel, ErrorPanel, LoadingPanel } from "@/components/StateViews";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { api } from "@/lib/api";
import { formatBytes, formatTokens } from "@/lib/format";
import { extractMarkdownOutline } from "@/lib/workspace";
import { cn } from "@/lib/utils";
import { useWorkspace } from "./WorkspaceProvider";

const INITIAL_LINE_LIMIT = 800;

export function FileContentPanel() {
  const { state, meta } = useWorkspace();
  const { activeSlug } = meta;
  const { selectedPath } = state;

  const [showAllLines, setShowAllLines] = useState(false);
  const [highlightedLine, setHighlightedLine] = useState<number | null>(null);
  const [imageLoadFailed, setImageLoadFailed] = useState(false);

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

  const jumpToLine = (lineNo: number) => {
    if (lineNo > INITIAL_LINE_LIMIT && !showAllLines) {
      setShowAllLines(true);
    }
    setHighlightedLine(lineNo);
    window.requestAnimationFrame(() => {
      const element = document.getElementById(`explorer-line-${lineNo}`);
      element?.scrollIntoView({ block: "center" });
    });
  };

  return (
    <section
      aria-label="文件内容"
      className="lg:col-span-8 xl:col-span-9 flex flex-col min-w-0"
    >
      <FadeTransition key={selectedPath ?? "empty"}>
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
                <Badge variant="secondary">{fileData.media_type}</Badge>
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
                  <CopyButton value={fileData.content} showLabel variant="outline" size="xs" />
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
                      <Button variant="outline" size="xs" onClick={() => setShowAllLines(true)}>
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
                    <dd className="mt-0.5 mono-num text-ink">{formatBytes(fileData.size)}</dd>
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
      </FadeTransition>
    </section>
  );
}
