import { ConfirmDialog } from "@/components/ConfirmDialog";
import { useApiKeys } from "./ApiKeysProvider";

export function RevokeKeyDialog() {
  const { state, actions, meta } = useApiKeys();
  const target = state.revokeTarget;

  return (
    <ConfirmDialog
      open={Boolean(target)}
      onOpenChange={(open) => {
        if (!open) actions.cancelRevoke();
      }}
      title="吊销此密钥？"
      description="吊销后立即失效，使用该密钥的客户端将无法再访问服务。"
      confirmLabel="确认吊销"
      variant="destructive"
      pending={meta.isRevoking}
      onConfirm={actions.confirmRevoke}
      details={
        target ? (
          <div className="border border-hairline bg-paper p-3 text-xs font-mono space-y-1">
            <div>名称：{target.name}</div>
            <div>前缀：ak-{target.key_prefix}-…</div>
          </div>
        ) : null
      }
    />
  );
}
