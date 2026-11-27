import { useMemo, useState } from "react";
import { useQueries } from "@tanstack/react-query";
import { AlertTriangle, Check, CheckCircle2, FileWarning } from "lucide-react";
import { CopyableHash } from "@/components/CopyableHash";
import { ErrorPanel, ForbiddenPanel, LoadingPanel } from "@/components/StateViews";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/input";
import { api, ApiError } from "@/lib/api";
import {
  combineWholeDocuments,
  extractSideFromMarked,
  hasConflictMarkers,
  parseConflictMarkers,
  resolveConflictSegments,
  type ConflictHunkSegment,
  type HunkChoice,
} from "@/lib/conflict";
import { formatTokens } from "@/lib/format";
import type { ConflictDetail, FileSideResponse, Revision } from "@/lib/types";
import { cn } from "@/lib/utils";

interface ConflictMergerProps {
  revision: Revision;
  hasActiveRevision: boolean;
  stale?: boolean;
  conflicts: ConflictDetail[];
  canApprove: boolean;
  onResolved: (updated: Revision) => void;
}

export function ConflictMerger({
  revision,
  hasActiveRevision,
  stale = false,
  conflicts,
  canApprove,
  onResolved,
}: ConflictMergerProps) {
  const [selectedPath, setSelectedPath] = useState<string>(conflicts[0]?.path ?? "");
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [hunkChoicesByPath, setHunkChoicesByPath] = useState<
    Record<string, Record<string, HunkChoice>>
  >({});
  const [commitMessage, setCommitMessage] = useState(revision.commit_message);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);

  const activeConflict = conflicts.find((c) => c.path === selectedPath) ?? conflicts[0] ?? null;
  const activePath = activeConflict?.path ?? "";

  const sideQueries = useQueries({
    queries: [
      {
        queryKey: ["revision-file", revision.id, activePath, "base"],
        queryFn: () => api.revisionFile(revision.id, activePath, "base"),
        enabled: Boolean(activePath && revision.base_revision_id),
      },
      {
        queryKey: ["revision-file", revision.id, activePath, "active"],
        queryFn: () => api.revisionFile(revision.id, activePath, "active"),
        enabled: Boolean(activePath && hasActiveRevision),
      },
      {
        queryKey: ["revision-file", revision.id, activePath, "incoming"],
        queryFn: () => api.revisionFile(revision.id, activePath, "incoming"),
        enabled: Boolean(activePath),
      },
    ],
  });

  const baseQuery = sideQueries[0];
  const activeQuery = sideQueries[1];
  const incomingQuery = sideQueries[2];

  const isLoading =
    (Boolean(revision.base_revision_id) && baseQuery?.isLoading) ||
    (hasActiveRevision && activeQuery?.isLoading) ||
    Boolean(incomingQuery?.isLoading);

  const loadError = incomingQuery?.error ?? activeQuery?.error ?? baseQuery?.error ?? null;

  const baseSide: FileSideResponse | null = baseQuery?.data ?? null;
  const activeSide: FileSideResponse | null = activeQuery?.data ?? null;
  const incomingSide: FileSideResponse | null = incomingQuery?.data ?? null;

  const markedText = incomingSide?.content ?? "";
  const activeText = activeSide?.content ?? "";
  const baseText = baseSide?.content ?? "";
  const hasMarkersInIncoming = hasConflictMarkers(markedText);

  const segments = useMemo(
    () => (hasMarkersInIncoming ? parseConflictMarkers(markedText) : []),
    [hasMarkersInIncoming, markedText],
  );
  const hunkSegments = useMemo(
    () => segments.filter((s): s is ConflictHunkSegment => s.type === "conflict"),
    [segments],
  );

  const cleanIncomingText = useMemo(() => {
    if (!incomingSide?.content) return "";
    if (hasMarkersInIncoming) {
      return extractSideFromMarked(incomingSide.content, "incoming");
    }
    if (activeConflict && activeConflict.incoming_sha256 === null) {
      return "";
    }
    return incomingSide.content;
  }, [incomingSide?.content, hasMarkersInIncoming, activeConflict]);

  const currentBuffer = useMemo(() => {
    if (!activePath) return "";
    if (activePath in drafts) {
      return drafts[activePath] ?? "";
    }
    return markedText || activeText;
  }, [activePath, drafts, markedText, activeText]);

  const bufferHasMarkers = hasConflictMarkers(currentBuffer);
  const isBinaryConflict =
    (activeSide?.sha256 && !activeSide.is_text) || (incomingSide?.sha256 && !incomingSide.is_text);

  const updateDraft = (path: string, value: string) => {
    setDrafts((prev) => ({ ...prev, [path]: value }));
    setSaveError(null);
  };

  const applyHunkChoice = (hunkId: string, choice: HunkChoice) => {
    if (!activePath) return;
    const prevChoices = hunkChoicesByPath[activePath] ?? {};
    const nextChoices = { ...prevChoices, [hunkId]: choice };
    setHunkChoicesByPath((prev) => ({ ...prev, [activePath]: nextChoices }));
    const resolved = resolveConflictSegments(segments, nextChoices);
    updateDraft(activePath, resolved);
  };

  const applyAllChoice = (choice: HunkChoice) => {
    if (!activePath) return;
    if (hasMarkersInIncoming && hunkSegments.length > 0) {
      const nextChoices: Record<string, HunkChoice> = {};
      for (const hunk of hunkSegments) {
        nextChoices[hunk.id] = choice;
      }
      setHunkChoicesByPath((prev) => ({ ...prev, [activePath]: nextChoices }));
      updateDraft(activePath, resolveConflictSegments(segments, nextChoices));
      return;
    }

    if (choice === "current") {
      updateDraft(activePath, activeText);
    } else if (choice === "incoming") {
      updateDraft(activePath, cleanIncomingText);
    } else {
      updateDraft(activePath, combineWholeDocuments(activeText, cleanIncomingText));
    }
  };

  const resolvedStatusMap = useMemo(() => {
    const status: Record<string, boolean> = {};
    for (const conflict of conflicts) {
      const val = drafts[conflict.path];
      status[conflict.path] = typeof val === "string" && !hasConflictMarkers(val);
    }
    return status;
  }, [conflicts, drafts]);

  const resolvedCount = Object.values(resolvedStatusMap).filter(Boolean).length;
  const allConflictsReady =
    conflicts.length > 0 && resolvedCount === conflicts.length && !bufferHasMarkers;

  const handleSaveResolution = async () => {
    if (!canApprove || stale) return;
    const trimmedMessage = commitMessage.trim();
    if (!trimmedMessage) {
      setSaveError("提交说明不能为空。");
      return;
    }
    if (!allConflictsReady) {
      setSaveError("请先解决全部冲突文件（移除所有 <<<<<<<、=======、>>>>>>> 冲突标记）再保存。");
      return;
    }

    setSaving(true);
    setSaveError(null);
    try {
      const resolutions = conflicts.map((c) => ({
        path: c.path,
        content: drafts[c.path] ?? "",
      }));
      const res = await api.resolveRevision(revision.id, {
        resolutions,
        commit_message: trimmedMessage,
      });
      onResolved(res.revision);
    } catch (err) {
      if (err instanceof ApiError) {
        setSaveError(`${err.code}: ${err.message}`);
      } else {
        setSaveError("保存冲突解决结果失败。");
      }
    } finally {
      setSaving(false);
    }
  };

  if (conflicts.length === 0) {
    return <div className="p-4 text-xs text-ink-secondary">该修订当前没有待处理的冲突记录。</div>;
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3 border border-amber-400 bg-amber-50/70 px-4 py-3 text-amber-950">
        <div className="flex items-start gap-2.5">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-amber-800" aria-hidden="true" />
          <div className="space-y-0.5">
            <p className="text-xs font-semibold">
              三方合并冲突（已就绪 {resolvedCount} / {conflicts.length} 个文件）
            </p>
            <p className="text-xs text-amber-900">
              可选择保留当前 (Active)、采纳传入 (Incoming)、保留双方
              (Both)，或手动编辑合并结果。保存后修订将重新进入{" "}
              <code className="font-mono font-semibold">pending_review</code> 状态等待人工审批。
            </p>
          </div>
        </div>
      </div>

      {!canApprove ? (
        <ForbiddenPanel
          title="只读冲突预览"
          description="仅 admin 或 superadmin 角色可以提交冲突解决结果。"
        />
      ) : stale ? (
        <div
          role="alert"
          className="border border-red-300 bg-red-50/70 px-4 py-3 text-xs text-red-950 space-y-1"
        >
          <p className="font-semibold">冲突基线已过时（REVISION_STALE）</p>
          <p>
            该冲突创建后项目的 Active Revision
            已发生变更，直接覆盖可能导致其他更改被回滚。请在上方拒绝此修订，并基于最新激活版本重新提案。
          </p>
        </div>
      ) : null}

      <div className="grid grid-cols-1 lg:grid-cols-12 border border-hairline bg-surface divide-y lg:divide-y-0 lg:divide-x divide-hairline">
        <aside aria-label="冲突文件列表" className="lg:col-span-3 p-3 space-y-2 bg-paper/50">
          <p className="font-mono text-[11px] tracking-wider text-ink-muted">
            冲突文件 ({conflicts.length})
          </p>
          <ul className="space-y-1">
            {conflicts.map((c) => {
              const isSelected = c.path === activePath;
              const isStaged = resolvedStatusMap[c.path];
              return (
                <li key={c.path}>
                  <button
                    type="button"
                    onClick={() => setSelectedPath(c.path)}
                    aria-current={isSelected ? "true" : undefined}
                    className={cn(
                      "w-full text-left rounded-sm border px-2.5 py-2 text-xs font-mono cursor-pointer transition-colors space-y-1",
                      isSelected
                        ? "border-zinc-950 bg-zinc-950 text-zinc-50"
                        : "border-hairline bg-white text-ink hover:border-zinc-400",
                    )}
                  >
                    <div className="flex items-center justify-between gap-2">
                      <span className="truncate font-medium">{c.path}</span>
                      {isStaged ? (
                        <CheckCircle2
                          className={cn(
                            "h-3.5 w-3.5 shrink-0",
                            isSelected ? "text-emerald-300" : "text-emerald-700",
                          )}
                          aria-label="已就绪"
                        />
                      ) : (
                        <FileWarning
                          className={cn(
                            "h-3.5 w-3.5 shrink-0",
                            isSelected ? "text-amber-300" : "text-amber-700",
                          )}
                          aria-label="未解决"
                        />
                      )}
                    </div>
                    <div
                      className={cn(
                        "mono-num text-[10px]",
                        isSelected ? "text-zinc-300" : "text-ink-muted",
                      )}
                    >
                      {c.hunks} 处冲突 · 第 {c.lines.join(", ")} 行
                    </div>
                  </button>
                </li>
              );
            })}
          </ul>
        </aside>

        <div className="lg:col-span-9 p-4 space-y-4 min-w-0">
          {isLoading ? (
            <LoadingPanel label={`正在加载 ${activePath} 的三方对比上下文…`} />
          ) : loadError ? (
            <ErrorPanel
              title={`无法加载 ${activePath} 的冲突内容`}
              error={loadError}
              onRetry={() => {
                void baseQuery?.refetch();
                void activeQuery?.refetch();
                void incomingQuery?.refetch();
              }}
            />
          ) : (
            <>
              <div className="flex flex-wrap items-center justify-between gap-2 border-b border-hairline pb-3">
                <div className="space-y-1">
                  <div className="flex items-center gap-2">
                    <code className="font-mono text-xs font-semibold text-ink">{activePath}</code>
                    {resolvedStatusMap[activePath] ? (
                      <Badge variant="added">
                        <Check className="h-3 w-3" aria-hidden="true" />
                        <span>已就绪</span>
                      </Badge>
                    ) : (
                      <Badge variant="warning">
                        <AlertTriangle className="h-3 w-3" aria-hidden="true" />
                        <span>待处理</span>
                      </Badge>
                    )}
                  </div>
                  {activeConflict?.preview ? (
                    <p className="font-mono text-[11px] text-ink-secondary">
                      {activeConflict.preview}
                    </p>
                  ) : null}
                </div>

                {!isBinaryConflict && canApprove ? (
                  <div className="flex flex-wrap items-center gap-1.5">
                    <Button variant="outline" size="xs" onClick={() => applyAllChoice("current")}>
                      保留当前 (Active)
                    </Button>
                    <Button variant="outline" size="xs" onClick={() => applyAllChoice("incoming")}>
                      采纳传入 (Incoming)
                    </Button>
                    <Button variant="outline" size="xs" onClick={() => applyAllChoice("both")}>
                      保留双方 (Both)
                    </Button>
                  </div>
                ) : null}
              </div>

              {isBinaryConflict ? (
                <div className="border border-red-300 bg-red-50/70 p-4 text-xs text-red-950 space-y-2">
                  <p className="font-semibold">检测到二进制文件冲突</p>
                  <p>
                    二进制文件无法以 UTF-8 文本形式在线合并。请通过{" "}
                    <code className="font-mono">/admin/mcp</code> 的{" "}
                    <code className="font-mono">resolve_conflict</code> 工具并指定 OSS
                    暂存对象键来解决。
                  </p>
                </div>
              ) : (
                <>
                  <div className="grid grid-cols-1 md:grid-cols-3 border border-hairline divide-y md:divide-y-0 md:divide-x divide-hairline">
                    <div className="flex flex-col min-w-0">
                      <div className="flex items-center justify-between border-b border-hairline bg-subtle/60 px-3 py-1.5">
                        <span className="font-mono text-[11px] font-semibold text-ink-secondary">
                          Base（基线）
                        </span>
                        <CopyableHash value={activeConflict?.base_sha256} />
                      </div>
                      <pre className="p-3 font-mono text-[11px] leading-relaxed whitespace-pre-wrap break-words max-h-56 overflow-y-auto text-ink-secondary">
                        {baseText || "（Base 中不存在）"}
                      </pre>
                    </div>

                    <div className="flex flex-col min-w-0">
                      <div className="flex items-center justify-between border-b border-hairline bg-subtle/60 px-3 py-1.5">
                        <span className="font-mono text-[11px] font-semibold text-ink">
                          Current（当前 Active）
                        </span>
                        <CopyableHash value={activeConflict?.active_sha256} />
                      </div>
                      <pre className="p-3 font-mono text-[11px] leading-relaxed whitespace-pre-wrap break-words max-h-56 overflow-y-auto text-ink">
                        {activeText || "（当前 Active 已删除或不存在）"}
                      </pre>
                    </div>

                    <div className="flex flex-col min-w-0">
                      <div className="flex items-center justify-between border-b border-hairline bg-subtle/60 px-3 py-1.5">
                        <span className="font-mono text-[11px] font-semibold text-ink">
                          Incoming（传入提案）
                        </span>
                        <CopyableHash value={activeConflict?.incoming_sha256} />
                      </div>
                      <pre className="p-3 font-mono text-[11px] leading-relaxed whitespace-pre-wrap break-words max-h-56 overflow-y-auto text-ink">
                        {cleanIncomingText || "（传入提案已删除或不存在）"}
                      </pre>
                    </div>
                  </div>

                  {hunkSegments.length > 0 && canApprove ? (
                    <div className="space-y-2">
                      <p className="font-mono text-[11px] tracking-wider text-ink-muted">
                        逐块选择 ({hunkSegments.length})
                      </p>
                      <div className="space-y-2">
                        {hunkSegments.map((hunk) => {
                          const currentChoice = hunkChoicesByPath[activePath]?.[hunk.id] ?? null;
                          return (
                            <div
                              key={hunk.id}
                              className="border border-hairline bg-paper p-3 space-y-2"
                            >
                              <div className="flex flex-wrap items-center justify-between gap-2">
                                <span className="mono-num text-xs font-semibold text-ink">
                                  冲突块 #{hunk.index}（第 {hunk.startLine} 行）
                                </span>
                                <div className="flex flex-wrap items-center gap-1.5">
                                  {(
                                    [
                                      { id: "current", label: "保留当前" },
                                      { id: "incoming", label: "采纳传入" },
                                      { id: "both", label: "保留双方" },
                                    ] as const
                                  ).map((btn) => (
                                    <Button
                                      key={btn.id}
                                      variant={currentChoice === btn.id ? "default" : "outline"}
                                      size="xs"
                                      onClick={() => applyHunkChoice(hunk.id, btn.id)}
                                    >
                                      {btn.label}
                                    </Button>
                                  ))}
                                </div>
                              </div>
                              <div className="grid grid-cols-1 md:grid-cols-2 gap-2 font-mono text-[11px]">
                                <pre className="border border-hairline bg-white p-2 whitespace-pre-wrap break-words">
                                  {hunk.ours || "（空）"}
                                </pre>
                                <pre className="border border-hairline bg-white p-2 whitespace-pre-wrap break-words">
                                  {hunk.theirs || "（空）"}
                                </pre>
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  ) : null}

                  <div className="space-y-2">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <label
                        htmlFor="conflict-editor"
                        className="font-mono text-[11px] tracking-wider text-ink-muted"
                      >
                        合并输出编辑器（{formatTokens(currentBuffer.split(/\r?\n/).length)} 行）
                      </label>
                      {bufferHasMarkers ? (
                        <span className="font-mono text-[11px] font-semibold text-amber-800">
                          仍包含未解决的 &lt;&lt;&lt;&lt;&lt;&lt;&lt; / ======= /
                          &gt;&gt;&gt;&gt;&gt;&gt;&gt; 标记
                        </span>
                      ) : activePath in drafts ? (
                        <span className="font-mono text-[11px] text-emerald-800">
                          已就绪，可提交保存
                        </span>
                      ) : (
                        <span className="font-mono text-[11px] text-amber-800">
                          请点击上方策略按钮或直接编辑后再保存
                        </span>
                      )}
                    </div>
                    <Textarea
                      id="conflict-editor"
                      value={currentBuffer}
                      onChange={(e) => updateDraft(activePath, e.target.value)}
                      readOnly={!canApprove}
                      rows={14}
                      spellCheck={false}
                      className="font-mono text-xs leading-relaxed"
                    />
                  </div>
                </>
              )}

              <div className="border-t border-hairline pt-4 space-y-3">
                <div className="space-y-1.5">
                  <label
                    htmlFor="conflict-commit-message"
                    className="block font-mono text-[11px] tracking-wider text-ink-muted"
                  >
                    提交说明 (Commit Message)
                  </label>
                  <Textarea
                    id="conflict-commit-message"
                    value={commitMessage}
                    onChange={(e) => setCommitMessage(e.target.value)}
                    readOnly={!canApprove}
                    rows={2}
                    className="font-mono text-xs"
                  />
                </div>

                {saveError ? (
                  <div
                    role="alert"
                    className="border border-red-300 bg-red-50 px-3 py-2 text-xs text-red-900 font-mono"
                  >
                    {saveError}
                  </div>
                ) : null}

                {canApprove ? (
                  <div className="flex flex-wrap items-center justify-between gap-3">
                    <span className="mono-num text-xs text-ink-secondary">
                      {resolvedCount} / {conflicts.length} 个冲突文件已处理干净
                    </span>
                    <Button
                      onClick={() => void handleSaveResolution()}
                      disabled={!allConflictsReady || saving || stale}
                    >
                      {saving ? "正在保存…" : "保存解决结果并回到待审批"}
                    </Button>
                  </div>
                ) : null}
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
