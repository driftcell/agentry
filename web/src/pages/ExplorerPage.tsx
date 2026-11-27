import { Link } from "@tanstack/react-router";
import { ExternalLink } from "lucide-react";
import { EmptyPanel, ErrorPanel, LoadingPanel } from "@/components/StateViews";
import { Button } from "@/components/ui/button";
import {
  Combobox,
  ComboboxContent,
  ComboboxItem,
  ComboboxList,
  ComboboxTrigger,
  ComboboxValue,
} from "@/components/ui/combobox";
import { firstLine, formatTokens, shortUuid } from "@/lib/format";
import { FileContentPanel } from "./explorer/FileContentPanel";
import { FileTreePanel } from "./explorer/FileTreePanel";
import { useWorkspace, WorkspaceProvider } from "./explorer/WorkspaceProvider";

function ExplorerShell() {
  const { actions, meta } = useWorkspace();

  if (!meta.activeSlug) {
    return <EmptyPanel title="暂无可用项目" description="请联系管理员创建项目或分配访问权限。" />;
  }

  const activeRevision = meta.activeRevision;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-hairline pb-3">
        <div className="flex flex-wrap items-center gap-3">
          <h1 className="text-base font-semibold tracking-tight text-ink">工作区</h1>
          {activeRevision ? (
            <span className="text-xs text-ink-secondary truncate max-w-xl">
              {firstLine(activeRevision.commit_message)}
            </span>
          ) : null}
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <Combobox
            items={meta.projectOptions}
            value={meta.activeProjectOption}
            onValueChange={(next) => {
              if (next) actions.changeProject(next.value);
            }}
            itemToStringLabel={(item) => item.label}
            itemToStringValue={(item) => item.value}
            isItemEqualToValue={(item, current) => item.value === current.value}
          >
            <ComboboxTrigger
              id="explorer-project"
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

          {activeRevision ? (
            <Link
              to="/revisions/$revisionId"
              params={{ revisionId: activeRevision.id }}
              className="inline-flex items-center gap-1.5 rounded-sm border border-zinc-300 bg-white px-2.5 py-1 text-xs font-mono text-ink hover:bg-subtle no-underline"
              title="查看当前生效版本详情"
              onPointerEnter={() => actions.prefetchRevision(activeRevision.id)}
              onFocus={() => actions.prefetchRevision(activeRevision.id)}
            >
              <span style={{ viewTransitionName: "revision-identity" }}>
                当前版本 {activeRevision.short_code || shortUuid(activeRevision.id)}
              </span>
              <span className="text-ink-muted">·</span>
              <span className="mono-num">
                {formatTokens(meta.tokens)} / {formatTokens(meta.project?.token_budget)} tok
              </span>
              <ExternalLink className="h-3 w-3 text-ink-muted" aria-hidden="true" />
            </Link>
          ) : null}
        </div>
      </div>

      {meta.workspaceLoading ? (
        <LoadingPanel label="正在加载文件…" />
      ) : meta.workspaceError ? (
        <ErrorPanel
          title="工作区加载失败"
          error={meta.workspaceError}
          onRetry={actions.refetchWorkspace}
        />
      ) : (
        <>
          {!activeRevision ? (
            <EmptyPanel
              title="该项目尚未激活任何版本"
              description="前往审批队列批准并激活修订后，文件将显示在这里。"
            />
          ) : null}

          {meta.files.length > 0 ? (
            <div className="grid grid-cols-1 lg:grid-cols-12 border border-hairline bg-surface divide-y lg:divide-y-0 lg:divide-x divide-hairline min-h-[560px]">
              <FileTreePanel />
              <FileContentPanel />
            </div>
          ) : null}
        </>
      )}
    </div>
  );
}

export function ExplorerPage({
  projectSlugOverride,
  initialPath,
  onProjectChange,
}: {
  projectSlugOverride?: string;
  initialPath?: string;
  onProjectChange?: (slug: string) => void;
}) {
  return (
    <WorkspaceProvider
      projectSlugOverride={projectSlugOverride}
      initialPath={initialPath}
      onProjectChange={onProjectChange}
    >
      <ExplorerShell />
    </WorkspaceProvider>
  );
}
