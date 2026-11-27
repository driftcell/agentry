import { Link } from "@tanstack/react-router";
import { Check, XCircle, Zap } from "lucide-react";
import { ForbiddenPanel } from "@/components/StateViews";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { formatTimestamp, shortUuid } from "@/lib/format";
import { useRevision } from "./RevisionProvider";

export function RevisionSummary() {
  const { state, actions, meta } = useRevision();
  const { detail, revision } = meta;

  if (!detail || !revision) return null;

  const canReview =
    revision.status === "pending_review" || revision.status === "conflict";

  return (
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

      {canReview ? (
        <div className="border-t border-hairline pt-3 space-y-2.5">
          {state.actionError ? (
            <div
              role="alert"
              className="border border-red-300 bg-red-50 px-3 py-2 text-xs text-red-900 font-mono"
            >
              {state.actionError}
            </div>
          ) : null}

          {meta.canApprove ? (
            <div className="flex flex-wrap items-center gap-2">
              <Input
                type="text"
                aria-label="审批备注"
                value={state.reviewComment}
                onChange={(e) => actions.setReviewComment(e.target.value)}
                placeholder="审批备注（可选）"
                disabled={meta.pendingAction !== null}
                className="flex-1 min-w-[220px]"
              />
              {revision.status === "pending_review" ? (
                <>
                  <Button
                    variant="outline"
                    size="sm"
                    disabled={meta.pendingAction !== null}
                    onClick={() => actions.runReviewAction("approve")}
                  >
                    <Check className="h-3.5 w-3.5" aria-hidden="true" />
                    <span>{meta.pendingAction === "approve" ? "处理中…" : "批准"}</span>
                  </Button>
                  <Button
                    size="sm"
                    disabled={meta.pendingAction !== null}
                    onClick={() => actions.requestConfirm("activate")}
                  >
                    <Zap className="h-3.5 w-3.5" aria-hidden="true" />
                    <span>批准并激活</span>
                  </Button>
                </>
              ) : null}
              <Button
                variant="destructive"
                size="sm"
                disabled={meta.pendingAction !== null}
                onClick={() => actions.requestConfirm("reject")}
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
  );
}
