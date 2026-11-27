import { useState } from "react";
import { Link } from "@tanstack/react-router";
import { useMutation } from "@tanstack/react-query";
import { Check, GitCompare, ShieldAlert, XCircle, Zap } from "lucide-react";
import { ConfirmDialog } from "@/components/ConfirmDialog";
import { CopyableHash } from "@/components/CopyableHash";
import { StatusBadge } from "@/components/StatusBadge";
import { TokenDelta } from "@/components/TokenDelta";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { api, ApiError } from "@/lib/api";
import {
  formatRelativeTime,
  formatTimestamp,
  formatTokens,
  shortUuid,
} from "@/lib/format";
import type { RevisionListRow } from "@/lib/types";
import { cn } from "@/lib/utils";
import { ExpandableRevisionFiles } from "./ExpandableRevisionFiles";
import { useReviewQueue } from "./ReviewQueueProvider";

type ReviewAction = "approve" | "activate" | "reject";

export function RevisionRow({ row }: { row: RevisionListRow }) {
  const { state, actions, meta } = useReviewQueue();
  const [comment, setComment] = useState("");
  const [actionError, setActionError] = useState<string | null>(null);
  const [confirmKind, setConfirmKind] = useState<null | "activate" | "reject">(null);

  const reviewMutation = useMutation({
    mutationFn: async (kind: ReviewAction) => {
      const trimmed = comment.trim();
      if (kind === "reject") {
        await api.rejectRevision(row.id, { comment: trimmed });
      } else {
        await api.approveRevision(row.id, {
          comment: trimmed,
          activate_now: kind === "activate",
        });
      }
    },
    onSuccess: async () => {
      setConfirmKind(null);
      setComment("");
      setActionError(null);
      await actions.invalidateAll(row.id);
    },
    onError: (err) => {
      setConfirmKind(null);
      setActionError(
        err instanceof ApiError ? `${err.code}: ${err.message}` : "操作失败，请重试。",
      );
    },
  });

  const isBusy = reviewMutation.isPending;
  const shared = state.sharedRevisionId === row.id;

  return (
    <>
      <li className="p-4 space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="flex flex-wrap items-center gap-2">
            <StatusBadge
              status={row.status}
              stale={row.stale}
              conflictCount={row.conflict_count}
            />
            <span className="font-mono text-xs font-semibold text-ink">{row.project_slug}</span>
            <span
              style={shared ? { viewTransitionName: "revision-identity" } : undefined}
            >
              <CopyableHash value={row.id} />
            </span>
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

        {actionError ? (
          <div
            role="alert"
            className="flex items-center justify-between gap-2 border border-red-300 bg-red-50 px-3 py-2 text-xs text-red-900 font-mono"
          >
            <span>{actionError}</span>
            <Button variant="outline" size="xs" onClick={actions.refetch}>
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
            onPointerEnter={() => {
              actions.setSharedRevisionId(row.id);
              actions.prefetchRevision(row.id);
            }}
            onFocus={() => {
              actions.setSharedRevisionId(row.id);
              actions.prefetchRevision(row.id);
            }}
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

          {meta.canApprove && (row.status === "pending_review" || row.status === "conflict") ? (
            <div className="flex flex-wrap items-center gap-2 flex-1 justify-end min-w-[260px]">
              <Input
                type="text"
                aria-label={`${row.id} 审批备注`}
                value={comment}
                onChange={(e) => setComment(e.target.value)}
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
                    onClick={() => reviewMutation.mutate("approve")}
                  >
                    <Check className="h-3 w-3" aria-hidden="true" />
                    <span>{isBusy ? "处理中…" : "批准"}</span>
                  </Button>
                  <Button
                    size="xs"
                    disabled={isBusy}
                    onClick={() => setConfirmKind("activate")}
                  >
                    <Zap className="h-3 w-3" aria-hidden="true" />
                    <span>批准并激活</span>
                  </Button>
                </>
              ) : null}

              <Button
                variant="destructive"
                size="xs"
                disabled={isBusy}
                onClick={() => setConfirmKind("reject")}
              >
                <XCircle className="h-3 w-3" aria-hidden="true" />
                <span>拒绝</span>
              </Button>
            </div>
          ) : null}
        </div>
      </li>

      <ConfirmDialog
        open={confirmKind === "activate"}
        onOpenChange={(open) => {
          if (!open) setConfirmKind(null);
        }}
        title="批准并立即激活？"
        description="确认后该版本将立即成为项目当前生效版本，所有接入端会立刻读取本次变更。"
        confirmLabel="确认激活"
        pending={isBusy}
        onConfirm={() => reviewMutation.mutate("activate")}
        details={
          <div className="border border-hairline bg-paper p-3 text-xs space-y-1 font-mono">
            <div>
              项目：<span className="font-semibold">{row.project_slug}</span>
            </div>
            <div>版本：{shortUuid(row.id, 12)}</div>
            <TokenDelta added={row.token_added} removed={row.token_removed} />
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
        pending={isBusy}
        onConfirm={() => reviewMutation.mutate("reject")}
        details={
          <div className="border border-hairline bg-paper p-3 text-xs space-y-1 font-mono">
            <div>
              项目：<span className="font-semibold">{row.project_slug}</span>
            </div>
            <div>备注：{comment.trim() || "（无）"}</div>
          </div>
        }
      />
    </>
  );
}
