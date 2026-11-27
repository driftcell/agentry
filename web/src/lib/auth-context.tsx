import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { api, ApiError, onUnauthorized } from "@/lib/api";
import type { MeResponse, Project, WebUser } from "@/lib/types";

interface AuthContextValue {
  me: MeResponse | null;
  user: WebUser | null;
  projects: Project[];
  canApprove: boolean;
  canPlatform: boolean;
  isLoading: boolean;
  error: Error | null;
  selectedProjectSlug: string;
  setSelectedProjectSlug: (slug: string) => void;
  login: (username: string, password: string) => Promise<void>;
  logout: () => Promise<void>;
  refreshSession: () => Promise<void>;
}

const AuthContext = createContext<AuthContextValue | null>(null);

export const ME_QUERY_KEY = ["auth", "me"] as const;
const SELECTED_PROJECT_STORAGE_KEY = "agentry:selected_project";

function readStoredProject(): string {
  try {
    return window.localStorage.getItem(SELECTED_PROJECT_STORAGE_KEY) ?? "";
  } catch {
    return "";
  }
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const queryClient = useQueryClient();
  const [storedSlug, setStoredSlug] = useState<string>(readStoredProject);

  const meQuery = useQuery<MeResponse, Error>({
    queryKey: ME_QUERY_KEY,
    queryFn: () => api.me(),
    retry: (failureCount, err) => {
      if (err instanceof ApiError && (err.status === 401 || err.status === 403)) {
        return false;
      }
      return failureCount < 1;
    },
    staleTime: 30_000,
  });

  useEffect(() => {
    return onUnauthorized(() => {
      queryClient.setQueryData(ME_QUERY_KEY, null);
      queryClient.removeQueries({
        predicate: (query) => query.queryKey[0] !== "auth",
      });
    });
  }, [queryClient]);

  const setSelectedProjectSlug = useCallback((slug: string) => {
    setStoredSlug(slug);
    try {
      if (slug) {
        window.localStorage.setItem(SELECTED_PROJECT_STORAGE_KEY, slug);
      } else {
        window.localStorage.removeItem(SELECTED_PROJECT_STORAGE_KEY);
      }
    } catch {
      // Ignore storage failures in restricted contexts.
    }
  }, []);

  const projects = useMemo(
    () => meQuery.data?.projects ?? [],
    [meQuery.data?.projects],
  );

  const selectedProjectSlug = useMemo(() => {
    if (projects.length === 0) return "";
    if (storedSlug && projects.some((p) => p.slug === storedSlug)) {
      return storedSlug;
    }
    const defaultProj = projects.find((p) => p.slug === "default");
    return defaultProj?.slug ?? projects[0]?.slug ?? "";
  }, [projects, storedSlug]);

  const login = useCallback(
    async (username: string, password: string) => {
      await api.login(username, password);
      await queryClient.invalidateQueries({ queryKey: ME_QUERY_KEY });
      await queryClient.refetchQueries({ queryKey: ME_QUERY_KEY });
    },
    [queryClient],
  );

  const logout = useCallback(async () => {
    try {
      await api.logout();
    } finally {
      queryClient.setQueryData(ME_QUERY_KEY, null);
      queryClient.clear();
    }
  }, [queryClient]);

  const refreshSession = useCallback(async () => {
    await queryClient.invalidateQueries({ queryKey: ME_QUERY_KEY });
  }, [queryClient]);

  const isUnauthenticated = meQuery.error instanceof ApiError && meQuery.error.status === 401;

  const value: AuthContextValue = useMemo(
    () => ({
      me: isUnauthenticated ? null : (meQuery.data ?? null),
      user: isUnauthenticated ? null : (meQuery.data?.user ?? null),
      projects,
      canApprove: meQuery.data?.can_approve ?? false,
      canPlatform: meQuery.data?.can_platform ?? false,
      isLoading: meQuery.isLoading,
      error: isUnauthenticated ? null : (meQuery.error ?? null),
      selectedProjectSlug,
      setSelectedProjectSlug,
      login,
      logout,
      refreshSession,
    }),
    [
      isUnauthenticated,
      meQuery.data,
      meQuery.isLoading,
      meQuery.error,
      projects,
      selectedProjectSlug,
      setSelectedProjectSlug,
      login,
      logout,
      refreshSession,
    ],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) {
    throw new Error("useAuth must be used inside AuthProvider");
  }
  return ctx;
}
