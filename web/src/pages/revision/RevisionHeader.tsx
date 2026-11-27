import { Link } from "@tanstack/react-router";
import { AlertTriangle, ArrowLeft, RefreshCw } from "lucide-react";
import { CopyableHash } from "@/components/CopyableHash";
import { StatusBadge } from "@/components/StatusBadge";
import { TokenDelta } from "@/components/TokenDelta";
import { Button } from "@/components/ui/button";
import { formatTokens } from "@/lib/format";
import { cn } from "@/lib/utils";
import { useRevision } from "./RevisionProvider";

export function RevisionHeader() {
  const { actions, meta } = useRevision();
  const { detail, revision, project } = meta;

  if (!detail || !revision || !project) return null;

  return (
    <>
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
            onClick={actions.refreshDetail}
            disabled={meta.detailFetching}
          >
            <RefreshCw
              className={cn("h-3 w-3", meta.detailFetching && "animate-spin")}
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
          <Button variant="outline" size="xs" onClick={actions.refreshDetail}>
            刷新
          </Button>
        </div>
      ) : null}
    </>
  );
}
