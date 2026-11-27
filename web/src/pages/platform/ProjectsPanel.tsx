import { useState } from "react";
import { Link } from "@tanstack/react-router";
import { Plus } from "lucide-react";
import { CopyableHash } from "@/components/CopyableHash";
import { EmptyPanel } from "@/components/StateViews";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { useAuth } from "@/lib/auth-context";
import { formatTokens } from "@/lib/format";
import { usePlatform } from "./PlatformProvider";
import { CreateProjectDialog } from "./CreateProjectDialog";

export function ProjectsPanel() {
  const { meta, actions } = usePlatform();
  const { setSelectedProjectSlug } = useAuth();
  const [createOpen, setCreateOpen] = useState(false);

  return (
    <div className="space-y-3">
      {meta.canApprove ? (
        <div className="flex justify-end">
          <Button size="sm" onClick={() => setCreateOpen(true)}>
            <Plus className="h-3.5 w-3.5" aria-hidden="true" />
            <span>新建项目</span>
          </Button>
        </div>
      ) : null}

      {meta.projects.length === 0 ? (
        <EmptyPanel title="暂无项目" />
      ) : (
        <div className="overflow-x-auto border border-hairline bg-surface">
          <table className="w-full text-xs">
            <thead>
              <tr className="border-b border-hairline bg-subtle/60 text-left text-[11px] text-ink-muted">
                <th className="px-3 py-2 font-medium">项目标识</th>
                <th className="px-3 py-2 font-medium">名称</th>
                <th className="px-3 py-2 font-medium">当前版本</th>
                <th className="px-3 py-2 text-right font-medium">Token 预算</th>
                <th className="px-3 py-2 text-right font-medium">操作</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-hairline">
              {meta.projects.map((project) => (
                <tr key={project.id} className="hover:bg-subtle/40">
                  <td className="px-3 py-2.5 font-mono font-semibold text-ink">
                    {project.slug}
                  </td>
                  <td className="px-3 py-2.5">
                    <div className="font-medium text-ink">{project.name}</div>
                    {project.description ? (
                      <div className="text-[11px] text-ink-muted">{project.description}</div>
                    ) : null}
                  </td>
                  <td className="px-3 py-2.5">
                    {project.active_revision_id ? (
                      <div className="flex items-center gap-2">
                        <CopyableHash value={project.active_revision_id} />
                        <Link
                          to="/revisions/$revisionId"
                          params={{ revisionId: project.active_revision_id }}
                          className="text-[11px] text-ink-secondary hover:text-ink underline underline-offset-2"
                        >
                          查看
                        </Link>
                      </div>
                    ) : (
                      <Badge variant="outline" className="border-dashed text-muted-foreground">
                        未激活
                      </Badge>
                    )}
                  </td>
                  <td className="px-3 py-2.5 text-right mono-num text-ink">
                    {formatTokens(project.token_budget)} tok
                  </td>
                  <td className="px-3 py-2.5 text-right">
                    <div className="inline-flex items-center gap-3">
                      <Link
                        to="/explorer"
                        onClick={() => setSelectedProjectSlug(project.slug)}
                        className="text-xs text-ink underline underline-offset-2"
                      >
                        文件
                      </Link>
                      {meta.canApprove ? (
                        <button
                          type="button"
                          onClick={() => actions.openKeysForProject(project.slug)}
                          className="text-xs text-ink underline underline-offset-2 cursor-pointer"
                        >
                          密钥
                        </button>
                      ) : null}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <CreateProjectDialog open={createOpen} onOpenChange={setCreateOpen} />
    </div>
  );
}
