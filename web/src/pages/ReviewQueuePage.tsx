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
        <span>{open ? "Hide file token diffs" : "Inspect file token diffs"}</span>
      </CollapsibleTrigger>

      <CollapsibleContent className="mt-2 border border-hairline bg-paper">
        {detailQuery.isLoading ? (
          <div className="px-3 py-2 font-mono text-[11px] text-ink-muted">Loading file diffs…</div>
        ) : detailQuery.error ? (
          <div className="px-3 py-2 font-mono text-[11px] text-red-700">Unable to load files.</div>
        ) : changedFiles.length === 0 ? (
          <div className="px-3 py-2 font-mono text-[11px] text-ink-muted">
            No file content changes relative to active snapshot.
          </div>
        ) : (
          <ul className="divide-y divide-hairline">
            {changedFiles.map((file) => (
              <li
                key={file.path}
                className="flex items-center justify-between gap-3 px-3 py-1.5 text-xs font-mono"
              >
                <div className="flex items-center gap-2 min-w-0">
                  <Badge variant="muted" className="uppercase text-[10px]">
                    {file.change_type}
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
        err instanceof ApiError
          ? `${err.code}: ${err.message}`
          : "Unable to complete review action.";
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
          <h1 className="text-base font-semibold tracking-tight text-ink">Human Review Queue</h1>
          <p className="mt-0.5 text-xs text-ink-secondary">
            Approve, reject, or resolve merge conflicts. Agents can propose and activate approved
            revisions, never approve on your behalf.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <label htmlFor="review-project-filter" className="font-mono text-[11px] text-ink-muted">
            PROJECT
          </label>
          <Select
            id="review-project-filter"
            value={scopeSlug}
            onChange={(e) => setScopeSlug(e.target.value)}
            className="h-7 min-w-[160px] font-mono"
          >
            <option value="">All projects ({projects.length})</option>
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
            <span>Refresh</span>
          </Button>
        </div>
      </div>

      {!canApprove ? (
        <ForbiddenPanel
          title="Read-only review view"
          description="Your role is member. Approving, rejecting, or resolving conflicts requires an admin or superadmin session."
        />
      ) : null}

      <Tabs value={tab} onValueChange={(v) => setTab(v as QueueFilter)}>
        <TabsList>
          <TabsTrigger value="queue">Needs Attention</TabsTrigger>
          <TabsTrigger value="approved">Approved</TabsTrigger>
          <TabsTrigger value="history">Active &amp; History</TabsTrigger>
        </TabsList>
      </Tabs>

      {revisionsQuery.isLoading ? (
        <LoadingPanel label="Loading revision queue…" />
      ) : revisionsQuery.error ? (
        <ErrorPanel
          title="Failed to load revisions"
          error={revisionsQuery.error}
          onRetry={() => void revisionsQuery.refetch()}
        />
      ) : rows.length === 0 ? (
        <EmptyPanel
          title={
            tab === "queue"
              ? "Review queue is clear"
              : tab === "approved"
                ? "No approved revisions waiting for activation"
                : "No historical revisions in this scope"
          }
          description={
            tab === "queue"
              ? "Incoming proposals from /admin/mcp that require review or conflict resolution will appear here."
              : undefined
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
                      {formatTokens(row.total_tokens)} tok · {row.file_count} files
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
                      Author: <code className="font-mono text-ink">{row.author}</code>
                    </span>
                    {row.reviewer ? (
                      <span>
                        Reviewed by: <code className="font-mono text-ink">{row.reviewer}</code>
                      </span>
                    ) : null}
                    {row.comment ? (
                      <span className="text-ink-muted">Comment: “{row.comment}”</span>
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
                      Sync
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
                          <span>Resolve Conflicts ({shortUuid(row.id)})</span>
                        </>
                      ) : (
                        <>
                          <GitCompare className="h-3.5 w-3.5" aria-hidden="true" />
                          <span>Open Diff Studio</span>
                        </>
                      )}
                    </Link>
                  </div>

                  {canApprove && (row.status === "pending_review" || row.status === "conflict") ? (
                    <div className="flex flex-wrap items-center gap-2 flex-1 justify-end min-w-[260px]">
                      <Input
                        type="text"
                        aria-label={`Review comment for ${row.id}`}
                        value={comments[row.id] ?? ""}
                        onChange={(e) =>
                          setComments((prev) => ({ ...prev, [row.id]: e.target.value }))
                        }
                        placeholder="Review comment (optional)…"
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
                            <span>{isBusy ? "Saving…" : "Approve"}</span>
                          </Button>
                          <Button
                            size="xs"
                            disabled={isBusy}
                            onClick={() => setConfirmTarget({ kind: "activate", row })}
                          >
                            <Zap className="h-3 w-3" aria-hidden="true" />
                            <span>Approve &amp; Activate Now</span>
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
                        <span>Reject</span>
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
        title="Approve and activate revision now?"
        description="This atomically marks the revision active and updates the project's live Active Revision pointer for all /mcp clients."
        confirmLabel="Approve & Activate Now"
        pending={Boolean(confirmTarget && busyId === confirmTarget.row.id)}
        onConfirm={() => {
          if (confirmTarget) void executeAction("activate", confirmTarget.row);
        }}
        details={
          confirmTarget ? (
            <div className="border border-hairline bg-paper p-3 text-xs space-y-1 font-mono">
              <div>
                Project: <span className="font-semibold">{confirmTarget.row.project_slug}</span>
              </div>
              <div>Revision: {shortUuid(confirmTarget.row.id, 12)}</div>
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
        title="Reject this revision?"
        description="Rejected revisions cannot be activated later."
        confirmLabel="Reject Revision"
        variant="destructive"
        pending={Boolean(confirmTarget && busyId === confirmTarget.row.id)}
        onConfirm={() => {
          if (confirmTarget) void executeAction("reject", confirmTarget.row);
        }}
        details={
          confirmTarget ? (
            <div className="border border-hairline bg-paper p-3 text-xs space-y-1 font-mono">
              <div>
                Project: <span className="font-semibold">{confirmTarget.row.project_slug}</span>
              </div>
              <div>Comment: {(comments[confirmTarget.row.id] ?? "").trim() || "(no comment)"}</div>
            </div>
          ) : null
        }
      />
    </div>
  );
}
