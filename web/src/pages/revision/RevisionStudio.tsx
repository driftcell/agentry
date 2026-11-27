import { Columns2, GitCompare, Rows3, ShieldAlert } from "lucide-react";
import { ConflictMerger } from "@/components/ConflictMerger";
import { DiffViewer } from "@/components/DiffViewer";
import { FadeTransition } from "@/components/FadeTransition";
import { EmptyPanel, ErrorPanel, LoadingPanel } from "@/components/StateViews";
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
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { SingleTokenDelta } from "@/components/TokenDelta";
import { cn } from "@/lib/utils";
import { formatTokens } from "@/lib/format";
import type { RevisionFileView } from "@/lib/types";
import { useRevision } from "./RevisionProvider";
import { COMPARE_PAIR_OPTIONS } from "./types";

function ChangeTypeBadge({ type }: { type: RevisionFileView["change_type"] }) {
  switch (type) {
    case "added":
      return (
        <Badge variant="outline" className="border-emerald-300 bg-emerald-50 text-emerald-800">
          新增
        </Badge>
      );
    case "modified":
      return <Badge variant="outline">修改</Badge>;
    case "deleted":
      return <Badge variant="destructive">删除</Badge>;
    case "unchanged":
      return <Badge variant="secondary">未变</Badge>;
  }
}

export function RevisionStudio() {
  const { state, actions, meta } = useRevision();
  const { detail, revision, project, isConflict } = meta;

  if (!detail || !revision || !project) return null;

  return (
    <Tabs value={state.activeTab} onValueChange={(value) => actions.setStudioTab(value as "diff" | "conflict")}>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <TabsList>
          {isConflict ? (
            <TabsTrigger value="conflict">
              <ShieldAlert className="h-3.5 w-3.5" aria-hidden="true" />
              <span>冲突解决 ({detail.conflicts.length})</span>
            </TabsTrigger>
          ) : null}
          <TabsTrigger value="diff">
            <GitCompare className="h-3.5 w-3.5" aria-hidden="true" />
            <span>文件差异 ({detail.files.length})</span>
          </TabsTrigger>
        </TabsList>

        {state.activeTab === "diff" ? (
          <div className="flex flex-wrap items-center gap-2">
            <Combobox
              items={[...COMPARE_PAIR_OPTIONS]}
              value={COMPARE_PAIR_OPTIONS.find((option) => option.value === state.comparePair) ?? null}
              onValueChange={(next) => {
                if (next) actions.setComparePair(next.value);
              }}
              itemToStringLabel={(item) => item.label}
              itemToStringValue={(item) => item.value}
              isItemEqualToValue={(item, current) => item.value === current.value}
            >
              <ComboboxTrigger
                id="diff-compare-pair"
                aria-label="对比版本"
                render={<Button variant="outline" size="sm" className="h-7 justify-between" />}
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

            <div className="inline-flex border border-hairline bg-surface rounded-sm p-0.5">
              <Button
                variant={state.diffMode === "split" ? "default" : "ghost"}
                size="xs"
                onClick={() => actions.setDiffMode("split")}
                aria-pressed={state.diffMode === "split"}
              >
                <Columns2 className="h-3 w-3" aria-hidden="true" />
                <span>分栏</span>
              </Button>
              <Button
                variant={state.diffMode === "unified" ? "default" : "ghost"}
                size="xs"
                onClick={() => actions.setDiffMode("unified")}
                aria-pressed={state.diffMode === "unified"}
              >
                <Rows3 className="h-3 w-3" aria-hidden="true" />
                <span>单栏</span>
              </Button>
            </div>
          </div>
        ) : null}
      </div>

      {isConflict ? (
        <TabsContent value="conflict">
          <ConflictMerger
            revision={revision}
            hasActiveRevision={Boolean(project.active_revision_id)}
            stale={detail.stale}
            conflicts={detail.conflicts}
            canApprove={meta.canApprove}
            onResolved={() => {
              actions.setStudioTab("diff");
              void actions.invalidateAll();
            }}
          />
        </TabsContent>
      ) : null}

      <TabsContent value="diff">
        <div className="grid grid-cols-1 lg:grid-cols-12 border border-hairline bg-surface divide-y lg:divide-y-0 lg:divide-x divide-hairline min-h-[480px]">
          <aside aria-label="文件列表" className="lg:col-span-4 xl:col-span-3 flex flex-col">
            <div className="flex items-center justify-between border-b border-hairline px-3 py-2 bg-subtle/40">
              <span className="text-xs font-medium text-ink-muted">
                文件 ({meta.visibleFiles.length})
              </span>
              {meta.unchangedCount > 0 ? (
                <button
                  type="button"
                  onClick={actions.toggleUnchanged}
                  className="text-[11px] text-ink-secondary hover:text-ink underline underline-offset-2 cursor-pointer"
                >
                  {state.showUnchanged ? "仅看变更" : `显示全部 (+${meta.unchangedCount})`}
                </button>
              ) : null}
            </div>

            <ul className="divide-y divide-hairline overflow-y-auto max-h-[680px]">
              {meta.visibleFiles.map((file) => {
                const isSelected = file.path === state.selectedPath;
                const hasConflict = meta.conflictPathSet.has(file.path);
                return (
                  <li key={file.path}>
                    <button
                      type="button"
                      onClick={() => actions.selectFile(file.path)}
                      aria-current={isSelected ? "true" : undefined}
                      className={cn(
                        "w-full text-left px-3 py-2 text-xs font-mono cursor-pointer transition-colors space-y-1",
                        isSelected
                          ? "bg-zinc-950 text-zinc-50"
                          : "bg-white text-ink hover:bg-subtle/60",
                      )}
                    >
                      <div className="flex items-center justify-between gap-2">
                        <span className="truncate">{file.path}</span>
                        <SingleTokenDelta
                          delta={file.token_delta}
                          className={isSelected ? "text-zinc-200" : undefined}
                        />
                      </div>
                      <div className="flex items-center justify-between gap-2">
                        <div className="flex items-center gap-1.5">
                          <ChangeTypeBadge type={file.change_type} />
                          {hasConflict ? (
                            <Badge
                              variant="outline"
                              className="border-amber-300 bg-amber-50 text-amber-900"
                            >
                              冲突
                            </Badge>
                          ) : null}
                        </div>
                        <span
                          className={cn(
                            "mono-num text-[10px]",
                            isSelected ? "text-zinc-300" : "text-ink-muted",
                          )}
                        >
                          {formatTokens(file.token_count)} tok
                        </span>
                      </div>
                    </button>
                  </li>
                );
              })}
            </ul>
          </aside>

          <section aria-label="文件差异详情" className="lg:col-span-8 xl:col-span-9 min-w-0">
            <FadeTransition key={`${state.selectedPath ?? "none"}-${state.comparePair}`}>
              {!state.selectedPath ? (
                <div className="p-6">
                  <EmptyPanel title="暂无文件" />
                </div>
              ) : meta.sidesLoading ? (
                <LoadingPanel label={`正在加载 ${state.selectedPath}…`} className="border-0" />
              ) : meta.sidesError ? (
                <div className="p-4">
                  <ErrorPanel
                    title={`无法加载 ${state.selectedPath}`}
                    error={meta.sidesError}
                    onRetry={actions.refetchSides}
                  />
                </div>
              ) : (
                <DiffViewer
                  path={state.selectedPath}
                  mode={state.diffMode}
                  leftLabel={meta.pair.leftLabel}
                  rightLabel={meta.pair.rightLabel}
                  leftSide={
                    meta.canFetchSide(meta.pair.left) ? meta.leftData : null
                  }
                  rightSide={
                    meta.canFetchSide(meta.pair.right) ? meta.rightData : null
                  }
                />
              )}
            </FadeTransition>
          </section>
        </div>
      </TabsContent>
    </Tabs>
  );
}
