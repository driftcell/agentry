import { useState } from "react";
import {
  Bot,
  ChevronRight,
  FileCode2,
  FileText,
  Folder,
  FolderOpen,
  Image as ImageIcon,
  Sparkles,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { formatTokens } from "@/lib/format";
import { cn } from "@/lib/utils";
import type {
  DirectoryTreeNode,
  FileTreeNode,
  WorkspaceFileKind,
  WorkspaceTreeNode,
} from "@/lib/workspace";

interface WorkspaceFileTreeProps {
  nodes: WorkspaceTreeNode[];
  selectedPath: string | null;
  onSelectFile: (path: string) => void;
  expandedDirs: Set<string>;
  onToggleDir: (path: string, open: boolean) => void;
}

function FileKindIcon({ kind }: { kind: WorkspaceFileKind }) {
  switch (kind) {
    case "claude":
    case "agents":
      return <FileCode2 className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />;
    case "skill":
      return <Sparkles className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />;
    case "subagent":
      return <Bot className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />;
    case "asset":
      return <ImageIcon className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />;
    default:
      return <FileText className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />;
  }
}

function DirectoryItem({
  node,
  depth,
  selectedPath,
  onSelectFile,
  expandedDirs,
  onToggleDir,
}: {
  node: DirectoryTreeNode;
  depth: number;
  selectedPath: string | null;
  onSelectFile: (path: string) => void;
  expandedDirs: Set<string>;
  onToggleDir: (path: string, open: boolean) => void;
}) {
  const isOpen = expandedDirs.has(node.path);

  return (
    <Collapsible open={isOpen} onOpenChange={(open) => onToggleDir(node.path, open)}>
      <CollapsibleTrigger
        render={
          <Button
            variant="ghost"
            size="xs"
            className="group w-full justify-between px-1.5 font-mono text-xs text-ink hover:bg-subtle"
            style={{ paddingLeft: `${depth * 12 + 6}px` }}
          />
        }
      >
        <span className="flex items-center gap-1.5 min-w-0">
          <ChevronRight
            className="h-3 w-3 shrink-0 text-ink-muted transition-transform group-data-panel-open:rotate-90"
            aria-hidden="true"
          />
          {isOpen ? (
            <FolderOpen className="h-3.5 w-3.5 shrink-0 text-ink-secondary" aria-hidden="true" />
          ) : (
            <Folder className="h-3.5 w-3.5 shrink-0 text-ink-secondary" aria-hidden="true" />
          )}
          <span className="truncate font-medium">{node.name}/</span>
        </span>
        <span className="mono-num shrink-0 text-[10px] text-ink-muted">
          {formatTokens(node.tokens)} tok
        </span>
      </CollapsibleTrigger>

      <CollapsibleContent>
        <div className="flex flex-col">
          {node.children.map((child) =>
            child.type === "dir" ? (
              <DirectoryItem
                key={child.path}
                node={child}
                depth={depth + 1}
                selectedPath={selectedPath}
                onSelectFile={onSelectFile}
                expandedDirs={expandedDirs}
                onToggleDir={onToggleDir}
              />
            ) : (
              <FileItem
                key={child.path}
                node={child}
                depth={depth + 1}
                selected={selectedPath === child.path}
                onSelect={() => onSelectFile(child.path)}
              />
            ),
          )}
        </div>
      </CollapsibleContent>
    </Collapsible>
  );
}

function FileItem({
  node,
  depth,
  selected,
  onSelect,
}: {
  node: FileTreeNode;
  depth: number;
  selected: boolean;
  onSelect: () => void;
}) {
  const { classification, file } = node;
  return (
    <Button
      variant={selected ? "default" : "ghost"}
      size="xs"
      onClick={onSelect}
      aria-current={selected ? "true" : undefined}
      title={file.description ? `${node.path} — ${file.description}` : node.path}
      className={cn(
        "w-full justify-between gap-2 px-1.5 font-mono text-xs h-auto py-1",
        selected ? "bg-zinc-950 text-zinc-50 hover:bg-zinc-900" : "text-ink",
      )}
      style={{ paddingLeft: `${depth * 12 + 22}px` }}
    >
      <span className="flex items-center gap-1.5 min-w-0">
        <FileKindIcon kind={classification.kind} />
        <span className="truncate">{node.name}</span>
        {classification.badgeLabel ? (
          <Badge
            variant={selected ? "outline" : "muted"}
            className={cn(
              "px-1 py-0 text-[9px]",
              selected ? "border-zinc-500 bg-zinc-800 text-zinc-100" : "",
            )}
          >
            {classification.badgeLabel}
          </Badge>
        ) : null}
      </span>

      <span
        className={cn(
          "mono-num shrink-0 text-[10px]",
          selected ? "text-zinc-300" : "text-ink-muted",
        )}
      >
        {file.is_text ? `${formatTokens(file.tokens)}` : "bin"}
      </span>
    </Button>
  );
}

export function WorkspaceFileTree({
  nodes,
  selectedPath,
  onSelectFile,
  expandedDirs,
  onToggleDir,
}: WorkspaceFileTreeProps) {
  return (
    <div role="tree" aria-label="工作区文件树" className="flex flex-col gap-0.5">
      {nodes.map((node) =>
        node.type === "dir" ? (
          <DirectoryItem
            key={node.path}
            node={node}
            depth={0}
            selectedPath={selectedPath}
            onSelectFile={onSelectFile}
            expandedDirs={expandedDirs}
            onToggleDir={onToggleDir}
          />
        ) : (
          <FileItem
            key={node.path}
            node={node}
            depth={0}
            selected={selectedPath === node.path}
            onSelect={() => onSelectFile(node.path)}
          />
        ),
      )}
    </div>
  );
}

export function useExpandedDirs(allDirs: string[]) {
  const [expanded, setExpanded] = useState<Set<string>>(() => new Set(allDirs));
  const [prevKey, setPrevKey] = useState<string>(() => allDirs.join("|"));

  const key = allDirs.join("|");
  if (key !== prevKey) {
    setPrevKey(key);
    setExpanded(new Set(allDirs));
  }

  const toggle = (path: string, open: boolean) => {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (open) next.add(path);
      else next.delete(path);
      return next;
    });
  };

  const expandAll = () => setExpanded(new Set(allDirs));
  const collapseAll = () => setExpanded(new Set());

  return { expanded, toggle, expandAll, collapseAll };
}
