import { useMemo, useState } from "react";
import { Link } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Check,
  ChevronRight,
  GitCompare,
  RefreshCw,
  ShieldAlert,
  XCircle,
  Zap,
} from "lucide-react";
import { ConfirmDialog } from "@/components/ConfirmDialog";
import { CopyableHash } from "@/components/CopyableHash";
import { EmptyPanel, ErrorPanel, ForbiddenPanel, LoadingPanel } from "@/components/StateViews";
import { StatusBadge } from "@/components/StatusBadge";
import { SingleTokenDelta, TokenDelta } from "@/components/TokenDelta";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { Input, Select } from "@/components/ui/input";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { api, ApiError } from "@/lib/api";
import { useAuth } from "@/lib/auth-context";
import { formatRelativeTime, formatTimestamp, formatTokens, shortUuid } from "@/lib/format";
import type { RevisionListRow, RevisionStatus } from "@/lib/types";
import { cn } from "@/lib/utils";

type QueueFilter = "queue" | "approved" | "history";

const STATUS_MAP: Record<QueueFilter, RevisionStatus[]> = {
  queue: ["pending_review", "conflict"],
  approved: ["approved"],
  history: ["active", "rejected", "superseded"],
};

function ExpandableRevisionFiles({ revisionId }: { revisionId: string }) {
  const [open, setOpen] = useState(false);

  const detailQuery = useQuery({
    queryKey: ["revision", revisionId],
    queryFn: () => api.revisionDetail(revisionId),
    enabled: open,
  });

  const changedFiles = useMemo(
    () => (detailQuery.data?.files ?? []).filter((f) => f.change_type !== "unchanged"),
    [detailQuery.data?.files],
  );

  return (
    <Collapsible open={open} onOpenChange={setOpen}>
      <CollapsibleTrigger
        render={
          <Button variant="ghost" size="xs" className="group px-1.5 text-xs text-ink-secondary" />
        }
      >
        <ChevronRight
          className="h-3 w-3 transition-transform group-data-panel-open:rotate-90"
          aria-hidden="true"
        />
        <span>{open ? "收起变更文件" : "查看变更文件"}</span>
      </CollapsibleTrigger>

      <CollapsibleContent className="mt-2 border border-hairline bg-paper">
        {detailQuery.isLoading ? (
          <div className="px-3 py-2 text-xs text-ink-muted">加载中…</div>
        ) : detailQuery.error ? (
          <div className="px-3 py-2 text-xs text-red-700">加载失败</div>
        ) : changedFiles.length === 0 ? (
          <div className="px-3 py-2 text-xs text-ink-muted">与当前生效版本无内容差异</div>
        ) : (
          <ul className="divide-y divide-hairline">
            {changedFiles.map((file) => (
              <li
                key={file.path}
                className="flex items-center justify-between gap-3 px-3 py-1.5 text-xs font-mono"
              >
                <div className="flex items-center gap-2 min-w-0">
                  <Badge variant="muted" className="text-[10px]">
                    {file.change_type === "added"
                      ? "新增"
                      : file.change_type === "modified"
                        ? "修改"
                        : "删除"}
                  </Badge>
                  <span className="truncate text-ink">{file.path}</span>
                </div>
                <div className="flex items-center gap-3 shrink-0">
                  <SingleTokenDelta delta={file.token_delta} />
                  <span className="mono-num text-[11px] text-ink-muted">
                    {formatTokens(file.token_count)} tok
                  </span>
                </div>
              </li>
            ))}
          </ul>
        )}
      </CollapsibleContent>
    </Collapsible>
  );
}

export function ReviewQueuePage() {
  const { projects, canApprove } = useAuth();
  const queryClient = useQueryClient();

  const [scopeSlug, setScopeSlug] = useState<string>("");
  const [tab, setTab] = useState<QueueFilter>("queue");
  const [comments, setComments] = useState<Record<string, string>>({});
  const [busyId, setBusyId] = useState<string | null>(null);
  const [rowError, setRowError] = useState<Record<string, string>>({});
  const [confirmTarget, setConfirmTarget] = useState<{
    kind: "activate" | "reject";
    row: RevisionListRow;
  } | null>(null);

  const statuses = STATUS_MAP[tab];
  const targetProjects = useMemo(
    () => (scopeSlug ? projects.filter((p) => p.slug === scopeSlug) : projects),
    [projects, scopeSlug],
  );

  const revisionsQuery = useQuery({
    queryKey: [
      "review-queue",
      scopeSlug || "__all__",
      tab,
      targetProjects.map((p) => p.slug).join(","),
    ],
    queryFn: async () => {
      if (targetProjects.length === 0) return [] as RevisionListRow[];
      const responses = await Promise.all(
        targetProjects.map((project) => api.projectRevisions(project.slug, statuses)),
      );
      const merged = responses.flatMap((res) => res.revisions);
      merged.sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime());
      return merged;
    },
    enabled: projects.length > 0,
  });

  const invalidateAll = async (revisionId: string) => {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: ["review-queue"] }),
      queryClient.invalidateQueries({ queryKey: ["revision", revisionId] }),
      queryClient.invalidateQueries({ queryKey: ["dashboard"] }),
      queryClient.invalidateQueries({ queryKey: ["workspace"] }),
      queryClient.invalidateQueries({ queryKey: ["auth", "me"] }),
    ]);
  };

  const executeAction = async (kind: "approve" | "activate" | "reject", row: RevisionListRow) => {
    setBusyId(row.id);
    setRowError((prev) => {
      const next = { ...prev };
      delete next[row.id];
      return next;
    });

    const comment = (comments[row.id] ?? "").trim();
    try {
      if (kind === "reject") {
        await api.rejectRevision(row.id, { comment });
      } else {
        await api.approveRevision(row.id, {
          comment,
          activate_now: kind === "activate",
        });
      }
      setConfirmTarget(null);
      await invalidateAll(row.id);
    } catch (err) {
      setConfirmTarget(null);
      const message =
        err instanceof ApiError ? `${err.code}: ${err.message}` : "操作失败，请重试。";
      setRowError((prev) => ({ ...prev, [row.id]: message }));
    } finally {
      setBusyId(null);
    }
  };

  const rows = revisionsQuery.data ?? [];

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-hairline pb-3">
        <h1 className="text-base font-semibold tracking-tight text-ink">审批队列</h1>

        <div className="flex flex-wrap items-center gap-2">
          <Select
            id="review-project-filter"
            aria-label="筛选项目"
            value={scopeSlug}
            onChange={(e) => setScopeSlug(e.target.value)}
            className="h-7 min-w-[160px] font-mono"
          >
            <option value="">全部项目 ({projects.length})</option>
            {projects.map((p) => (
              <option key={p.id} value={p.slug}>
                {p.slug}
              </option>
            ))}
          </Select>
          <Button
            variant="outline"
            size="sm"
            onClick={() => void revisionsQuery.refetch()}
            disabled={revisionsQuery.isFetching}
          >
            <RefreshCw
              className={cn("h-3.5 w-3.5", revisionsQuery.isFetching && "animate-spin")}
              aria-hidden="true"
            />
            <span>刷新</span>
          </Button>
        </div>
      </div>

      {!canApprove ? (
        <ForbiddenPanel
          title="仅管理员可审批"
          description="当前账号为普通成员，可查看变更内容，但不能执行批准、拒绝或解决冲突。"
        />
      ) : null}

      <Tabs value={tab} onValueChange={(v) => setTab(v as QueueFilter)}>
        <TabsList>
          <TabsTrigger value="queue">待处理</TabsTrigger>
          <TabsTrigger value="approved">已批准</TabsTrigger>
          <TabsTrigger value="history">历史记录</TabsTrigger>
        </TabsList>
      </Tabs>

      {revisionsQuery.isLoading ? (
        <LoadingPanel label="加载中…" />
      ) : revisionsQuery.error ? (
        <ErrorPanel
          title="审批队列加载失败"
          error={revisionsQuery.error}
          onRetry={() => void revisionsQuery.refetch()}
        />
      ) : rows.length === 0 ? (
        <EmptyPanel
          title={
            tab === "queue"
              ? "没有待处理的修订"
              : tab === "approved"
                ? "没有等待激活的修订"
                : "暂无历史记录"
          }
        />
      ) : (
        <ul className="divide-y divide-hairline border border-hairline bg-surface">
          {rows.map((row) => {
            const isBusy = busyId === row.id;
            const errorMsg = rowError[row.id];
            return (
              <li key={row.id} className="p-4 space-y-3">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div className="flex flex-wrap items-center gap-2">
                    <StatusBadge
                      status={row.status}
                      stale={row.stale}
                      conflictCount={row.conflict_count}
                    />
                    <span className="font-mono text-xs font-semibold text-ink">
                      {row.project_slug}
                    </span>
                    <CopyableHash value={row.id} />
                  </div>

                  <div className="flex flex-wrap items-center gap-3">
                    <TokenDelta added={row.token_added} removed={row.token_removed} />
                    <span className="mono-num text-[11px] text-ink-muted">
                      {row.file_count} 个文件 · {formatTokens(row.total_tokens)} tok
                    </span>
                    <span
                      title={formatTimestamp(row.created_at)}
                      className="mono-num text-[11px] text-ink-muted"
                    >
                      {formatRelativeTime(row.created_at)}
                    </span>
                  </div>
                </div>

                <div className="space-y-1">
                  <p className="whitespace-pre-wrap text-sm font-medium text-ink leading-relaxed">
                    {row.commit_message}
                  </p>
                  <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-[11px] text-ink-secondary">
                    <span>
                      提交：<code className="font-mono text-ink">{row.author}</code>
                    </span>
                    {row.reviewer ? (
                      <span>
                        审批：<code className="font-mono text-ink">{row.reviewer}</code>
                      </span>
                    ) : null}
                    {row.comment ? (
                      <span className="text-ink-muted">备注：“{row.comment}”</span>
                    ) : null}
                  </div>
                </div>

                <ExpandableRevisionFiles revisionId={row.id} />

                {errorMsg ? (
                  <div
                    role="alert"
                    className="flex items-center justify-between gap-2 border border-red-300 bg-red-50 px-3 py-2 text-xs text-red-900 font-mono"
                  >
                    <span>{errorMsg}</span>
                    <Button
                      variant="outline"
                      size="xs"
                      onClick={() => void revisionsQuery.refetch()}
                    >
                      刷新
                    </Button>
                  </div>
                ) : null}

                <div className="flex flex-wrap items-center justify-between gap-3 pt-1">
                  <Link
                    to="/revisions/$revisionId"
                    params={{ revisionId: row.id }}
                    className={cn(
                      "inline-flex items-center gap-1.5 rounded-sm border px-2.5 py-1 text-xs font-medium no-underline transition-colors",
                      row.status === "conflict"
                        ? "border-amber-500 bg-amber-50 text-amber-950 hover:bg-amber-100"
                        : "border-zinc-300 bg-white text-ink hover:bg-subtle",
                    )}
                  >
                    {row.status === "conflict" ? (
                      <>
                        <ShieldAlert className="h-3.5 w-3.5" aria-hidden="true" />
                        <span>解决冲突</span>
                      </>
                    ) : (
                      <>
                        <GitCompare className="h-3.5 w-3.5" aria-hidden="true" />
                        <span>查看差异</span>
                      </>
                    )}
                  </Link>

                  {canApprove && (row.status === "pending_review" || row.status === "conflict") ? (
                    <div className="flex flex-wrap items-center gap-2 flex-1 justify-end min-w-[260px]">
                      <Input
                        type="text"
                        aria-label={`${row.id} 审批备注`}
                        value={comments[row.id] ?? ""}
                        onChange={(e) =>
                          setComments((prev) => ({ ...prev, [row.id]: e.target.value }))
                        }
                        placeholder="审批备注（可选）"
                        disabled={isBusy}
                        className="h-7 max-w-xs"
                      />

                      {row.status === "pending_review" ? (
                        <>
                          <Button
                            variant="outline"
                            size="xs"
                            disabled={isBusy}
                            onClick={() => void executeAction("approve", row)}
                          >
                            <Check className="h-3 w-3" aria-hidden="true" />
                            <span>{isBusy ? "处理中…" : "批准"}</span>
                          </Button>
                          <Button
                            size="xs"
                            disabled={isBusy}
                            onClick={() => setConfirmTarget({ kind: "activate", row })}
                          >
                            <Zap className="h-3 w-3" aria-hidden="true" />
                            <span>批准并激活</span>
                          </Button>
                        </>
                      ) : null}

                      <Button
                        variant="destructiveOutline"
                        size="xs"
                        disabled={isBusy}
                        onClick={() => setConfirmTarget({ kind: "reject", row })}
                      >
                        <XCircle className="h-3 w-3" aria-hidden="true" />
                        <span>拒绝</span>
                      </Button>
                    </div>
                  ) : null}
                </div>
              </li>
            );
          })}
        </ul>
      )}

      <ConfirmDialog
        open={confirmTarget?.kind === "activate"}
        onOpenChange={(open) => {
          if (!open) setConfirmTarget(null);
        }}
        title="批准并立即激活？"
        description="确认后该版本将立即成为项目当前生效版本，所有接入端会立刻读取本次变更。"
        confirmLabel="确认激活"
        pending={Boolean(confirmTarget && busyId === confirmTarget.row.id)}
        onConfirm={() => {
          if (confirmTarget) void executeAction("activate", confirmTarget.row);
        }}
        details={
          confirmTarget ? (
            <div className="border border-hairline bg-paper p-3 text-xs space-y-1 font-mono">
              <div>
                项目：<span className="font-semibold">{confirmTarget.row.project_slug}</span>
              </div>
              <div>版本：{shortUuid(confirmTarget.row.id, 12)}</div>
              <TokenDelta
                added={confirmTarget.row.token_added}
                removed={confirmTarget.row.token_removed}
              />
            </div>
          ) : null
        }
      />

      <ConfirmDialog
        open={confirmTarget?.kind === "reject"}
        onOpenChange={(open) => {
          if (!open) setConfirmTarget(null);
        }}
        title="拒绝此修订？"
        description="拒绝后该修订将归档，无法被激活。"
        confirmLabel="确认拒绝"
        variant="destructive"
        pending={Boolean(confirmTarget && busyId === confirmTarget.row.id)}
        onConfirm={() => {
          if (confirmTarget) void executeAction("reject", confirmTarget.row);
        }}
        details={
          confirmTarget ? (
            <div className="border border-hairline bg-paper p-3 text-xs space-y-1 font-mono">
              <div>
                项目：<span className="font-semibold">{confirmTarget.row.project_slug}</span>
              </div>
              <div>备注：{(comments[confirmTarget.row.id] ?? "").trim() || "（无）"}</div>
            </div>
          ) : null
        }
      />
    </div>
  );
}
