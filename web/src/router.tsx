import { useEffect } from "react";
import {
  Link,
  Outlet,
  createRootRoute,
  createRoute,
  createRouter,
  useNavigate,
  useRouterState,
} from "@tanstack/react-router";
import { AppShell } from "@/components/AppShell";
import { EmptyPanel, ErrorPanel, LoadingPanel } from "@/components/StateViews";
import { useAuth } from "@/lib/auth-context";
import { DashboardPage } from "@/pages/DashboardPage";
import { ExplorerPage } from "@/pages/ExplorerPage";
import { LoginPage } from "@/pages/LoginPage";
import { PlatformPage } from "@/pages/PlatformPage";
import { ReviewQueuePage } from "@/pages/ReviewQueuePage";
import { RevisionDetailPage } from "@/pages/RevisionDetailPage";

function RootLayout() {
  const { user, isLoading, error, refreshSession } = useAuth();
  const navigate = useNavigate();
  const location = useRouterState({ select: (s) => s.location });

  useEffect(() => {
    if (isLoading) return;
    if (!user && location.pathname !== "/login") {
      const target = location.href;
      void navigate({
        to: "/login",
        search: target && target !== "/" ? { redirect: target } : {},
        replace: true,
      });
    }
  }, [isLoading, user, location.pathname, location.href, navigate]);

  if (isLoading) {
    return (
      <div className="min-h-screen bg-paper flex items-center justify-center p-6">
        <LoadingPanel label="正在恢复工作台会话…" className="max-w-sm w-full" />
      </div>
    );
  }

  if (error) {
    return (
      <div className="min-h-screen bg-paper flex items-center justify-center p-6">
        <ErrorPanel
          title="无法验证登录会话"
          error={error}
          onRetry={() => void refreshSession()}
          className="max-w-lg w-full"
        />
      </div>
    );
  }

  if (location.pathname === "/login") {
    return <Outlet />;
  }

  if (!user) {
    return <LoginPage />;
  }

  return (
    <AppShell>
      <Outlet />
    </AppShell>
  );
}

function LoginRouteView() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const search = loginRoute.useSearch();

  useEffect(() => {
    if (user) {
      const dest =
        search.redirect && search.redirect.startsWith("/") && !search.redirect.startsWith("//")
          ? search.redirect
          : "/";
      void navigate({ to: dest as "/", replace: true });
    }
  }, [user, search.redirect, navigate]);

  return (
    <LoginPage
      onSuccess={() => {
        const dest =
          search.redirect && search.redirect.startsWith("/") && !search.redirect.startsWith("//")
            ? search.redirect
            : "/";
        void navigate({ to: dest as "/", replace: true });
      }}
    />
  );
}

const rootRoute = createRootRoute({
  component: RootLayout,
  notFoundComponent: () => (
    <EmptyPanel
      title="页面不存在"
      description="未找到对应的工作台路由。"
      action={
        <Link
          to="/"
          className="inline-flex items-center rounded-sm border border-zinc-950 bg-zinc-950 px-3 py-1.5 text-xs font-medium text-zinc-50 no-underline"
        >
          返回概览
        </Link>
      }
    />
  ),
});

const loginRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/login",
  validateSearch: (search: Record<string, unknown>): { redirect?: string } => ({
    redirect: typeof search.redirect === "string" ? search.redirect : undefined,
  }),
  component: LoginRouteView,
});

const dashboardRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/",
  component: DashboardPage,
});

const explorerRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/explorer",
  validateSearch: (search: Record<string, unknown>): { project?: string; path?: string } => ({
    project: typeof search.project === "string" ? search.project : undefined,
    path: typeof search.path === "string" ? search.path : undefined,
  }),
  component: function ExplorerRouteView() {
    const search = explorerRoute.useSearch();
    const navigate = useNavigate();
    return (
      <ExplorerPage
        projectSlugOverride={search.project}
        initialPath={search.path}
        onProjectChange={(slug) => {
          void navigate({ to: "/explorer", search: { project: slug } });
        }}
      />
    );
  },
});

const projectWorkspaceRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/projects/$slug/workspace",
  component: function ProjectWorkspaceView() {
    const { slug } = projectWorkspaceRoute.useParams();
    const navigate = useNavigate();
    return (
      <ExplorerPage
        projectSlugOverride={slug}
        onProjectChange={(nextSlug) => {
          void navigate({
            to: "/projects/$slug/workspace",
            params: { slug: nextSlug },
          });
        }}
      />
    );
  },
});

const reviewRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/review",
  component: ReviewQueuePage,
});

const revisionDetailRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/revisions/$revisionId",
  component: function RevisionDetailView() {
    const { revisionId } = revisionDetailRoute.useParams();
    return <RevisionDetailPage revisionId={revisionId} />;
  },
});

const platformRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/platform",
  validateSearch: (
    search: Record<string, unknown>,
  ): { tab?: "projects" | "keys" | "users" | "setup" } => {
    const t = search.tab;
    if (t === "projects" || t === "keys" || t === "users" || t === "setup") {
      return { tab: t };
    }
    return {};
  },
  component: function PlatformRouteView() {
    const search = platformRoute.useSearch();
    return <PlatformPage initialTab={search.tab} />;
  },
});

const routeTree = rootRoute.addChildren([
  loginRoute,
  dashboardRoute,
  explorerRoute,
  projectWorkspaceRoute,
  reviewRoute,
  revisionDetailRoute,
  platformRoute,
]);

export const router = createRouter({
  routeTree,
  defaultPreload: "intent",
});

declare module "@tanstack/react-router" {
  interface Register {
    router: typeof router;
  }
}
