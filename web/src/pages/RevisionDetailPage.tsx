import { useMemo, useState } from "react";
import { Link } from "@tanstack/react-router";
import { useQueries, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  AlertTriangle,
  ArrowLeft,
  Check,
  Columns2,
  GitCompare,
  RefreshCw,
  Rows3,
  ShieldAlert,
  XCircle,
  Zap,
} from "lucide-react";
import { ConfirmDialog } from "@/components/ConfirmDialog";
import { ConflictMerger } from "@/components/ConflictMerger";
import { CopyableHash } from "@/components/CopyableHash";
import { DiffViewer, type DiffViewMode } from "@/components/DiffViewer";
import { EmptyPanel, ErrorPanel, ForbiddenPanel, LoadingPanel } from "@/components/StateViews";
import { StatusBadge } from "@/components/StatusBadge";
import { SingleTokenDelta, TokenDelta } from "@/components/TokenDelta";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input, Select } from "@/components/ui/input";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { api, ApiError } from "@/lib/api";
import { useAuth } from "@/lib/auth-context";
import { formatTimestamp, formatTokens, shortUuid } from "@/lib/format";
import type { FileSideName, RevisionFileView } from "@/lib/types";
import { cn } from "@/lib/utils";

type ComparePair = "active_incoming" | "base_incoming" | "base_active";

function comparePairSides(pair: ComparePair): {
  left: FileSideName;
  right: FileSideName;
  leftLabel: string;
  rightLabel: string;
} {
  switch (pair) {
    case "active_incoming":
      return {
        left: "active",
        right: "incoming",
        leftLabel: "当前 Active",
        rightLabel: "传入 Incoming",
      };
    case "base_incoming":
      return {
        left: "base",
        right: "incoming",
        leftLabel: "提案 Base",
        rightLabel: "传入 Incoming",
      };
    case "base_active":
      return {
        left: "base",
        right: "active",
        leftLabel: "提案 Base",
        rightLabel: "当前 Active",
      };
  }
}

function ChangeTypeBadge({ type }: { type: RevisionFileView["change_type"] }) {
  switch (type) {
    case "added":
      return <Badge variant="added">新增</Badge>;
    case "modified":
      return <Badge variant="outline">修改</Badge>;
    case "deleted":
      return <Badge variant="removed">删除</Badge>;
    case "unchanged":
      return <Badge variant="muted">未变</Badge>;
  }
}

export function RevisionDetailPage({ revisionId }: { revisionId: string }) {
  const { canApprove } = useAuth();
  const queryClient = useQueryClient();

  const [diffMode, setDiffMode] = useState<DiffViewMode>("split");
  const [comparePair, setComparePair] = useState<ComparePair>("active_incoming");
  const [showUnchanged, setShowUnchanged] = useState(false);
  const [manualSelectedPath, setManualSelectedPath] = useState<string | null>(null);
  const [studioTab, setStudioTab] = useState<string | null>(null);

  const [reviewComment, setReviewComment] = useState("");
  const [actionError, setActionError] = useState<string | null>(null);
  const [pendingAction, setPendingAction] = useState<null | "approve" | "activate" | "reject">(
    null,
  );
  const [confirmKind, setConfirmKind] = useState<null | "activate" | "reject">(null);

  const detailQuery = useQuery({
    queryKey: ["revision", revisionId],
    queryFn: () => api.revisionDetail(revisionId),
  });

  const detail = detailQuery.data;
  const revision = detail?.revision;
  const project = detail?.project;

  const isConflict = revision?.status === "conflict" && (detail?.conflicts.length ?? 0) > 0;
  const activeTab =
    studioTab === "conflict" && !isConflict
      ? "diff"
      : (studioTab ?? (isConflict ? "conflict" : "diff"));

  const visibleFiles = useMemo(() => {
    const list = detail?.files ?? [];
    if (showUnchanged) return list;
    const changed = list.filter((f) => f.change_type !== "unchanged");
    return changed.length > 0 ? changed : list;
  }, [detail?.files, showUnchanged]);

  const selectedPath = useMemo(() => {
    if (visibleFiles.length === 0) return null;
    if (manualSelectedPath && visibleFiles.some((f) => f.path === manualSelectedPath)) {
      return manualSelectedPath;
    }
    const firstChanged = visibleFiles.find((f) => f.change_type !== "unchanged");
    return firstChanged?.path ?? visibleFiles[0]?.path ?? null;
  }, [visibleFiles, manualSelectedPath]);

  const conflictPathSet = useMemo(
    () => new Set((detail?.conflicts ?? []).map((c) => c.path)),
    [detail?.conflicts],
  );

  const pair = comparePairSides(comparePair);
  const canFetchSide = (side: FileSideName) => {
    if (!revision || !project || !selectedPath) return false;
    if (side === "base") return Boolean(revision.base_revision_id);
    if (side === "active") return Boolean(project.active_revision_id);
    return true;
  };

  const sideQueries = useQueries({
    queries: [
      {
        queryKey: ["revision-file", revisionId, selectedPath, pair.left],
        queryFn: () => api.revisionFile(revisionId, selectedPath!, pair.left),
        enabled: activeTab === "diff" && canFetchSide(pair.left),
      },
      {
        queryKey: ["revision-file", revisionId, selectedPath, pair.right],
        queryFn: () => api.revisionFile(revisionId, selectedPath!, pair.right),
        enabled: activeTab === "diff" && canFetchSide(pair.right),
      },
    ],
  });

  const leftQuery = sideQueries[0];
  const rightQuery = sideQueries[1];

  const invalidateAll = async () => {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: ["revision", revisionId] }),
      queryClient.invalidateQueries({ queryKey: ["review-queue"] }),
      queryClient.invalidateQueries({ queryKey: ["dashboard"] }),
      queryClient.invalidateQueries({ queryKey: ["workspace"] }),
      queryClient.invalidateQueries({ queryKey: ["auth", "me"] }),
    ]);
  };

  const runReviewAction = async (kind: "approve" | "activate" | "reject") => {
    if (!revision) return;
    setPendingAction(kind);
    setActionError(null);
    try {
      if (kind === "reject") {
        await api.rejectRevision(revision.id, { comment: reviewComment.trim() });
      } else {
        await api.approveRevision(revision.id, {
          comment: reviewComment.trim(),
          activate_now: kind === "activate",
        });
      }
      setConfirmKind(null);
      setReviewComment("");
      await invalidateAll();
    } catch (err) {
      setConfirmKind(null);
      if (err instanceof ApiError) {
        setActionError(`${err.code}: ${err.message}`);
      } else {
        setActionError("审批操作失败。");
      }
    } finally {
      setPendingAction(null);
    }
  };

  if (detailQuery.isLoading) {
    return <LoadingPanel label="正在加载修订详情…" />;
  }

  if (detailQuery.error) {
    return (
      <ErrorPanel
        title="无法加载修订详情"
        error={detailQuery.error}
        onRetry={() => void detailQuery.refetch()}
      />
    );
  }

  if (!detail || !revision || !project) {
    return <EmptyPanel title="修订不存在" description="未能找到指定的修订记录。" />;
  }

  const unchangedCount = detail.files.filter((f) => f.change_type === "unchanged").length;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-hairline pb-3">
        <div className="flex flex-wrap items-center gap-2.5">
          <Link
            to="/review"
            className="inline-flex items-center gap-1 rounded-sm border border-zinc-300 bg-white px-2 py-1 text-xs text-ink hover:bg-subtle no-underline"
          >
            <ArrowLeft className="h-3.5 w-3.5" aria-hidden="true" />
            <span>审批队列</span>
          </Link>
          <span className="font-mono text-xs font-semibold text-ink">{project.slug}</span>
          <CopyableHash value={revision.id} prefix="rev:" />
          <StatusBadge
            status={revision.status}
            stale={detail.stale}
            conflictCount={detail.conflicts.length}
          />
        </div>

        <div className="flex items-center gap-2">
          <TokenDelta added={revision.token_added} removed={revision.token_removed} />
          <span className="mono-num text-xs text-ink-muted">
            总计 {formatTokens(revision.total_tokens)} tok（{revision.file_count} 个文件）
          </span>
          <Button
            variant="outline"
            size="xs"
            onClick={() => void detailQuery.refetch()}
            disabled={detailQuery.isFetching}
          >
            <RefreshCw
              className={cn("h-3 w-3", detailQuery.isFetching && "animate-spin")}
              aria-hidden="true"
            />
            <span>刷新</span>
          </Button>
        </div>
      </div>

      {detail.stale &&
      revision.status !== "active" &&
      revision.status !== "superseded" &&
      revision.status !== "rejected" ? (
        <div
          role="status"
          className="flex items-start justify-between gap-3 border border-amber-400 bg-amber-50/70 px-4 py-2.5 text-xs text-amber-950"
        >
          <div className="flex items-start gap-2">
            <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-amber-800" aria-hidden="true" />
            <div>
              <p className="font-semibold">该修订基于更早的 Active Revision 合并</p>
              <p className="text-amber-900">
                项目的当前激活版本在此提案创建后已发生变化，批准前请仔细比对{" "}
                <code className="font-mono">当前 Active → 传入 Incoming</code> 的差异。
              </p>
            </div>
          </div>
          <Button variant="outline" size="xs" onClick={() => void detailQuery.refetch()}>
            刷新状态
          </Button>
        </div>
      ) : null}

      <section
        aria-label="修订元信息与审批操作"
        className="border border-hairline bg-surface p-4 space-y-3"
      >
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="space-y-1.5 flex-1 min-w-[260px]">
            <p className="font-mono text-[11px] tracking-wider text-ink-muted">
              完整提交说明 (Commit Message)
            </p>
            <p className="whitespace-pre-wrap text-sm font-medium text-ink leading-relaxed">
              {revision.commit_message}
            </p>
          </div>

          <dl className="grid grid-cols-2 sm:grid-cols-4 gap-x-5 gap-y-2 text-xs border-t lg:border-t-0 pt-2 lg:pt-0 border-hairline">
            <div>
              <dt className="font-mono text-[10px] text-ink-muted">提交者</dt>
              <dd className="font-mono text-ink mt-0.5">{detail.author}</dd>
            </div>
            <div>
              <dt className="font-mono text-[10px] text-ink-muted">Base 版本</dt>
              <dd className="mt-0.5">
                {revision.base_revision_id ? (
                  <Link
                    to="/revisions/$revisionId"
                    params={{ revisionId: revision.base_revision_id }}
                    className="font-mono text-xs text-ink underline underline-offset-2"
                  >
                    {shortUuid(revision.base_revision_id)}
                  </Link>
                ) : (
                  <span className="font-mono text-ink-muted">—</span>
                )}
              </dd>
            </div>
            <div>
              <dt className="font-mono text-[10px] text-ink-muted">创建时间</dt>
              <dd className="mono-num text-[11px] text-ink-secondary mt-0.5">
                {formatTimestamp(revision.created_at)}
              </dd>
            </div>
            <div>
              <dt className="font-mono text-[10px] text-ink-muted">审查员</dt>
              <dd className="font-mono text-ink mt-0.5">{detail.reviewer ?? "—"}</dd>
            </div>
          </dl>
        </div>

        {revision.review_comment ? (
          <div className="border-t border-hairline pt-2.5 text-xs">
            <span className="font-mono text-[11px] text-ink-muted mr-2">审批意见：</span>
            <span className="text-ink">{revision.review_comment}</span>
          </div>
        ) : null}

        {revision.status === "pending_review" || revision.status === "conflict" ? (
          <div className="border-t border-hairline pt-3 space-y-2.5">
            {actionError ? (
              <div
                role="alert"
                className="flex items-center justify-between gap-2 border border-red-300 bg-red-50 px-3 py-2 text-xs text-red-900 font-mono"
              >
                <span>{actionError}</span>
                <Button variant="outline" size="xs" onClick={() => void detailQuery.refetch()}>
                  同步最新状态
                </Button>
              </div>
            ) : null}

            {canApprove ? (
              <div className="flex flex-wrap items-center gap-2">
                <Input
                  type="text"
                  aria-label="审批意见"
                  value={reviewComment}
                  onChange={(e) => setReviewComment(e.target.value)}
                  placeholder="填写人类审批意见（可选）…"
                  disabled={pendingAction !== null}
                  className="flex-1 min-w-[220px]"
                />
                {revision.status === "pending_review" ? (
                  <>
                    <Button
                      variant="outline"
                      size="sm"
                      disabled={pendingAction !== null}
                      onClick={() => void runReviewAction("approve")}
                    >
                      <Check className="h-3.5 w-3.5" aria-hidden="true" />
                      <span>{pendingAction === "approve" ? "正在批准…" : "批准 (Approve)"}</span>
                    </Button>
                    <Button
                      size="sm"
                      disabled={pendingAction !== null}
                      onClick={() => setConfirmKind("activate")}
                    >
                      <Zap className="h-3.5 w-3.5" aria-hidden="true" />
                      <span>批准并立即激活</span>
                    </Button>
                  </>
                ) : null}
                <Button
                  variant="destructiveOutline"
                  size="sm"
                  disabled={pendingAction !== null}
                  onClick={() => setConfirmKind("reject")}
                >
                  <XCircle className="h-3.5 w-3.5" aria-hidden="true" />
                  <span>拒绝 (Reject)</span>
                </Button>
              </div>
            ) : (
              <ForbiddenPanel
                title="审批权限受限"
                description="仅 admin 或 superadmin 角色可以批准、拒绝或解决修订冲突。"
              />
            )}
          </div>
        ) : null}
      </section>

      <Tabs value={activeTab} onValueChange={setStudioTab}>
        <div className="flex flex-wrap items-center justify-between gap-2">
          <TabsList>
            {isConflict ? (
              <TabsTrigger value="conflict">
                <ShieldAlert className="h-3.5 w-3.5" aria-hidden="true" />
                <span>三方冲突合并器 ({detail.conflicts.length})</span>
              </TabsTrigger>
            ) : null}
            <TabsTrigger value="diff">
              <GitCompare className="h-3.5 w-3.5" aria-hidden="true" />
              <span>差异对比 ({detail.files.length} 个文件)</span>
            </TabsTrigger>
          </TabsList>

          {activeTab === "diff" ? (
            <div className="flex flex-wrap items-center gap-2">
              <label htmlFor="diff-compare-pair" className="font-mono text-[11px] text-ink-muted">
                对比基准
              </label>
              <Select
                id="diff-compare-pair"
                value={comparePair}
                onChange={(e) => setComparePair(e.target.value as ComparePair)}
                className="h-7 font-mono text-xs"
              >
                <option value="active_incoming">Active → Incoming</option>
                <option value="base_incoming">Base → Incoming</option>
                <option value="base_active">Base → Active</option>
              </Select>

              <div className="inline-flex border border-hairline bg-surface rounded-sm p-0.5">
                <Button
                  variant={diffMode === "split" ? "default" : "ghost"}
                  size="xs"
                  onClick={() => setDiffMode("split")}
                  aria-pressed={diffMode === "split"}
                >
                  <Columns2 className="h-3 w-3" aria-hidden="true" />
                  <span>分栏对比</span>
                </Button>
                <Button
                  variant={diffMode === "unified" ? "default" : "ghost"}
                  size="xs"
                  onClick={() => setDiffMode("unified")}
                  aria-pressed={diffMode === "unified"}
                >
                  <Rows3 className="h-3 w-3" aria-hidden="true" />
                  <span>单栏对比</span>
                </Button>
              </div>
            </div>
          ) : null}
        </div>

        {isConflict ? (
          <TabsContent value="conflict">
            <ConflictMerger
              revision={revision}
              hasActiveRevision={Boolean(project.active_revision_id)}
              stale={detail.stale}
              conflicts={detail.conflicts}
              canApprove={canApprove}
              onResolved={() => {
                setStudioTab("diff");
                void invalidateAll();
              }}
            />
          </TabsContent>
        ) : null}

        <TabsContent value="diff">
          <div className="grid grid-cols-1 lg:grid-cols-12 border border-hairline bg-surface divide-y lg:divide-y-0 lg:divide-x divide-hairline min-h-[480px]">
            <aside aria-label="修订文件列表" className="lg:col-span-4 xl:col-span-3 flex flex-col">
              <div className="flex items-center justify-between border-b border-hairline px-3 py-2 bg-subtle/40">
                <span className="font-mono text-[11px] tracking-wider text-ink-muted">
                  文件清单 ({visibleFiles.length})
                </span>
                {unchangedCount > 0 ? (
                  <button
                    type="button"
                    onClick={() => setShowUnchanged((v) => !v)}
                    className="font-mono text-[11px] text-ink-secondary hover:text-ink underline underline-offset-2 cursor-pointer"
                  >
                    {showUnchanged ? "隐藏未变文件" : `显示未变 (+${unchangedCount})`}
                  </button>
                ) : null}
              </div>

              <ul className="divide-y divide-hairline overflow-y-auto max-h-[680px]">
                {visibleFiles.map((file) => {
                  const isSelected = file.path === selectedPath;
                  const hasConflict = conflictPathSet.has(file.path);
                  return (
                    <li key={file.path}>
                      <button
                        type="button"
                        onClick={() => setManualSelectedPath(file.path)}
                        aria-current={isSelected ? "true" : undefined}
                        className={cn(
                          "w-full text-left px-3 py-2 text-xs font-mono cursor-pointer transition-colors space-y-1",
                          isSelected
                            ? "bg-zinc-950 text-zinc-50"
                            : "bg-white text-ink hover:bg-subtle/60",
                        )}
                      >
                        <div className="flex items-center justify-between gap-2">
                          <span className="truncate">{file.path}</span>
                          <SingleTokenDelta
                            delta={file.token_delta}
                            className={isSelected ? "text-zinc-200" : undefined}
                          />
                        </div>
                        <div className="flex items-center justify-between gap-2">
                          <div className="flex items-center gap-1.5">
                            <ChangeTypeBadge type={file.change_type} />
                            {hasConflict ? <Badge variant="warning">冲突</Badge> : null}
                          </div>
                          <span
                            className={cn(
                              "mono-num text-[10px]",
                              isSelected ? "text-zinc-300" : "text-ink-muted",
                            )}
                          >
                            {formatTokens(file.token_count)} tok
                          </span>
                        </div>
                      </button>
                    </li>
                  );
                })}
              </ul>
            </aside>

            <section aria-label="选中文件差异对比" className="lg:col-span-8 xl:col-span-9 min-w-0">
              {!selectedPath ? (
                <div className="p-6">
                  <EmptyPanel
                    title="该修订暂无文件"
                    description="在左侧选择任意文件以按需加载差异视图。"
                  />
                </div>
              ) : leftQuery?.isLoading || rightQuery?.isLoading ? (
                <LoadingPanel
                  label={`正在加载 ${selectedPath}（${pair.leftLabel} / ${pair.rightLabel}）…`}
                  className="border-0"
                />
              ) : leftQuery?.error || rightQuery?.error ? (
                <div className="p-4">
                  <ErrorPanel
                    title={`加载 ${selectedPath} 差异失败`}
                    error={leftQuery?.error ?? rightQuery?.error}
                    onRetry={() => {
                      void leftQuery?.refetch();
                      void rightQuery?.refetch();
                    }}
                  />
                </div>
              ) : (
                <DiffViewer
                  path={selectedPath}
                  mode={diffMode}
                  leftLabel={pair.leftLabel}
                  rightLabel={pair.rightLabel}
                  leftSide={canFetchSide(pair.left) ? (leftQuery?.data ?? null) : null}
                  rightSide={canFetchSide(pair.right) ? (rightQuery?.data ?? null) : null}
                />
              )}
            </section>
          </div>
        </TabsContent>
      </Tabs>

      <ConfirmDialog
        open={confirmKind === "activate"}
        onOpenChange={(open) => {
          if (!open) setConfirmKind(null);
        }}
        title="确认批准并立即激活？"
        description="该操作会在单个数据库事务内批准修订并原子切换项目的 Active Revision 指针；所有 /mcp 只读客户端将立即读取此版本。"
        confirmLabel="批准并立即激活"
        pending={pendingAction === "activate"}
        onConfirm={() => void runReviewAction("activate")}
        details={
          <div className="border border-hairline bg-paper p-3 text-xs space-y-1 font-mono">
            <div>
              项目：<span className="font-semibold">{project.slug}</span>
            </div>
            <div>修订：{shortUuid(revision.id, 12)}</div>
            <TokenDelta added={revision.token_added} removed={revision.token_removed} />
          </div>
        }
      />

      <ConfirmDialog
        open={confirmKind === "reject"}
        onOpenChange={(open) => {
          if (!open) setConfirmKind(null);
        }}
        title="确认拒绝此修订？"
        description="被拒绝的修订仍将保留在历史记录中用于审计，但无法被任何 Agent 激活。"
        confirmLabel="确认拒绝"
        variant="destructive"
        pending={pendingAction === "reject"}
        onConfirm={() => void runReviewAction("reject")}
        details={
          <div className="border border-hairline bg-paper p-3 text-xs space-y-1 font-mono">
            <div>
              项目：<span className="font-semibold">{project.slug}</span>
            </div>
            <div>审批意见：{reviewComment.trim() || "（无）"}</div>
          </div>
        }
      />
    </div>
  );
}
