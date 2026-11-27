import { useMemo, useState, useTransition } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { ChevronRight } from "lucide-react";
import { FadeTransition } from "@/components/FadeTransition";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import { api } from "@/lib/api";
import { formatTokens } from "@/lib/format";
import { SingleTokenDelta } from "@/components/TokenDelta";

export function ExpandableRevisionFiles({ revisionId }: { revisionId: string }) {
  const queryClient = useQueryClient();
  const [, startTransition] = useTransition();
  const [open, setOpen] = useState(false);

  const detailQuery = useQuery({
    queryKey: ["revision", revisionId],
    queryFn: () => api.revisionDetail(revisionId),
    enabled: open,
  });

  const changedFiles = useMemo(
    () => (detailQuery.data?.files ?? []).filter((file) => file.change_type !== "unchanged"),
    [detailQuery.data?.files],
  );

  return (
    <Collapsible
      open={open}
      onOpenChange={(next) => {
        startTransition(async () => {
          if (next) {
            await queryClient.prefetchQuery({
              queryKey: ["revision", revisionId],
              queryFn: () => api.revisionDetail(revisionId),
            });
          }
          setOpen(next);
        });
      }}
    >
      <CollapsibleTrigger
        render={
          <Button variant="ghost" size="xs" className="group px-1.5 text-xs text-ink-secondary" />
        }
      >
        <ChevronRight
          className="h-3 w-3 transition-transform group-data-panel-open:rotate-90"
          aria-hidden="true"
        />
        <span>{open ? "收起变更文件" : "查看变更文件"}</span>
      </CollapsibleTrigger>

      <CollapsibleContent className="mt-2 border border-hairline bg-paper">
        <FadeTransition>
          {detailQuery.isLoading ? (
            <div className="px-3 py-2 text-xs text-ink-muted">加载中…</div>
          ) : detailQuery.error ? (
            <div className="px-3 py-2 text-xs text-red-700">加载失败</div>
          ) : changedFiles.length === 0 ? (
            <div className="px-3 py-2 text-xs text-ink-muted">与当前生效版本无内容差异</div>
          ) : (
            <ul className="divide-y divide-hairline">
              {changedFiles.map((file) => (
                <li
                  key={file.path}
                  className="flex items-center justify-between gap-3 px-3 py-1.5 text-xs font-mono"
                >
                  <div className="flex items-center gap-2 min-w-0">
                    <Badge variant="secondary" className="text-[10px]">
                      {file.change_type === "added"
                        ? "新增"
                        : file.change_type === "modified"
                          ? "修改"
                          : "删除"}
                    </Badge>
                    <span className="truncate text-ink">{file.path}</span>
                  </div>
                  <div className="flex items-center gap-3 shrink-0">
                    <SingleTokenDelta delta={file.token_delta} />
                    <span className="mono-num text-[11px] text-ink-muted">
                      {formatTokens(file.token_count)} tok
                    </span>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </FadeTransition>
      </CollapsibleContent>
    </Collapsible>
  );
}
