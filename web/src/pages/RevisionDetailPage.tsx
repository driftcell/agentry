import { useMemo, useState, useTransition } from "react";
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
import { FadeTransition } from "@/components/FadeTransition";
import { EmptyPanel, ErrorPanel, ForbiddenPanel, LoadingPanel } from "@/components/StateViews";
import { StatusBadge } from "@/components/StatusBadge";
import { SingleTokenDelta, TokenDelta } from "@/components/TokenDelta";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Combobox,
  ComboboxContent,
  ComboboxItem,
  ComboboxList,
  ComboboxTrigger,
  ComboboxValue,
} from "@/components/ui/combobox";
import { Input } from "@/components/ui/input";
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
        leftLabel: "当前生效",
        rightLabel: "本次变更",
      };
    case "base_incoming":
      return {
        left: "base",
        right: "incoming",
        leftLabel: "原始基线",
        rightLabel: "本次变更",
      };
    case "base_active":
      return {
        left: "base",
        right: "active",
        leftLabel: "原始基线",
        rightLabel: "当前生效",
      };
  }
}

const COMPARE_PAIR_OPTIONS: ReadonlyArray<{ value: ComparePair; label: string }> = [
  { value: "active_incoming", label: "当前生效 → 本次变更" },
  { value: "base_incoming", label: "原始基线 → 本次变更" },
  { value: "base_active", label: "原始基线 → 当前生效" },
];

function ChangeTypeBadge({ type }: { type: RevisionFileView["change_type"] }) {
  switch (type) {
    case "added":
      return (
        <Badge variant="outline" className="border-emerald-300 bg-emerald-50 text-emerald-800">
          新增
        </Badge>
      );
    case "modified":
      return <Badge variant="outline">修改</Badge>;
    case "deleted":
      return <Badge variant="destructive">删除</Badge>;
    case "unchanged":
      return <Badge variant="secondary">未变</Badge>;
  }
}

export function RevisionDetailPage({ revisionId }: { revisionId: string }) {
  const { canApprove } = useAuth();
  const queryClient = useQueryClient();
  const [, startTransition] = useTransition();

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
  const canFetchSide = (side: FileSideName, path: string | null = selectedPath) => {
    if (!revision || !project || !path) return false;
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

  const prefetchFilePair = async (path: string, nextComparePair: ComparePair) => {
    const nextPair = comparePairSides(nextComparePair);
    const requests: Promise<unknown>[] = [];

    if (canFetchSide(nextPair.left, path)) {
      requests.push(
        queryClient.prefetchQuery({
          queryKey: ["revision-file", revisionId, path, nextPair.left],
          queryFn: () => api.revisionFile(revisionId, path, nextPair.left),
        }),
      );
    }

    if (canFetchSide(nextPair.right, path)) {
      requests.push(
        queryClient.prefetchQuery({
          queryKey: ["revision-file", revisionId, path, nextPair.right],
          queryFn: () => api.revisionFile(revisionId, path, nextPair.right),
        }),
      );
    }

    await Promise.all(requests);
  };

  const selectFile = (path: string) => {
    startTransition(async () => {
      await prefetchFilePair(path, comparePair);
      setManualSelectedPath(path);
    });
  };

  const changeComparePair = (next: ComparePair) => {
    if (!selectedPath) {
      setComparePair(next);
      return;
    }
    startTransition(async () => {
      await prefetchFilePair(selectedPath, next);
      setComparePair(next);
    });
  };

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
        setActionError("操作失败，请重试。");
      }
    } finally {
      setPendingAction(null);
    }
  };

  if (detailQuery.isLoading) {
    return <LoadingPanel label="加载中…" />;
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
    return <EmptyPanel title="修订不存在" />;
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
          <span style={{ viewTransitionName: "revision-identity" }}>
            <CopyableHash value={revision.id} />
          </span>
          <StatusBadge
            status={revision.status}
            stale={detail.stale}
            conflictCount={detail.conflicts.length}
          />
        </div>

        <div className="flex items-center gap-2">
          <TokenDelta added={revision.token_added} removed={revision.token_removed} />
          <span className="mono-num text-xs text-ink-muted">
            {revision.file_count} 个文件 · {formatTokens(revision.total_tokens)} tok
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
          className="flex items-center justify-between gap-3 border border-amber-400 bg-amber-50/70 px-4 py-2.5 text-xs text-amber-950"
        >
          <div className="flex items-center gap-2">
            <AlertTriangle className="h-4 w-4 shrink-0 text-amber-800" aria-hidden="true" />
            <span>
              当前生效版本已更新，此提案基于旧版本合并，批准前请核对「当前生效 → 本次变更」差异。
            </span>
          </div>
          <Button variant="outline" size="xs" onClick={() => void detailQuery.refetch()}>
            刷新
          </Button>
        </div>
      ) : null}

      <section
        aria-label="修订信息与审批"
        className="border border-hairline bg-surface p-4 space-y-3"
      >
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="space-y-1 flex-1 min-w-[260px]">
            <p className="text-[11px] text-ink-muted">提交说明</p>
            <p className="whitespace-pre-wrap text-sm font-medium text-ink leading-relaxed">
              {revision.commit_message}
            </p>
          </div>

          <dl className="grid grid-cols-2 sm:grid-cols-4 gap-x-5 gap-y-2 text-xs border-t lg:border-t-0 pt-2 lg:pt-0 border-hairline">
            <div>
              <dt className="text-[11px] text-ink-muted">提交者</dt>
              <dd className="font-mono text-ink mt-0.5">{detail.author}</dd>
            </div>
            <div>
              <dt className="text-[11px] text-ink-muted">基于版本</dt>
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
              <dt className="text-[11px] text-ink-muted">提交时间</dt>
              <dd className="mono-num text-[11px] text-ink-secondary mt-0.5">
                {formatTimestamp(revision.created_at)}
              </dd>
            </div>
            <div>
              <dt className="text-[11px] text-ink-muted">审批人</dt>
              <dd className="font-mono text-ink mt-0.5">{detail.reviewer ?? "—"}</dd>
            </div>
          </dl>
        </div>

        {revision.review_comment ? (
          <div className="border-t border-hairline pt-2.5 text-xs">
            <span className="text-ink-muted mr-2">审批备注：</span>
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
                  刷新
                </Button>
              </div>
            ) : null}

            {canApprove ? (
              <div className="flex flex-wrap items-center gap-2">
                <Input
                  type="text"
                  aria-label="审批备注"
                  value={reviewComment}
                  onChange={(e) => setReviewComment(e.target.value)}
                  placeholder="审批备注（可选）"
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
                      <span>{pendingAction === "approve" ? "处理中…" : "批准"}</span>
                    </Button>
                    <Button
                      size="sm"
                      disabled={pendingAction !== null}
                      onClick={() => setConfirmKind("activate")}
                    >
                      <Zap className="h-3.5 w-3.5" aria-hidden="true" />
                      <span>批准并激活</span>
                    </Button>
                  </>
                ) : null}
                <Button
                  variant="destructive"
                  size="sm"
                  disabled={pendingAction !== null}
                  onClick={() => setConfirmKind("reject")}
                >
                  <XCircle className="h-3.5 w-3.5" aria-hidden="true" />
                  <span>拒绝</span>
                </Button>
              </div>
            ) : (
              <ForbiddenPanel
                title="仅管理员可审批"
                description="当前账号为普通成员，无法批准、拒绝或处理冲突。"
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
                <span>冲突解决 ({detail.conflicts.length})</span>
              </TabsTrigger>
            ) : null}
            <TabsTrigger value="diff">
              <GitCompare className="h-3.5 w-3.5" aria-hidden="true" />
              <span>文件差异 ({detail.files.length})</span>
            </TabsTrigger>
          </TabsList>

          {activeTab === "diff" ? (
            <div className="flex flex-wrap items-center gap-2">
              <Combobox
                items={[...COMPARE_PAIR_OPTIONS]}
                value={COMPARE_PAIR_OPTIONS.find((p) => p.value === comparePair) ?? null}
                onValueChange={(next) => {
                  if (next) changeComparePair(next.value);
                }}
                itemToStringLabel={(item) => item.label}
                itemToStringValue={(item) => item.value}
                isItemEqualToValue={(item, current) => item.value === current.value}
              >
                <ComboboxTrigger
                  id="diff-compare-pair"
                  aria-label="对比版本"
                  render={<Button variant="outline" size="sm" className="h-7 justify-between" />}
                >
                  <ComboboxValue />
                </ComboboxTrigger>
                <ComboboxContent>
                  <ComboboxList>
                    {(item) => (
                      <ComboboxItem key={item.value} value={item}>
                        {item.label}
                      </ComboboxItem>
                    )}
                  </ComboboxList>
                </ComboboxContent>
              </Combobox>

              <div className="inline-flex border border-hairline bg-surface rounded-sm p-0.5">
                <Button
                  variant={diffMode === "split" ? "default" : "ghost"}
                  size="xs"
                  onClick={() => setDiffMode("split")}
                  aria-pressed={diffMode === "split"}
                >
                  <Columns2 className="h-3 w-3" aria-hidden="true" />
                  <span>分栏</span>
                </Button>
                <Button
                  variant={diffMode === "unified" ? "default" : "ghost"}
                  size="xs"
                  onClick={() => setDiffMode("unified")}
                  aria-pressed={diffMode === "unified"}
                >
                  <Rows3 className="h-3 w-3" aria-hidden="true" />
                  <span>单栏</span>
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
            <aside aria-label="文件列表" className="lg:col-span-4 xl:col-span-3 flex flex-col">
              <div className="flex items-center justify-between border-b border-hairline px-3 py-2 bg-subtle/40">
                <span className="text-xs font-medium text-ink-muted">
                  文件 ({visibleFiles.length})
                </span>
                {unchangedCount > 0 ? (
                  <button
                    type="button"
                    onClick={() => setShowUnchanged((v) => !v)}
                    className="text-[11px] text-ink-secondary hover:text-ink underline underline-offset-2 cursor-pointer"
                  >
                    {showUnchanged ? "仅看变更" : `显示全部 (+${unchangedCount})`}
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
                        onClick={() => selectFile(file.path)}
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
                            {hasConflict ? (
                              <Badge
                                variant="outline"
                                className="border-amber-300 bg-amber-50 text-amber-900"
                              >
                                冲突
                              </Badge>
                            ) : null}
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

            <section aria-label="文件差异详情" className="lg:col-span-8 xl:col-span-9 min-w-0">
              <FadeTransition key={`${selectedPath ?? "none"}-${comparePair}`}>
                {!selectedPath ? (
                  <div className="p-6">
                    <EmptyPanel title="暂无文件" />
                  </div>
                ) : leftQuery?.isLoading || rightQuery?.isLoading ? (
                  <LoadingPanel label={`正在加载 ${selectedPath}…`} className="border-0" />
                ) : leftQuery?.error || rightQuery?.error ? (
                  <div className="p-4">
                    <ErrorPanel
                      title={`无法加载 ${selectedPath}`}
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
              </FadeTransition>
            </section>
          </div>
        </TabsContent>
      </Tabs>

      <ConfirmDialog
        open={confirmKind === "activate"}
        onOpenChange={(open) => {
          if (!open) setConfirmKind(null);
        }}
        title="批准并立即激活？"
        description="确认后该版本将立即成为项目当前生效版本，所有接入端会立刻读取本次变更。"
        confirmLabel="确认激活"
        pending={pendingAction === "activate"}
        onConfirm={() => void runReviewAction("activate")}
        details={
          <div className="border border-hairline bg-paper p-3 text-xs space-y-1 font-mono">
            <div>
              项目：<span className="font-semibold">{project.slug}</span>
            </div>
            <div>版本：{shortUuid(revision.id, 12)}</div>
            <TokenDelta added={revision.token_added} removed={revision.token_removed} />
          </div>
        }
      />

      <ConfirmDialog
        open={confirmKind === "reject"}
        onOpenChange={(open) => {
          if (!open) setConfirmKind(null);
        }}
        title="拒绝此修订？"
        description="拒绝后该修订将归档，无法被激活。"
        confirmLabel="确认拒绝"
        variant="destructive"
        pending={pendingAction === "reject"}
        onConfirm={() => void runReviewAction("reject")}
        details={
          <div className="border border-hairline bg-paper p-3 text-xs space-y-1 font-mono">
            <div>
              项目：<span className="font-semibold">{project.slug}</span>
            </div>
            <div>备注：{reviewComment.trim() || "（无）"}</div>
          </div>
        }
      />
    </div>
  );
}
