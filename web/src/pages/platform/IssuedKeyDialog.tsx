import { CopyButton } from "@/components/CopyButton";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { useApiKeys } from "./ApiKeysProvider";

export function IssuedKeyDialog() {
  const { state, actions } = useApiKeys();
  const secret = state.issuedSecret;

  return (
    <Dialog open={Boolean(secret)} onOpenChange={(open) => (open ? undefined : actions.closeIssued())}>
      <DialogContent className="grid-cols-1 sm:max-w-xl">
        <DialogHeader>
          <DialogTitle>请立即复制保存密钥</DialogTitle>
          <DialogDescription>此明文密钥仅展示这一次，关闭后无法再次查看。</DialogDescription>
        </DialogHeader>

        {secret ? (
          <div className="mt-3">
            <div className="space-y-2 rounded-lg border border-border bg-muted/40 p-3">
              <div className="flex items-center justify-between gap-2 text-[11px] text-muted-foreground">
                <span className="truncate font-mono">{secret.name}</span>
                <span className="shrink-0 font-mono">
                  {secret.is_global ? "全局" : secret.project}
                </span>
              </div>
              <div className="flex items-center gap-2">
                <code className="min-w-0 flex-1 overflow-x-auto whitespace-nowrap rounded-md border border-border bg-background px-2.5 py-2 font-mono text-xs leading-relaxed text-foreground select-all">
                  {secret.api_key}
                </code>
                <CopyButton
                  value={secret.api_key}
                  label="复制密钥"
                  variant="outline"
                  size="icon-sm"
                  className="shrink-0"
                />
              </div>
            </div>
          </div>
        ) : null}

        <DialogFooter>
          <Button size="sm" onClick={actions.closeIssued}>
            我已保存
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
