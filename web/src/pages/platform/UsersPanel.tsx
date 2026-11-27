import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { UserPlus } from "lucide-react";
import { ErrorPanel, ForbiddenPanel, LoadingPanel } from "@/components/StateViews";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { api } from "@/lib/api";
import { formatRelativeTime, formatTimestamp, formatTokens } from "@/lib/format";
import { CreateUserDialog } from "./CreateUserDialog";
import { usePlatform } from "./PlatformProvider";
import { roleLabel } from "./types";

export function UsersPanel() {
  const { meta } = usePlatform();
  const [createOpen, setCreateOpen] = useState(false);

  const usersQuery = useQuery({
    queryKey: ["users"],
    queryFn: () => api.listUsers(),
    enabled: meta.canPlatform,
  });

  if (!meta.canPlatform) {
    return (
      <ForbiddenPanel
        title="需要超级管理员权限"
        description="仅超级管理员可以查看或创建用户。"
      />
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex justify-end">
        <Button size="sm" onClick={() => setCreateOpen(true)}>
          <UserPlus className="h-3.5 w-3.5" aria-hidden="true" />
          <span>新建用户</span>
        </Button>
      </div>

      {usersQuery.isLoading ? (
        <LoadingPanel label="加载中…" />
      ) : usersQuery.error ? (
        <ErrorPanel
          title="用户加载失败"
          error={usersQuery.error}
          onRetry={() => void usersQuery.refetch()}
        />
      ) : (
        <div className="overflow-x-auto border border-hairline bg-surface">
          <table className="w-full text-xs">
            <thead>
              <tr className="border-b border-hairline bg-subtle/60 text-left text-[11px] text-ink-muted">
                <th className="px-3 py-2 font-medium">用户名</th>
                <th className="px-3 py-2 font-medium">显示名称</th>
                <th className="px-3 py-2 font-medium">角色</th>
                <th className="px-3 py-2 text-right font-medium">密钥数</th>
                <th className="px-3 py-2 text-right font-medium">创建时间</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-hairline">
              {(usersQuery.data?.users ?? []).map((user) => (
                <tr key={user.id} className="hover:bg-subtle/40">
                  <td className="px-3 py-2.5 font-mono font-semibold text-ink">
                    {user.username}
                  </td>
                  <td className="px-3 py-2.5 text-ink-secondary">
                    {user.display_name || "—"}
                  </td>
                  <td className="px-3 py-2.5">
                    <Badge
                      variant={
                        user.role === "superadmin"
                          ? "default"
                          : user.role === "admin"
                            ? "outline"
                            : "secondary"
                      }
                    >
                      {roleLabel(user.role)}
                    </Badge>
                  </td>
                  <td className="px-3 py-2.5 text-right mono-num text-ink">
                    {formatTokens(user.key_count)}
                  </td>
                  <td
                    title={formatTimestamp(user.created_at)}
                    className="px-3 py-2.5 text-right mono-num text-ink-muted"
                  >
                    {formatRelativeTime(user.created_at)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <CreateUserDialog open={createOpen} onOpenChange={setCreateOpen} />
    </div>
  );
}
