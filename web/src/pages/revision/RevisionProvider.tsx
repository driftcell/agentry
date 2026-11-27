import {
  createContext,
  use,
  useMemo,
  useState,
  useTransition,
  type ReactNode,
} from "react";
import { useQueries, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import type { DiffViewMode } from "@/components/DiffViewer";
import { api, ApiError } from "@/lib/api";
import { useAuth } from "@/lib/auth-context";
import type {
  FileSideName,
  FileSideResponse,
  Project,
  Revision,
  RevisionDetailResponse,
  RevisionFileView,
} from "@/lib/types";
import { comparePairSides, type ComparePair, type ReviewAction } from "./types";

interface RevisionState {
  diffMode: DiffViewMode;
  comparePair: ComparePair;
  showUnchanged: boolean;
  selectedPath: string | null;
  activeTab: "diff" | "conflict";
  reviewComment: string;
  actionError: string | null;
  confirmKind: null | "activate" | "reject";
}

interface RevisionActions {
  setDiffMode: (mode: DiffViewMode) => void;
  setComparePair: (pair: ComparePair) => void;
  toggleUnchanged: () => void;
  selectFile: (path: string) => void;
  setStudioTab: (tab: "diff" | "conflict") => void;
  setReviewComment: (value: string) => void;
  requestConfirm: (kind: "activate" | "reject") => void;
  cancelConfirm: () => void;
  runReviewAction: (kind: ReviewAction) => void;
  rebase: () => void;
  invalidateAll: () => Promise<void>;
  refreshDetail: () => void;
  refetchSides: () => void;
}

interface RevisionMeta {
  canApprove: boolean;
  detail: RevisionDetailResponse | null;
  revision: Revision | null;
  project: Project | null;
  isConflict: boolean;
  visibleFiles: RevisionFileView[];
  unchangedCount: number;
  conflictPathSet: Set<string>;
  pair: ReturnType<typeof comparePairSides>;
  canFetchSide: (side: FileSideName, path?: string | null) => boolean;
  leftData: FileSideResponse | null;
  rightData: FileSideResponse | null;
  sidesLoading: boolean;
  sidesError: unknown;
  detailLoading: boolean;
  detailError: unknown;
  detailFetching: boolean;
  pendingAction: ReviewAction | null;
  canRebase: boolean;
  rebasing: boolean;
}

interface RevisionContextValue {
  state: RevisionState;
  actions: RevisionActions;
  meta: RevisionMeta;
}

const RevisionContext = createContext<RevisionContextValue | null>(null);

export function useRevision() {
  const context = use(RevisionContext);
  if (!context) {
    throw new Error("useRevision must be used within RevisionProvider");
  }
  return context;
}

export function RevisionProvider({
  revisionId,
  children,
}: {
  revisionId: string;
  children: ReactNode;
}) {
  const { canApprove } = useAuth();
  const queryClient = useQueryClient();
  const [, startTransition] = useTransition();

  const [diffMode, setDiffMode] = useState<DiffViewMode>("split");
  const [comparePair, setComparePairState] = useState<ComparePair>("active_incoming");
  const [showUnchanged, setShowUnchanged] = useState(false);
  const [manualSelectedPath, setManualSelectedPath] = useState<string | null>(null);
  const [studioTab, setStudioTabState] = useState<string | null>(null);
  const [reviewComment, setReviewComment] = useState("");
  const [actionError, setActionError] = useState<string | null>(null);
  const [confirmKind, setConfirmKind] = useState<null | "activate" | "reject">(null);

  const detailQuery = useQuery({
    queryKey: ["revision", revisionId],
    queryFn: () => api.revisionDetail(revisionId),
  });

  const detail = detailQuery.data ?? null;
  const revision = detail?.revision ?? null;
  const project = detail?.project ?? null;
  const isConflict = revision?.status === "conflict" && (detail?.conflicts.length ?? 0) > 0;

  const requestedTab = studioTab === "conflict" || studioTab === "diff" ? studioTab : null;
  const activeTab: "diff" | "conflict" =
    requestedTab === "conflict" && !isConflict
      ? "diff"
      : (requestedTab ?? (isConflict ? "conflict" : "diff"));

  const visibleFiles = useMemo(() => {
    const list = detail?.files ?? [];
    if (showUnchanged) return list;
    const changed = list.filter((file) => file.change_type !== "unchanged");
    return changed.length > 0 ? changed : list;
  }, [detail?.files, showUnchanged]);

  const selectedPath = useMemo(() => {
    if (visibleFiles.length === 0) return null;
    if (manualSelectedPath && visibleFiles.some((file) => file.path === manualSelectedPath)) {
      return manualSelectedPath;
    }
    const firstChanged = visibleFiles.find((file) => file.change_type !== "unchanged");
    return firstChanged?.path ?? visibleFiles[0]?.path ?? null;
  }, [visibleFiles, manualSelectedPath]);

  const conflictPathSet = useMemo(
    () => new Set((detail?.conflicts ?? []).map((conflict) => conflict.path)),
    [detail?.conflicts],
  );

  const pair = comparePairSides(comparePair);
  const canFetchSide = (side: FileSideName, path: string | null = selectedPath) => {
    if (!revision || !project || !path) return false;
    if (side === "base") return Boolean(revision.base_revision_id);
    if (side === "active") return Boolean(project.active_revision_id);
    return true;
  };

  const sideQueries = useQueries({
    queries: [
      {
        queryKey: ["revision-file", revisionId, selectedPath, pair.left],
        queryFn: () => api.revisionFile(revisionId, selectedPath!, pair.left),
        enabled: activeTab === "diff" && canFetchSide(pair.left),
      },
      {
        queryKey: ["revision-file", revisionId, selectedPath, pair.right],
        queryFn: () => api.revisionFile(revisionId, selectedPath!, pair.right),
        enabled: activeTab === "diff" && canFetchSide(pair.right),
      },
    ],
  });

  const leftQuery = sideQueries[0];
  const rightQuery = sideQueries[1];

  const prefetchFilePair = async (path: string, nextComparePair: ComparePair) => {
    const nextPair = comparePairSides(nextComparePair);
    const requests: Promise<unknown>[] = [];

    if (canFetchSide(nextPair.left, path)) {
      requests.push(
        queryClient.prefetchQuery({
          queryKey: ["revision-file", revisionId, path, nextPair.left],
          queryFn: () => api.revisionFile(revisionId, path, nextPair.left),
        }),
      );
    }
    if (canFetchSide(nextPair.right, path)) {
      requests.push(
        queryClient.prefetchQuery({
          queryKey: ["revision-file", revisionId, path, nextPair.right],
          queryFn: () => api.revisionFile(revisionId, path, nextPair.right),
        }),
      );
    }

    await Promise.all(requests);
  };

  const invalidateAll = async () => {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: ["revision", revisionId] }),
      queryClient.invalidateQueries({ queryKey: ["review-queue"] }),
      queryClient.invalidateQueries({ queryKey: ["dashboard"] }),
      queryClient.invalidateQueries({ queryKey: ["workspace"] }),
      queryClient.invalidateQueries({ queryKey: ["auth", "me"] }),
    ]);
  };

  const reviewMutation = useMutation({
    mutationFn: async (kind: ReviewAction) => {
      if (!revision) return;
      const comment = reviewComment.trim();
      if (kind === "reject") {
        await api.rejectRevision(revision.id, { comment });
      } else {
        await api.approveRevision(revision.id, {
          comment,
          activate_now: kind === "activate",
        });
      }
    },
    onSuccess: async () => {
      setConfirmKind(null);
      setReviewComment("");
      setActionError(null);
      await invalidateAll();
    },
    onError: (err) => {
      setConfirmKind(null);
      setActionError(
        err instanceof ApiError ? `${err.code}: ${err.message}` : "操作失败，请重试。",
      );
    },
  });

  const rebaseMutation = useMutation({
    mutationFn: () => api.rebaseRevision(revisionId),
    onSuccess: async () => {
      await Promise.all([
        detailQuery.refetch(),
        leftQuery?.refetch(),
        rightQuery?.refetch(),
      ]);
      toast.success("已基于当前生效版本重新合并，可以重新审批");
    },
    onError: (err) => {
      toast.error(
        err instanceof ApiError ? `${err.code}: ${err.message}` : "重新合并失败，请稍后重试。",
      );
    },
  });

  return (
    <RevisionContext
      value={{
        state: {
          diffMode,
          comparePair,
          showUnchanged,
          selectedPath,
          activeTab,
          reviewComment,
          actionError,
          confirmKind,
        },
        actions: {
          setDiffMode,
          setComparePair: (next) => {
            if (!selectedPath) {
              setComparePairState(next);
              return;
            }
            startTransition(async () => {
              await prefetchFilePair(selectedPath, next);
              setComparePairState(next);
            });
          },
          toggleUnchanged: () => setShowUnchanged((value) => !value),
          selectFile: (path) => {
            startTransition(async () => {
              await prefetchFilePair(path, comparePair);
              setManualSelectedPath(path);
            });
          },
          setStudioTab: (tab) => startTransition(() => setStudioTabState(tab)),
          setReviewComment,
          requestConfirm: setConfirmKind,
          cancelConfirm: () => setConfirmKind(null),
          runReviewAction: reviewMutation.mutate,
          rebase: () => rebaseMutation.mutate(),
          invalidateAll,
          refreshDetail: () => {
            void Promise.all([
              detailQuery.refetch(),
              leftQuery?.refetch(),
              rightQuery?.refetch(),
            ]);
          },
          refetchSides: () => {
            void leftQuery?.refetch();
            void rightQuery?.refetch();
          },
        },
        meta: {
          canApprove,
          detail,
          revision,
          project,
          isConflict,
          visibleFiles,
          unchangedCount: (detail?.files ?? []).filter(
            (file) => file.change_type === "unchanged",
          ).length,
          conflictPathSet,
          pair,
          canFetchSide,
          leftData: leftQuery?.data ?? null,
          rightData: rightQuery?.data ?? null,
          sidesLoading: Boolean(leftQuery?.isLoading || rightQuery?.isLoading),
          sidesError: leftQuery?.error ?? rightQuery?.error ?? null,
          detailLoading: detailQuery.isLoading,
          detailError: detailQuery.error,
          detailFetching: detailQuery.isFetching,
          pendingAction: reviewMutation.isPending ? (reviewMutation.variables ?? null) : null,
          canRebase: Boolean(
            detail?.stale && revision?.status === "pending_review" && canApprove,
          ),
          rebasing: rebaseMutation.isPending,
        },
      }}
    >
      {children}
    </RevisionContext>
  );
}
