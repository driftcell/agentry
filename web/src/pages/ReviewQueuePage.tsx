import { CheckCircle2, History, Inbox, RefreshCw } from "lucide-react";
import { FadeTransition } from "@/components/FadeTransition";
import {
  EmptyPanel,
  ErrorPanel,
  ForbiddenPanel,
  LoadingPanel,
} from "@/components/StateViews";
import { Button } from "@/components/ui/button";
import {
  Combobox,
  ComboboxContent,
  ComboboxItem,
  ComboboxList,
  ComboboxTrigger,
  ComboboxValue,
} from "@/components/ui/combobox";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { cn } from "@/lib/utils";
import { ReviewQueueProvider, useReviewQueue } from "./review/ReviewQueueProvider";
import type { QueueFilter } from "./review/ReviewQueueProvider";
import { RevisionRow } from "./review/RevisionRow";

const EMPTY_TITLE: Record<QueueFilter, string> = {
  queue: "没有待处理的修订",
  approved: "没有等待激活的修订",
  history: "暂无历史记录",
};

function ReviewQueueShell() {
  const { state, actions, meta } = useReviewQueue();

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-hairline pb-3">
        <h1 className="text-base font-semibold tracking-tight text-ink">审批队列</h1>

        <div className="flex flex-wrap items-center gap-2">
          <Combobox
            items={meta.scopeOptions}
            value={meta.selectedScope}
            onValueChange={(next) => actions.setScope(next?.value ?? "")}
            itemToStringLabel={(item) => item.label}
            itemToStringValue={(item) => item.value}
            isItemEqualToValue={(item, current) => item.value === current.value}
          >
            <ComboboxTrigger
              id="review-project-filter"
              aria-label="筛选项目"
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
            size="sm"
            onClick={actions.refetch}
            disabled={state.fetching}
          >
            <RefreshCw
              className={cn("h-3.5 w-3.5", state.fetching && "animate-spin")}
              aria-hidden="true"
            />
            <span>刷新</span>
          </Button>
        </div>
      </div>

      {!meta.canApprove ? (
        <ForbiddenPanel
          title="仅管理员可审批"
          description="当前账号为普通成员，可查看变更内容，但不能执行批准、拒绝或解决冲突。"
        />
      ) : null}

      <Tabs value={state.tab} onValueChange={(value) => actions.setTab(value as QueueFilter)}>
        <TabsList>
          <TabsTrigger value="queue">
            <Inbox aria-hidden="true" />
            待处理
          </TabsTrigger>
          <TabsTrigger value="approved">
            <CheckCircle2 aria-hidden="true" />
            已批准
          </TabsTrigger>
          <TabsTrigger value="history">
            <History aria-hidden="true" />
            历史记录
          </TabsTrigger>
        </TabsList>
      </Tabs>

      {state.loading ? (
        <LoadingPanel label="加载中…" />
      ) : state.error ? (
        <ErrorPanel
          title="审批队列加载失败"
          error={state.error}
          onRetry={actions.refetch}
        />
      ) : state.revisions.length === 0 ? (
        <EmptyPanel title={EMPTY_TITLE[state.tab]} />
      ) : (
        <ul className="divide-y divide-hairline border border-hairline bg-surface">
          {state.revisions.map((row) => (
            <FadeTransition key={row.id}>
              <RevisionRow row={row} />
            </FadeTransition>
          ))}
        </ul>
      )}
    </div>
  );
}

export function ReviewQueuePage() {
  return (
    <ReviewQueueProvider>
      <ReviewQueueShell />
    </ReviewQueueProvider>
  );
}
