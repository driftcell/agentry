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
import type { RevisionListRow, RevisionStatus } from "@/lib/types";

export type QueueFilter = "queue" | "approved" | "history";

export const STATUS_MAP: Record<QueueFilter, RevisionStatus[]> = {
  queue: ["pending_review", "conflict"],
  approved: ["approved"],
  history: ["active", "rejected", "superseded"],
};

type Option = { value: string; label: string };

interface ReviewQueueState {
  tab: QueueFilter;
  scopeSlug: string;
  sharedRevisionId: string | null;
  revisions: RevisionListRow[];
  loading: boolean;
  error: unknown;
  fetching: boolean;
}

interface ReviewQueueActions {
  setTab: (tab: QueueFilter) => void;
  setScope: (slug: string) => void;
  setSharedRevisionId: (id: string | null) => void;
  refetch: () => void;
  prefetchRevision: (id: string) => void;
  invalidateAll: (revisionId: string) => Promise<void>;
}

interface ReviewQueueMeta {
  projects: ReturnType<typeof useAuth>["projects"];
  canApprove: boolean;
  scopeOptions: Option[];
  selectedScope: Option | null;
}

interface ReviewQueueContextValue {
  state: ReviewQueueState;
  actions: ReviewQueueActions;
  meta: ReviewQueueMeta;
}

const ReviewQueueContext = createContext<ReviewQueueContextValue | null>(null);

export function useReviewQueue() {
  const context = use(ReviewQueueContext);
  if (!context) {
    throw new Error("useReviewQueue must be used within ReviewQueueProvider");
  }
  return context;
}

export function ReviewQueueProvider({ children }: { children: ReactNode }) {
  const { projects, canApprove } = useAuth();
  const queryClient = useQueryClient();
  const [, startTransition] = useTransition();

  const [tab, setTabState] = useState<QueueFilter>("queue");
  const [scopeSlug, setScopeSlugState] = useState("");
  const [sharedRevisionId, setSharedRevisionId] = useState<string | null>(null);

  const loadRevisions = async (slug: string, statuses: RevisionStatus[]) => {
    const targets = slug ? projects.filter((project) => project.slug === slug) : projects;
    if (targets.length === 0) return [] as RevisionListRow[];
    const responses = await Promise.all(
      targets.map((project) => api.projectRevisions(project.slug, statuses)),
    );
    const merged = responses.flatMap((response) => response.revisions);
    merged.sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime());
    return merged;
  };

  const queueQueryKey = (slug: string, nextTab: QueueFilter) => {
    const targets = slug ? projects.filter((project) => project.slug === slug) : projects;
    return [
      "review-queue",
      slug || "__all__",
      nextTab,
      targets.map((project) => project.slug).join(","),
    ] as const;
  };

  const revisionsQuery = useQuery({
    queryKey: queueQueryKey(scopeSlug, tab),
    queryFn: () => loadRevisions(scopeSlug, STATUS_MAP[tab]),
    enabled: projects.length > 0,
  });

  const actions: ReviewQueueActions = {
    setTab: (nextTab) => {
      startTransition(async () => {
        await queryClient.prefetchQuery({
          queryKey: queueQueryKey(scopeSlug, nextTab),
          queryFn: () => loadRevisions(scopeSlug, STATUS_MAP[nextTab]),
        });
        setTabState(nextTab);
      });
    },
    setScope: (nextSlug) => {
      startTransition(async () => {
        await queryClient.prefetchQuery({
          queryKey: queueQueryKey(nextSlug, tab),
          queryFn: () => loadRevisions(nextSlug, STATUS_MAP[tab]),
        });
        setScopeSlugState(nextSlug);
      });
    },
    setSharedRevisionId,
    refetch: () => void revisionsQuery.refetch(),
    prefetchRevision: (revisionId) => {
      void queryClient.prefetchQuery({
        queryKey: ["revision", revisionId],
        queryFn: () => api.revisionDetail(revisionId),
      });
    },
    invalidateAll: async (revisionId) => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["review-queue"] }),
        queryClient.invalidateQueries({ queryKey: ["revision", revisionId] }),
        queryClient.invalidateQueries({ queryKey: ["dashboard"] }),
        queryClient.invalidateQueries({ queryKey: ["workspace"] }),
        queryClient.invalidateQueries({ queryKey: ["auth", "me"] }),
      ]);
    },
  };

  const scopeOptions = useMemo(
    () => [
      { value: "", label: `全部项目 (${projects.length})` },
      ...projects.map((project) => ({ value: project.slug, label: project.slug })),
    ],
    [projects],
  );

  return (
    <ReviewQueueContext
      value={{
        state: {
          tab,
          scopeSlug,
          sharedRevisionId,
          revisions: revisionsQuery.data ?? [],
          loading: revisionsQuery.isLoading,
          error: revisionsQuery.error,
          fetching: revisionsQuery.isFetching,
        },
        actions,
        meta: {
          projects,
          canApprove,
          scopeOptions,
          selectedScope:
            scopeOptions.find((option) => option.value === scopeSlug) ?? null,
        },
      }}
    >
      {children}
    </ReviewQueueContext>
  );
}
