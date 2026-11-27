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
          <Button
            variant="ghost"
            size="xs"
            className="group px-1.5 font-mono text-[11px] text-ink-secondary"
          />
        }
      >
        <ChevronRight
          className="h-3 w-3 transition-transform group-data-panel-open:rotate-90"
          aria-hidden="true"
        />
        <span>{open ? "收起文件级 Token 差异" : "展开文件级 Token 差异"}</span>
      </CollapsibleTrigger>

      <CollapsibleContent className="mt-2 border border-hairline bg-paper">
        {detailQuery.isLoading ? (
          <div className="px-3 py-2 font-mono text-[11px] text-ink-muted">正在加载文件差异…</div>
        ) : detailQuery.error ? (
          <div className="px-3 py-2 font-mono text-[11px] text-red-700">加载文件差异失败。</div>
        ) : changedFiles.length === 0 ? (
          <div className="px-3 py-2 font-mono text-[11px] text-ink-muted">
            相对当前激活版本无内容变更。
          </div>
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
      const message = err instanceof ApiError ? `${err.code}: ${err.message}` : "操作执行失败。";
      setRowError((prev) => ({ ...prev, [row.id]: message }));
    } finally {
      setBusyId(null);
    }
  };

  const rows = revisionsQuery.data ?? [];

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-end justify-between gap-3 border-b border-hairline pb-3">
        <div>
          <h1 className="text-base font-semibold tracking-tight text-ink">人类审批队列</h1>
          <p className="mt-0.5 text-xs text-ink-secondary">
            汇总待审与冲突修订，支持 Approve、Approve &amp; Activate Now、Reject
            及三方冲突解决；Agent 无法绕过人类审批。
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <label htmlFor="review-project-filter" className="font-mono text-[11px] text-ink-muted">
            项目筛选
          </label>
          <Select
            id="review-project-filter"
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
          title="当前账号为只读审批视图"
          description="你的角色为 member。批准、拒绝或解决冲突需要 admin 或 superadmin 会话。"
        />
      ) : null}

      <Tabs value={tab} onValueChange={(v) => setTab(v as QueueFilter)}>
        <TabsList>
          <TabsTrigger value="queue">待处理（待审与冲突）</TabsTrigger>
          <TabsTrigger value="approved">已批准待激活</TabsTrigger>
          <TabsTrigger value="history">已激活与历史</TabsTrigger>
        </TabsList>
      </Tabs>

      {revisionsQuery.isLoading ? (
        <LoadingPanel label="正在加载审批队列…" />
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
              ? "当前没有待审批或冲突修订"
              : tab === "approved"
                ? "没有等待 Agent 激活的已批准修订"
                : "当前范围内暂无历史修订"
          }
          description={
            tab === "queue" ? "通过 /admin/mcp 提交的待审提案或合并冲突会显示在这里。" : undefined
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
                    <CopyableHash value={row.id} prefix="rev:" />
                  </div>

                  <div className="flex flex-wrap items-center gap-3">
                    <TokenDelta added={row.token_added} removed={row.token_removed} />
                    <span className="mono-num text-[11px] text-ink-muted">
                      总计 {formatTokens(row.total_tokens)} tok · {row.file_count} 个文件
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
                      提交者：<code className="font-mono text-ink">{row.author}</code>
                    </span>
                    {row.reviewer ? (
                      <span>
                        审查员：<code className="font-mono text-ink">{row.reviewer}</code>
                      </span>
                    ) : null}
                    {row.comment ? (
                      <span className="text-ink-muted">审批意见：“{row.comment}”</span>
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
                      同步状态
                    </Button>
                  </div>
                ) : null}

                <div className="flex flex-wrap items-center justify-between gap-3 pt-1">
                  <div className="flex flex-wrap items-center gap-2">
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
                          <span>处理三方冲突 ({shortUuid(row.id)})</span>
                        </>
                      ) : (
                        <>
                          <GitCompare className="h-3.5 w-3.5" aria-hidden="true" />
                          <span>查看差异对比</span>
                        </>
                      )}
                    </Link>
                  </div>

                  {canApprove && (row.status === "pending_review" || row.status === "conflict") ? (
                    <div className="flex flex-wrap items-center gap-2 flex-1 justify-end min-w-[260px]">
                      <Input
                        type="text"
                        aria-label={`${row.id} 审批意见`}
                        value={comments[row.id] ?? ""}
                        onChange={(e) =>
                          setComments((prev) => ({ ...prev, [row.id]: e.target.value }))
                        }
                        placeholder="填写审批意见（可选）…"
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
                            <span>批准并立即激活</span>
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
        title="确认批准并立即激活？"
        description="该操作将原子完成人类批准并切换项目的 Active Revision 指针，所有 /mcp 客户端会立即读取此版本。"
        confirmLabel="批准并立即激活"
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
              <div>修订：{shortUuid(confirmTarget.row.id, 12)}</div>
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
        title="确认拒绝此修订？"
        description="被拒绝的修订将保持不可激活状态。"
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
              <div>审批意见：{(comments[confirmTarget.row.id] ?? "").trim() || "（无）"}</div>
            </div>
          ) : null
        }
      />
    </div>
  );
}
