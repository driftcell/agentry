import { KeyRound, RefreshCw, ShieldOff } from "lucide-react";
import { EmptyPanel, ErrorPanel, ForbiddenPanel, LoadingPanel } from "@/components/StateViews";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Combobox,
  ComboboxContent,
  ComboboxItem,
  ComboboxList,
  ComboboxTrigger,
  ComboboxValue,
} from "@/components/ui/combobox";
import { formatRelativeTime, formatTimestamp } from "@/lib/format";
import { cn } from "@/lib/utils";
import { ApiKeysProvider, useApiKeys } from "./ApiKeysProvider";
import { IssueKeyDialog } from "./IssueKeyDialog";
import { IssuedKeyDialog } from "./IssuedKeyDialog";
import { RevokeKeyDialog } from "./RevokeKeyDialog";

function ApiKeysContent() {
  const { state, actions, meta } = useApiKeys();

  if (!meta.canApprove) {
    return (
      <ForbiddenPanel
        title="需要管理员权限"
        description="仅管理员可以查看、签发或吊销 API Key。"
      />
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3 border border-hairline bg-surface px-4 py-3">
        <div className="flex flex-wrap items-center gap-2">
          <Combobox
            items={meta.projectOptions}
            value={meta.selectedProject}
            onValueChange={(next) => {
              if (next) actions.setProjectSlug(next.value);
            }}
            itemToStringLabel={(item) => item.label}
            itemToStringValue={(item) => item.value}
            isItemEqualToValue={(item, current) => item.value === current.value}
          >
            <ComboboxTrigger
              id="keys-project-select"
              aria-label="选择项目"
              render={
                <Button
                  variant="outline"
                  size="sm"
                  className="h-7 min-w-[160px] justify-between font-mono"
                />
              }
            >
              <ComboboxValue />
            </ComboboxTrigger>
            <ComboboxContent>
              <ComboboxList>
                {(item) => (
                  <ComboboxItem key={item.value} value={item}>
                    {item.label}
                  </ComboboxItem>
                )}
              </ComboboxList>
            </ComboboxContent>
          </Combobox>
          <Button
            variant="outline"
            size="xs"
            onClick={actions.refetchKeys}
            disabled={state.keysFetching}
          >
            <RefreshCw
              className={cn("h-3 w-3", state.keysFetching && "animate-spin")}
              aria-hidden="true"
            />
            <span>刷新</span>
          </Button>
        </div>

        <Button size="sm" disabled={!meta.effectiveKeySlug} onClick={actions.openIssue}>
          <KeyRound className="h-3.5 w-3.5" aria-hidden="true" />
          <span>新建密钥</span>
        </Button>
      </div>

      {state.keysLoading ? (
        <LoadingPanel label="加载中…" />
      ) : state.keysError ? (
        <ErrorPanel
          title="API Key 加载失败"
          error={state.keysError}
          onRetry={actions.refetchKeys}
        />
      ) : state.keys.length === 0 ? (
        <EmptyPanel title={`项目 ${meta.effectiveKeySlug} 暂无绑定密钥`} />
      ) : (
        <div className="overflow-x-auto border border-hairline bg-surface">
          <table className="w-full text-xs">
            <thead>
              <tr className="border-b border-hairline bg-subtle/60 text-left text-[11px] text-ink-muted">
                <th className="px-3 py-2 font-medium">名称</th>
                <th className="px-3 py-2 font-medium">所属用户</th>
                <th className="px-3 py-2 font-medium">权限</th>
                <th className="px-3 py-2 font-medium">状态</th>
                <th className="px-3 py-2 font-medium">最近使用</th>
                <th className="px-3 py-2 text-right font-medium">操作</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-hairline">
              {state.keys.map((key) => {
                const isExpired =
                  Boolean(key.expires_at) &&
                  new Date(key.expires_at ?? "").getTime() <= state.keysUpdatedAt;
                return (
                  <tr key={key.id} className="hover:bg-subtle/40">
                    <td className="px-3 py-2.5">
                      <div className="font-medium text-ink">{key.name}</div>
                      <code className="mono-num text-[11px] text-ink-muted">
                        ak-{key.key_prefix}-…
                      </code>
                    </td>
                    <td className="px-3 py-2.5 font-mono text-ink">{key.username}</td>
                    <td className="px-3 py-2.5">
                      <div className="flex flex-wrap gap-1">
                        {key.scopes.map((scope) => (
                          <Badge
                            key={scope}
                            variant={scope.startsWith("admin:") ? "outline" : "secondary"}
                          >
                            {scope}
                          </Badge>
                        ))}
                      </div>
                    </td>
                    <td className="px-3 py-2.5">
                      {isExpired ? (
                        <Badge variant="outline" className="border-dashed text-muted-foreground">
                          已过期
                        </Badge>
                      ) : (
                        <Badge
                          variant="outline"
                          className="border-emerald-300 bg-emerald-50 text-emerald-800"
                        >
                          有效
                        </Badge>
                      )}
                    </td>
                    <td
                      title={formatTimestamp(key.last_used_at)}
                      className="px-3 py-2.5 mono-num text-ink-secondary"
                    >
                      {key.last_used_at ? formatRelativeTime(key.last_used_at) : "未使用"}
                    </td>
                    <td className="px-3 py-2.5 text-right">
                      <Button
                        variant="destructive"
                        size="xs"
                        onClick={() => actions.requestRevoke(key)}
                      >
                        <ShieldOff className="h-3 w-3" aria-hidden="true" />
                        <span>吊销</span>
                      </Button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      <IssueKeyDialog />
      <IssuedKeyDialog />
      <RevokeKeyDialog />
    </div>
  );
}

export function ApiKeysPanel() {
  return (
    <ApiKeysProvider>
      <ApiKeysContent />
    </ApiKeysProvider>
  );
}
