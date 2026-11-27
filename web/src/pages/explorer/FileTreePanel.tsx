import { useMemo, useState } from "react";
import { Search } from "lucide-react";
import { WorkspaceFileTree, useExpandedDirs } from "@/components/WorkspaceFileTree";
import { Input } from "@/components/ui/input";
import {
  buildFileTree,
  collectDirectoryPaths,
  type FileKindFilter,
} from "@/lib/workspace";
import { cn } from "@/lib/utils";
import { useWorkspace } from "./WorkspaceProvider";

const KIND_FILTERS: ReadonlyArray<{ id: FileKindFilter; label: string }> = [
  { id: "all", label: "全部" },
  { id: "claude", label: "CLAUDE" },
  { id: "agents", label: "AGENTS" },
  { id: "skills", label: "Skills" },
  { id: "subagents", label: "子智能体" },
  { id: "root", label: "根目录" },
];

export function FileTreePanel() {
  const { state, actions, meta } = useWorkspace();
  const [kindFilter, setKindFilter] = useState<FileKindFilter>("all");
  const [searchQuery, setSearchQuery] = useState("");

  const treeNodes = useMemo(
    () => buildFileTree(meta.files, kindFilter, searchQuery),
    [meta.files, kindFilter, searchQuery],
  );
  const allDirs = useMemo(() => collectDirectoryPaths(treeNodes), [treeNodes]);
  const { expanded, toggle, expandAll, collapseAll } = useExpandedDirs(allDirs);

  return (
    <aside aria-label="文件树" className="lg:col-span-4 xl:col-span-3 flex flex-col">
      <div className="border-b border-hairline p-2.5 space-y-2 bg-subtle/40">
        <div className="relative">
          <Search
            className="pointer-events-none absolute top-2 left-2.5 h-3.5 w-3.5 text-ink-muted"
            aria-hidden="true"
          />
          <Input
            type="search"
            aria-label="搜索文件"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="搜索文件…"
            className="pl-7 h-7 font-mono text-xs"
          />
        </div>

        <div className="flex flex-wrap gap-1" role="group" aria-label="文件分类">
          {KIND_FILTERS.map((filter) => (
            <button
              key={filter.id}
              type="button"
              onClick={() => setKindFilter(filter.id)}
              aria-pressed={kindFilter === filter.id}
              className={cn(
                "rounded-sm px-1.5 py-0.5 font-mono text-[10px] border cursor-pointer transition-colors",
                kindFilter === filter.id
                  ? "border-zinc-950 bg-zinc-950 text-zinc-50"
                  : "border-hairline bg-white text-ink-secondary hover:border-zinc-400",
              )}
            >
              {filter.label}
            </button>
          ))}
        </div>

        <div className="flex items-center justify-between text-[11px] text-ink-muted">
          <span className="mono-num">共 {meta.files.length} 个文件</span>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={expandAll}
              className="hover:text-ink underline underline-offset-2 cursor-pointer"
            >
              展开
            </button>
            <button
              type="button"
              onClick={collapseAll}
              className="hover:text-ink underline underline-offset-2 cursor-pointer"
            >
              折叠
            </button>
          </div>
        </div>
      </div>

      <div className="p-2 overflow-y-auto max-h-[680px]">
        {treeNodes.length === 0 ? (
          <p className="px-2 py-4 text-xs text-ink-muted">没有找到匹配的文件。</p>
        ) : (
          <WorkspaceFileTree
            nodes={treeNodes}
            selectedPath={state.selectedPath}
            onSelectFile={actions.selectFile}
            expandedDirs={expanded}
            onToggleDir={toggle}
          />
        )}
      </div>
    </aside>
  );
}
