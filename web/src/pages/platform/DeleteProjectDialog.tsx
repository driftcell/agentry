import { ConfirmDialog } from "@/components/ConfirmDialog";
import { usePlatform } from "./PlatformProvider";

export function DeleteProjectDialog() {
  const { state, actions, meta } = usePlatform();
  const target = state.deleteTarget;

  return (
    <ConfirmDialog
      open={Boolean(target)}
      onOpenChange={(open) => {
        if (!open) actions.cancelDelete();
      }}
      title="删除此项目？"
      description="项目会立即从工作台和 MCP 读取中隐藏。版本、成员、内容与审计记录会保留，项目标识仍被占用。"
      confirmLabel="确认删除"
      variant="destructive"
      pending={meta.isDeleting}
      onConfirm={actions.confirmDelete}
      details={
        target ? (
          <div className="space-y-2">
            <div className="space-y-1 border border-hairline bg-paper p-3 text-xs font-mono">
              <div>标识：{target.slug}</div>
              <div>名称：{target.name}</div>
            </div>
            {state.deleteError ? (
              <div className="border border-red-300 bg-red-50 px-3 py-2 font-mono text-xs text-red-900">
                {state.deleteError}
              </div>
            ) : null}
          </div>
        ) : null
      }
    />
  );
}
