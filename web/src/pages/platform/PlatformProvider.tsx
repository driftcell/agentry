import { createContext, use, useState, useTransition, type ReactNode } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { api, ApiError } from "@/lib/api";
import { ME_QUERY_KEY, useAuth } from "@/lib/auth-context";
import type { MeResponse, Project } from "@/lib/types";
import type { PlatformTab } from "./types";

interface PlatformState {
  tab: PlatformTab;
  keyProjectSlug: string;
  deleteTarget: Project | null;
  deleteError: string | null;
}

interface PlatformActions {
  setTab: (tab: PlatformTab) => void;
  setKeyProjectSlug: (slug: string) => void;
  openKeysForProject: (slug: string) => void;
  requestDelete: (project: Project) => void;
  cancelDelete: () => void;
  confirmDelete: () => void;
}

interface PlatformMeta {
  projects: Project[];
  selectedProjectSlug: string;
  canApprove: boolean;
  canPlatform: boolean;
  effectiveKeySlug: string;
  isDeleting: boolean;
}

interface PlatformContextValue {
  state: PlatformState;
  actions: PlatformActions;
  meta: PlatformMeta;
}

const PlatformContext = createContext<PlatformContextValue | null>(null);

export function usePlatform() {
  const context = use(PlatformContext);
  if (!context) {
    throw new Error("usePlatform must be used within PlatformProvider");
  }
  return context;
}

export function PlatformProvider({
  initialTab = "projects",
  children,
}: {
  initialTab?: PlatformTab;
  children: ReactNode;
}) {
  const {
    projects,
    selectedProjectSlug,
    setSelectedProjectSlug,
    canApprove,
    canPlatform,
  } = useAuth();
  const queryClient = useQueryClient();
  const [, startTransition] = useTransition();

  const [tab, setTabState] = useState<PlatformTab>(initialTab);
  const [keyProjectSlug, setKeyProjectSlug] = useState(
    selectedProjectSlug || projects[0]?.slug || "",
  );
  const [deleteTarget, setDeleteTarget] = useState<Project | null>(null);
  const [deleteError, setDeleteError] = useState<string | null>(null);

  const effectiveKeySlug = projects.some((project) => project.slug === keyProjectSlug)
    ? keyProjectSlug
    : selectedProjectSlug || projects[0]?.slug || "";

  const deleteMutation = useMutation({
    mutationFn: (slug: string) => api.deleteProject(slug),
    onMutate: async (slug) => {
      await queryClient.cancelQueries({ queryKey: ME_QUERY_KEY });
      const previous = queryClient.getQueryData<MeResponse>(ME_QUERY_KEY);
      queryClient.setQueryData<MeResponse>(ME_QUERY_KEY, (current) =>
        current
          ? {
              ...current,
              projects: current.projects.filter((project) => project.slug !== slug),
            }
          : current,
      );
      setDeleteError(null);
      return { previous };
    },
    onError: (error, _slug, context) => {
      if (context?.previous) {
        queryClient.setQueryData(ME_QUERY_KEY, context.previous);
      }
      setDeleteError(
        error instanceof ApiError ? `${error.code}: ${error.message}` : "删除项目失败。",
      );
    },
    onSuccess: (_result, slug) => {
      setDeleteTarget(null);
      setDeleteError(null);
      if (selectedProjectSlug === slug) {
        setSelectedProjectSlug("");
      }
      queryClient.removeQueries({ queryKey: ["workspace", slug] });
      queryClient.removeQueries({ queryKey: ["project-file", slug] });
      queryClient.removeQueries({ queryKey: ["project-keys", slug] });
      queryClient.removeQueries({ queryKey: ["revision"] });
      queryClient.removeQueries({ queryKey: ["revision-file"] });
      toast.success(`项目 ${slug} 已删除`);
    },
    onSettled: async () => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ME_QUERY_KEY }),
        queryClient.invalidateQueries({ queryKey: ["dashboard"] }),
        queryClient.invalidateQueries({ queryKey: ["review-queue"] }),
      ]);
    },
  });

  const setTab = (nextTab: PlatformTab) => {
    startTransition(async () => {
      if (nextTab === "keys" && canApprove && effectiveKeySlug) {
        await queryClient.prefetchQuery({
          queryKey: ["project-keys", effectiveKeySlug],
          queryFn: () => api.listProjectKeys(effectiveKeySlug),
        });
      }
      if (nextTab === "users" && canPlatform) {
        await queryClient.prefetchQuery({
          queryKey: ["users"],
          queryFn: () => api.listUsers(),
        });
      }
      setTabState(nextTab);
    });
  };

  const openKeysForProject = (slug: string) => {
    setKeyProjectSlug(slug);
    setTab("keys");
  };

  const requestDelete = (project: Project) => {
    setDeleteTarget(project);
    setDeleteError(null);
  };

  const cancelDelete = () => {
    if (deleteMutation.isPending) return;
    setDeleteTarget(null);
    setDeleteError(null);
  };

  const confirmDelete = () => {
    if (deleteTarget) {
      deleteMutation.mutate(deleteTarget.slug);
    }
  };

  return (
    <PlatformContext
      value={{
        state: {
          tab,
          keyProjectSlug,
          deleteTarget,
          deleteError,
        },
        actions: {
          setTab,
          setKeyProjectSlug,
          openKeysForProject,
          requestDelete,
          cancelDelete,
          confirmDelete,
        },
        meta: {
          projects,
          selectedProjectSlug,
          canApprove,
          canPlatform,
          effectiveKeySlug,
          isDeleting: deleteMutation.isPending,
        },
      }}
    >
      {children}
    </PlatformContext>
  );
}
