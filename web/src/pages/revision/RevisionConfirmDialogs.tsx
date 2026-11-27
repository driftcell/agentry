import { ConfirmDialog } from "@/components/ConfirmDialog";
import { TokenDelta } from "@/components/TokenDelta";
import { shortUuid } from "@/lib/format";
import { useRevision } from "./RevisionProvider";

export function RevisionConfirmDialogs() {
  const { state, actions, meta } = useRevision();
  const { revision, project } = meta;

  if (!revision || !project) return null;

  return (
    <>
      <ConfirmDialog
        open={state.confirmKind === "activate"}
        onOpenChange={(open) => {
          if (!open) actions.cancelConfirm();
        }}
        title="批准并立即激活？"
        description="确认后该版本将立即成为项目当前生效版本，所有接入端会立刻读取本次变更。"
        confirmLabel="确认激活"
        pending={meta.pendingAction === "activate"}
        onConfirm={() => actions.runReviewAction("activate")}
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
        open={state.confirmKind === "reject"}
        onOpenChange={(open) => {
          if (!open) actions.cancelConfirm();
        }}
        title="拒绝此修订？"
        description="拒绝后该修订将归档，无法被激活。"
        confirmLabel="确认拒绝"
        variant="destructive"
        pending={meta.pendingAction === "reject"}
        onConfirm={() => actions.runReviewAction("reject")}
        details={
          <div className="border border-hairline bg-paper p-3 text-xs space-y-1 font-mono">
            <div>
              项目：<span className="font-semibold">{project.slug}</span>
            </div>
            <div>备注：{state.reviewComment.trim() || "（无）"}</div>
          </div>
        }
      />
    </>
  );
}
