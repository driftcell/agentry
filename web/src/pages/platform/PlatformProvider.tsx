import { createContext, use, useState, useTransition, type ReactNode } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { api } from "@/lib/api";
import { useAuth } from "@/lib/auth-context";
import type { Project } from "@/lib/types";
import type { PlatformTab } from "./types";

interface PlatformState {
  tab: PlatformTab;
  keyProjectSlug: string;
}

interface PlatformActions {
  setTab: (tab: PlatformTab) => void;
  setKeyProjectSlug: (slug: string) => void;
  openKeysForProject: (slug: string) => void;
}

interface PlatformMeta {
  projects: Project[];
  selectedProjectSlug: string;
  canApprove: boolean;
  canPlatform: boolean;
  effectiveKeySlug: string;
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
  const { projects, selectedProjectSlug, canApprove, canPlatform } = useAuth();
  const queryClient = useQueryClient();
  const [, startTransition] = useTransition();

  const [tab, setTabState] = useState<PlatformTab>(initialTab);
  const [keyProjectSlug, setKeyProjectSlug] = useState(
    selectedProjectSlug || projects[0]?.slug || "",
  );

  const effectiveKeySlug = projects.some((project) => project.slug === keyProjectSlug)
    ? keyProjectSlug
    : selectedProjectSlug || projects[0]?.slug || "";

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

  return (
    <PlatformContext
      value={{
        state: { tab, keyProjectSlug },
        actions: { setTab, setKeyProjectSlug, openKeysForProject },
        meta: {
          projects,
          selectedProjectSlug,
          canApprove,
          canPlatform,
          effectiveKeySlug,
        },
      }}
    >
      {children}
    </PlatformContext>
  );
}
