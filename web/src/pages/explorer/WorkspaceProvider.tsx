import {
  createContext,
  use,
  useMemo,
  useState,
  useTransition,
  type ReactNode,
} from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "@/lib/api";
import { useAuth } from "@/lib/auth-context";
import type { Project, Revision, WorkspaceFileView } from "@/lib/types";

type Option = { value: string; label: string };

interface WorkspaceState {
  selectedPath: string | null;
}

interface WorkspaceActions {
  selectFile: (path: string) => void;
  changeProject: (slug: string) => void;
  prefetchRevision: (revisionId: string) => void;
  refetchWorkspace: () => void;
}

interface WorkspaceMeta {
  activeSlug: string;
  projects: Project[];
  projectOptions: Option[];
  activeProjectOption: Option | null;
  files: WorkspaceFileView[];
  activeRevision: Revision | null;
  project: Project | null;
  tokens: number;
  workspaceLoading: boolean;
  workspaceError: unknown;
}

interface WorkspaceContextValue {
  state: WorkspaceState;
  actions: WorkspaceActions;
  meta: WorkspaceMeta;
}

const WorkspaceContext = createContext<WorkspaceContextValue | null>(null);

export function useWorkspace() {
  const context = use(WorkspaceContext);
  if (!context) {
    throw new Error("useWorkspace must be used within WorkspaceProvider");
  }
  return context;
}

async function fetchWorkspace(slug: string) {
  const [workspace, detail] = await Promise.all([api.workspace(slug), api.projectDetail(slug)]);
  return { workspace, detail };
}

export function WorkspaceProvider({
  projectSlugOverride,
  initialPath,
  onProjectChange,
  children,
}: {
  projectSlugOverride?: string;
  initialPath?: string;
  onProjectChange?: (slug: string) => void;
  children: ReactNode;
}) {
  const { projects, selectedProjectSlug, setSelectedProjectSlug } = useAuth();
  const queryClient = useQueryClient();
  const [, startTransition] = useTransition();

  const activeSlug = projectSlugOverride || selectedProjectSlug;
  const projectOptions = useMemo(
    () => projects.map((project) => ({ value: project.slug, label: project.slug })),
    [projects],
  );
  const activeProjectOption =
    projectOptions.find((option) => option.value === activeSlug) ?? null;

  const [manualSelectedPath, setManualSelectedPath] = useState<string | null>(initialPath ?? null);

  const workspaceQuery = useQuery({
    queryKey: ["workspace", activeSlug],
    queryFn: () => fetchWorkspace(activeSlug),
    enabled: Boolean(activeSlug),
  });

  const files = useMemo(
    () => workspaceQuery.data?.workspace.files ?? [],
    [workspaceQuery.data?.workspace.files],
  );

  const selectedPath = useMemo(() => {
    if (files.length === 0) return null;
    if (manualSelectedPath && files.some((file) => file.path === manualSelectedPath)) {
      return manualSelectedPath;
    }
    const claude = files.find((file) => file.path === "CLAUDE.md");
    return claude?.path ?? files[0]?.path ?? null;
  }, [files, manualSelectedPath]);

  const actions: WorkspaceActions = {
    selectFile: (path) => {
      if (!activeSlug) return;
      startTransition(async () => {
        await queryClient.prefetchQuery({
          queryKey: ["project-file", activeSlug, path],
          queryFn: () => api.projectFile(activeSlug, path),
        });
        setManualSelectedPath(path);
      });
    },
    changeProject: (slug) => {
      void queryClient
        .prefetchQuery({
          queryKey: ["workspace", slug],
          queryFn: () => fetchWorkspace(slug),
        })
        .finally(() => {
          setSelectedProjectSlug(slug);
          onProjectChange?.(slug);
          setManualSelectedPath(null);
        });
    },
    prefetchRevision: (revisionId) => {
      void queryClient.prefetchQuery({
        queryKey: ["revision", revisionId],
        queryFn: () => api.revisionDetail(revisionId),
      });
    },
    refetchWorkspace: () => void workspaceQuery.refetch(),
  };

  return (
    <WorkspaceContext
      value={{
        state: { selectedPath },
        actions,
        meta: {
          activeSlug,
          projects,
          projectOptions,
          activeProjectOption,
          files,
          activeRevision: workspaceQuery.data?.detail.active_revision ?? null,
          project: workspaceQuery.data?.workspace.project ?? null,
          tokens: workspaceQuery.data?.workspace.tokens ?? 0,
          workspaceLoading: workspaceQuery.isLoading,
          workspaceError: workspaceQuery.error,
        },
      }}
    >
      {children}
    </WorkspaceContext>
  );
}
