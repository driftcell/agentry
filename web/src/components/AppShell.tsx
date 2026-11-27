import { Link, useRouterState } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { Activity, FolderTree, GitPullRequest, LogOut, Settings2 } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Select } from "@/components/ui/input";
import { api } from "@/lib/api";
import { useAuth } from "@/lib/auth-context";
import { cn } from "@/lib/utils";

export function AppShell({ children }: { children: React.ReactNode }) {
  const { user, projects, selectedProjectSlug, setSelectedProjectSlug, logout } = useAuth();
  const pathname = useRouterState({ select: (state) => state.location.pathname });

  const dashboardQuery = useQuery({
    queryKey: ["dashboard", "nav-badge"],
    queryFn: () => api.dashboard(),
    enabled: Boolean(user),
    staleTime: 15_000,
  });

  const pendingCount = dashboardQuery.data?.metrics.pending_reviews ?? 0;

  const navItems = [
    {
      to: "/" as const,
      label: "Dashboard",
      icon: Activity,
      active: pathname === "/",
    },
    {
      to: "/explorer" as const,
      label: "Explorer",
      icon: FolderTree,
      active: pathname.startsWith("/explorer") || pathname.includes("/workspace"),
    },
    {
      to: "/review" as const,
      label: "Review Queue",
      icon: GitPullRequest,
      active: pathname.startsWith("/review") || pathname.startsWith("/revisions"),
      badge: pendingCount > 0 ? pendingCount : null,
    },
    {
      to: "/platform" as const,
      label: "Platform",
      icon: Settings2,
      active: pathname.startsWith("/platform"),
    },
  ];

  return (
    <div className="min-h-screen bg-paper text-ink flex flex-col">
      <a
        href="#main-content"
        className="sr-only focus:not-sr-only focus:fixed focus:top-2 focus:left-2 focus:z-50 focus:rounded-sm focus:bg-zinc-950 focus:px-3 focus:py-1.5 focus:text-xs focus:text-white"
      >
        Skip to content
      </a>

      <header className="sticky top-0 z-30 border-b border-hairline bg-surface">
        <div className="mx-auto flex max-w-[1440px] flex-wrap items-center justify-between gap-3 px-4 sm:px-6 h-auto min-h-12 py-2 sm:py-0">
          <div className="flex items-center gap-6">
            <Link to="/" className="flex items-baseline gap-2 no-underline">
              <span className="font-mono text-sm font-bold tracking-tight text-ink">AGENTRY</span>
              <span className="hidden sm:inline font-mono text-[10px] uppercase tracking-widest text-ink-muted">
                MCP Registry
              </span>
            </Link>

            <nav aria-label="Primary" className="flex items-center gap-1">
              {navItems.map((item) => {
                const Icon = item.icon;
                return (
                  <Link
                    key={item.to}
                    to={item.to}
                    aria-current={item.active ? "page" : undefined}
                    className={cn(
                      "inline-flex items-center gap-1.5 rounded-sm px-2.5 py-1.5 text-xs font-medium transition-colors no-underline",
                      item.active
                        ? "bg-zinc-950 text-zinc-50"
                        : "text-ink-secondary hover:bg-subtle hover:text-ink",
                    )}
                  >
                    <Icon className="h-3.5 w-3.5" aria-hidden="true" />
                    <span>{item.label}</span>
                    {item.badge !== undefined && item.badge !== null ? (
                      <span
                        className={cn(
                          "mono-num ml-0.5 rounded-sm px-1 py-0 text-[10px] font-semibold",
                          item.active ? "bg-zinc-800 text-zinc-100" : "bg-zinc-200 text-zinc-900",
                        )}
                      >
                        {item.badge}
                      </span>
                    ) : null}
                  </Link>
                );
              })}
            </nav>
          </div>

          <div className="flex items-center gap-2.5">
            {projects.length > 0 ? (
              <div className="flex items-center gap-1.5">
                <label
                  htmlFor="global-project-select"
                  className="hidden md:inline font-mono text-[11px] text-ink-muted"
                >
                  PROJECT
                </label>
                <Select
                  id="global-project-select"
                  aria-label="Active project context"
                  value={selectedProjectSlug}
                  onChange={(e) => setSelectedProjectSlug(e.target.value)}
                  className="h-7 min-w-[140px] font-mono text-xs"
                >
                  {projects.map((p) => (
                    <option key={p.id} value={p.slug}>
                      {p.slug}
                    </option>
                  ))}
                </Select>
              </div>
            ) : null}

            {user ? (
              <div className="flex items-center gap-2 border-l border-hairline pl-2.5">
                <span className="font-mono text-xs text-ink">{user.username}</span>
                <Badge variant="muted" className="uppercase text-[10px]">
                  {user.role}
                </Badge>
                <Button
                  variant="ghost"
                  size="xs"
                  onClick={() => void logout()}
                  aria-label="Sign out"
                  title="Sign out"
                >
                  <LogOut className="h-3.5 w-3.5" aria-hidden="true" />
                  <span className="hidden sm:inline">Sign out</span>
                </Button>
              </div>
            ) : null}
          </div>
        </div>
      </header>

      <main id="main-content" className="mx-auto w-full max-w-[1440px] flex-1 px-4 sm:px-6 py-5">
        {children}
      </main>
    </div>
  );
}
