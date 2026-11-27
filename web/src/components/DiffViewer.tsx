import { useMemo, useState } from "react";
import { Download, Expand } from "lucide-react";
import { CopyableHash } from "@/components/CopyableHash";
import { EmptyPanel } from "@/components/StateViews";
import { Badge } from "@/components/ui/badge";
import {
  buildSplitDiffBlocks,
  collapseDiffLines,
  computeLineDiff,
  type DiffLine,
} from "@/lib/diff";
import { formatBytes, formatTokens } from "@/lib/format";
import type { FileSideResponse } from "@/lib/types";
import { cn } from "@/lib/utils";

export type DiffViewMode = "split" | "unified";

interface DiffViewerProps {
  path: string;
  mode: DiffViewMode;
  leftLabel: string;
  rightLabel: string;
  leftSide: FileSideResponse | null;
  rightSide: FileSideResponse | null;
}

function SideSummary({ label, side }: { label: string; side: FileSideResponse | null }) {
  if (!side || !side.sha256) {
    return (
      <div className="flex items-center gap-2 text-xs text-ink-muted font-mono">
        <span className="text-[10px]">{label}：</span>
        <span>（不存在）</span>
      </div>
    );
  }
  return (
    <div className="flex flex-wrap items-center gap-2 text-xs font-mono">
      <span className="text-[10px] text-ink-muted">{label}：</span>
      <CopyableHash value={side.sha256} />
      <span className="mono-num text-[11px] text-ink-secondary">
        {side.is_text && side.token_count !== null
          ? `${formatTokens(side.token_count)} tok`
          : formatBytes(side.size_bytes)}
      </span>
    </div>
  );
}

function UnifiedLineRow({ line }: { line: DiffLine }) {
  return (
    <tr
      className={cn(
        line.type === "add" && "bg-emerald-50/75",
        line.type === "remove" && "bg-red-50/75",
      )}
    >
      <td className="w-11 select-none border-r border-hairline px-2 py-0.5 text-right text-[11px] text-ink-muted mono-num">
        {line.oldLine ?? ""}
      </td>
      <td className="w-11 select-none border-r border-hairline px-2 py-0.5 text-right text-[11px] text-ink-muted mono-num">
        {line.newLine ?? ""}
      </td>
      <td
        className={cn(
          "w-5 select-none border-r border-hairline text-center font-mono text-xs font-bold",
          line.type === "add"
            ? "text-emerald-800"
            : line.type === "remove"
              ? "text-red-800"
              : "text-ink-muted",
        )}
      >
        {line.type === "add" ? "+" : line.type === "remove" ? "-" : " "}
      </td>
      <td className="px-3 py-0.5 whitespace-pre-wrap break-words font-mono text-xs text-ink">
        {line.text || " "}
      </td>
    </tr>
  );
}

export function DiffViewer({
  path,
  mode,
  leftLabel,
  rightLabel,
  leftSide,
  rightSide,
}: DiffViewerProps) {
  const [expandedBlocks, setExpandedBlocks] = useState<Set<string>>(() => new Set());
  const [prevKey, setPrevKey] = useState(
    () => `${path}|${leftSide?.sha256 ?? "none"}|${rightSide?.sha256 ?? "none"}`,
  );

  const currentKey = `${path}|${leftSide?.sha256 ?? "none"}|${rightSide?.sha256 ?? "none"}`;
  if (currentKey !== prevKey) {
    setPrevKey(currentKey);
    setExpandedBlocks(new Set());
  }

  const isBinary =
    (leftSide && leftSide.sha256 && !leftSide.is_text) ||
    (rightSide && rightSide.sha256 && !rightSide.is_text);

  const diff = useMemo(() => {
    if (isBinary) return null;
    return computeLineDiff(leftSide?.content ?? "", rightSide?.content ?? "");
  }, [isBinary, leftSide?.content, rightSide?.content]);

  const unifiedBlocks = useMemo(() => {
    if (!diff || mode !== "unified") return [];
    return collapseDiffLines(diff.lines);
  }, [diff, mode]);

  const splitBlocks = useMemo(() => {
    if (!diff || mode !== "split") return [];
    return buildSplitDiffBlocks(diff.lines);
  }, [diff, mode]);

  const expandBlock = (id: string) => {
    setExpandedBlocks((prev) => {
      const next = new Set(prev);
      next.add(id);
      return next;
    });
  };

  if (isBinary) {
    return (
      <div className="space-y-4 p-4">
        <div className="flex flex-wrap items-center justify-between gap-2 border-b border-hairline pb-3">
          <SideSummary label={leftLabel} side={leftSide} />
          <SideSummary label={rightLabel} side={rightSide} />
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {[
            { label: leftLabel, side: leftSide },
            { label: rightLabel, side: rightSide },
          ].map(({ label, side }) => (
            <div key={label} className="border border-hairline bg-paper p-4 space-y-2">
              <div className="flex items-center justify-between">
                <span className="font-mono text-xs font-semibold text-ink">{label}</span>
                <Badge variant="secondary">二进制</Badge>
              </div>
              {side && side.sha256 ? (
                <>
                  <p className="font-mono text-xs text-ink-secondary">
                    {side.media_type ?? "application/octet-stream"} · {formatBytes(side.size_bytes)}
                  </p>
                  <CopyableHash value={side.sha256} length={16} />
                  {side.url ? (
                    <div className="pt-2">
                      <a
                        href={side.url}
                        target="_blank"
                        rel="noreferrer"
                        className="inline-flex items-center gap-1.5 rounded-sm border border-zinc-300 bg-white px-2.5 py-1 text-xs font-medium text-ink hover:bg-subtle no-underline"
                      >
                        <Download className="h-3.5 w-3.5" aria-hidden="true" />
                        <span>下载 {label}</span>
                      </a>
                    </div>
                  ) : null}
                </>
              ) : (
                <p className="text-xs text-ink-muted">该侧不包含此文件。</p>
              )}
            </div>
          ))}
        </div>
      </div>
    );
  }

  if (!diff) return null;

  const bothAbsent = !leftSide?.sha256 && !rightSide?.sha256;

  return (
    <div className="flex flex-col">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-hairline px-4 py-2 bg-subtle/40">
        <div className="flex flex-wrap items-center gap-4">
          <SideSummary label={leftLabel} side={leftSide} />
          <SideSummary label={rightLabel} side={rightSide} />
        </div>

        <div className="mono-num flex items-center gap-2 text-xs">
          <span className="text-emerald-800 font-medium">+{diff.additions} 行</span>
          <span className="text-zinc-300">/</span>
          <span className="text-red-800 font-medium">-{diff.deletions} 行</span>
        </div>
      </div>

      {diff.truncatedMatrix ? (
        <div className="border-b border-amber-300 bg-amber-50 px-4 py-2 text-xs text-amber-950">
          变更区间过大，超出交互式 LCS 矩阵上限，已切换为有界替换差异视图。
        </div>
      ) : null}

      {bothAbsent ? (
        <div className="p-4">
          <EmptyPanel title="两侧均无内容" description="当前选定的两个版本快照中均不包含该路径。" />
        </div>
      ) : null}

      {!bothAbsent && diff.lines.length > 0 ? (
        <div className="overflow-x-auto max-h-[680px] overflow-y-auto">
          {mode === "unified" ? (
            <table className="w-full border-collapse">
              <tbody>
                {unifiedBlocks.map((block) => {
                  if (block.kind === "line") {
                    return (
                      <UnifiedLineRow
                        key={`${block.line.oldLine ?? "n"}-${block.line.newLine ?? "n"}-${block.line.type}`}
                        line={block.line}
                      />
                    );
                  }
                  if (expandedBlocks.has(block.id)) {
                    return block.lines.map((line) => (
                      <UnifiedLineRow
                        key={`${block.id}-${line.oldLine ?? "n"}-${line.newLine ?? "n"}`}
                        line={line}
                      />
                    ));
                  }
                  return (
                    <tr key={block.id} className="bg-subtle/70 border-y border-hairline">
                      <td colSpan={4} className="px-3 py-1">
                        <button
                          type="button"
                          onClick={() => expandBlock(block.id)}
                          className="inline-flex items-center gap-1.5 font-mono text-[11px] text-ink-secondary hover:text-ink cursor-pointer"
                        >
                          <Expand className="h-3 w-3" aria-hidden="true" />
                          <span>展开 {formatTokens(block.count)} 行未变更内容</span>
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          ) : (
            <table className="w-full border-collapse table-fixed">
              <thead>
                <tr className="border-b border-hairline bg-subtle/60 font-mono text-[11px] text-ink-muted">
                  <th className="w-11 border-r border-hairline px-2 py-1 text-right font-medium">
                    旧行
                  </th>
                  <th className="w-1/2 border-r border-hairline px-3 py-1 text-left font-medium">
                    {leftLabel}
                  </th>
                  <th className="w-11 border-r border-hairline px-2 py-1 text-right font-medium">
                    新行
                  </th>
                  <th className="w-1/2 px-3 py-1 text-left font-medium">{rightLabel}</th>
                </tr>
              </thead>
              <tbody>
                {splitBlocks.map((block, idx) => {
                  if (block.kind === "collapse") {
                    if (expandedBlocks.has(block.id)) {
                      return block.lines.map((line) => (
                        <tr key={`${block.id}-${line.oldLine}-${line.newLine}`}>
                          <td className="select-none border-r border-hairline px-2 py-0.5 text-right text-[11px] text-ink-muted mono-num">
                            {line.oldLine ?? ""}
                          </td>
                          <td className="border-r border-hairline px-3 py-0.5 whitespace-pre-wrap break-words font-mono text-xs text-ink">
                            {line.text || " "}
                          </td>
                          <td className="select-none border-r border-hairline px-2 py-0.5 text-right text-[11px] text-ink-muted mono-num">
                            {line.newLine ?? ""}
                          </td>
                          <td className="px-3 py-0.5 whitespace-pre-wrap break-words font-mono text-xs text-ink">
                            {line.text || " "}
                          </td>
                        </tr>
                      ));
                    }
                    return (
                      <tr key={block.id} className="bg-subtle/70 border-y border-hairline">
                        <td colSpan={4} className="px-3 py-1">
                          <button
                            type="button"
                            onClick={() => expandBlock(block.id)}
                            className="inline-flex items-center gap-1.5 font-mono text-[11px] text-ink-secondary hover:text-ink cursor-pointer"
                          >
                            <Expand className="h-3 w-3" aria-hidden="true" />
                            <span>展开 {formatTokens(block.count)} 行未变更内容</span>
                          </button>
                        </td>
                      </tr>
                    );
                  }

                  return (
                    <tr key={`row-${idx}`}>
                      <td
                        className={cn(
                          "select-none border-r border-hairline px-2 py-0.5 text-right text-[11px] mono-num align-top",
                          block.left.type === "remove"
                            ? "bg-red-50 text-red-800"
                            : block.left.type === "empty"
                              ? "bg-subtle/40 text-transparent"
                              : "text-ink-muted",
                        )}
                      >
                        {block.left.lineNo ?? ""}
                      </td>
                      <td
                        className={cn(
                          "border-r border-hairline px-3 py-0.5 whitespace-pre-wrap break-words font-mono text-xs align-top",
                          block.left.type === "remove"
                            ? "bg-red-50/75 text-ink"
                            : block.left.type === "empty"
                              ? "bg-subtle/40"
                              : "text-ink",
                        )}
                      >
                        {block.left.type === "remove" ? (
                          <span className="mr-1.5 font-bold text-red-800">-</span>
                        ) : null}
                        {block.left.text || (block.left.type === "empty" ? "" : " ")}
                      </td>
                      <td
                        className={cn(
                          "select-none border-r border-hairline px-2 py-0.5 text-right text-[11px] mono-num align-top",
                          block.right.type === "add"
                            ? "bg-emerald-50 text-emerald-800"
                            : block.right.type === "empty"
                              ? "bg-subtle/40 text-transparent"
                              : "text-ink-muted",
                        )}
                      >
                        {block.right.lineNo ?? ""}
                      </td>
                      <td
                        className={cn(
                          "px-3 py-0.5 whitespace-pre-wrap break-words font-mono text-xs align-top",
                          block.right.type === "add"
                            ? "bg-emerald-50/75 text-ink"
                            : block.right.type === "empty"
                              ? "bg-subtle/40"
                              : "text-ink",
                        )}
                      >
                        {block.right.type === "add" ? (
                          <span className="mr-1.5 font-bold text-emerald-800">+</span>
                        ) : null}
                        {block.right.text || (block.right.type === "empty" ? "" : " ")}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
        </div>
      ) : null}
    </div>
  );
}
