import { useState, type FormEvent } from "react";
import { Link } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  AlertTriangle,
  Check,
  Copy,
  KeyRound,
  Plus,
  RefreshCw,
  ShieldOff,
  UserPlus,
} from "lucide-react";
import { ClientSetupHelper } from "@/components/ClientSetupHelper";
import { ConfirmDialog } from "@/components/ConfirmDialog";
import { CopyableHash } from "@/components/CopyableHash";
import { EmptyPanel, ErrorPanel, ForbiddenPanel, LoadingPanel } from "@/components/StateViews";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input, Select, Textarea } from "@/components/ui/input";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { api, ApiError } from "@/lib/api";
import { useAuth } from "@/lib/auth-context";
import { formatRelativeTime, formatTimestamp, formatTokens } from "@/lib/format";
import {
  ALL_SCOPES,
  type ApiKeyRow,
  type IssueKeyResponse,
  type Scope,
  type UserRole,
} from "@/lib/types";
import { cn } from "@/lib/utils";

type PlatformTab = "projects" | "keys" | "users" | "setup";

export function PlatformPage({ initialTab }: { initialTab?: PlatformTab }) {
  const {
    projects,
    canApprove,
    canPlatform,
    selectedProjectSlug,
    setSelectedProjectSlug,
    refreshSession,
  } = useAuth();
  const queryClient = useQueryClient();

  const [tab, setTab] = useState<PlatformTab>(initialTab ?? "projects");
  const [keyProjectSlug, setKeyProjectSlug] = useState(
    selectedProjectSlug || projects[0]?.slug || "",
  );

  const effectiveKeySlug = projects.some((p) => p.slug === keyProjectSlug)
    ? keyProjectSlug
    : selectedProjectSlug || projects[0]?.slug || "";

  // Project creation dialog state
  const [createProjectOpen, setCreateProjectOpen] = useState(false);
  const [newSlug, setNewSlug] = useState("");
  const [newProjName, setNewProjName] = useState("");
  const [newProjDesc, setNewProjDesc] = useState("");
  const [newBudget, setNewBudget] = useState("200000");
  const [projSaving, setProjSaving] = useState(false);
  const [projError, setProjError] = useState<string | null>(null);

  // API key issuance & revocation state
  const [issueKeyOpen, setIssueKeyOpen] = useState(false);
  const [keyName, setKeyName] = useState("");
  const [keyScopes, setKeyScopes] = useState<Scope[]>(["mcp:read"]);
  const [keyGlobal, setKeyGlobal] = useState(false);
  const [keyUserId, setKeyUserId] = useState("");
  const [keySaving, setKeySaving] = useState(false);
  const [keyError, setKeyError] = useState<string | null>(null);
  const [issuedSecret, setIssuedSecret] = useState<IssueKeyResponse | null>(null);
  const [copiedSecret, setCopiedSecret] = useState(false);
  const [revokeTarget, setRevokeTarget] = useState<ApiKeyRow | null>(null);
  const [revoking, setRevoking] = useState(false);

  // User creation state
  const [createUserOpen, setCreateUserOpen] = useState(false);
  const [newUsername, setNewUsername] = useState("");
  const [newDisplayName, setNewDisplayName] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [newRole, setNewRole] = useState<UserRole>("member");
  const [userSaving, setUserSaving] = useState(false);
  const [userError, setUserError] = useState<string | null>(null);

  const keysQuery = useQuery({
    queryKey: ["project-keys", effectiveKeySlug],
    queryFn: () => api.listProjectKeys(effectiveKeySlug),
    enabled: canApprove && Boolean(effectiveKeySlug) && tab === "keys",
  });

  const usersQuery = useQuery({
    queryKey: ["users"],
    queryFn: () => api.listUsers(),
    enabled: canPlatform && (tab === "users" || issueKeyOpen),
  });

  const handleCreateProject = async (event: FormEvent) => {
    event.preventDefault();
    const slug = newSlug.trim();
    const name = newProjName.trim();
    const budget = Number(newBudget);
    if (!/^[a-z0-9][a-z0-9-]{1,62}[a-z0-9]$/.test(slug)) {
      setProjError(
        "Slug must be 3-64 lowercase letters, digits, or dashes (cannot start or end with a dash).",
      );
      return;
    }
    if (!name) {
      setProjError("Project name is required.");
      return;
    }
    if (!Number.isInteger(budget) || budget <= 0) {
      setProjError("Token budget must be a positive integer.");
      return;
    }

    setProjSaving(true);
    setProjError(null);
    try {
      await api.createProject({
        slug,
        name,
        description: newProjDesc.trim(),
        token_budget: budget,
      });
      setCreateProjectOpen(false);
      setNewSlug("");
      setNewProjName("");
      setNewProjDesc("");
      setNewBudget("200000");
      setSelectedProjectSlug(slug);
      setKeyProjectSlug(slug);
      await Promise.all([
        refreshSession(),
        queryClient.invalidateQueries({ queryKey: ["dashboard"] }),
      ]);
    } catch (err) {
      setProjError(
        err instanceof ApiError ? `${err.code}: ${err.message}` : "Failed to create project.",
      );
    } finally {
      setProjSaving(false);
    }
  };

  const toggleKeyScope = (scope: Scope) => {
    setKeyScopes((prev) =>
      prev.includes(scope) ? prev.filter((s) => s !== scope) : [...prev, scope],
    );
  };

  const handleIssueKey = async (event: FormEvent) => {
    event.preventDefault();
    if (!effectiveKeySlug) return;
    if (!keyName.trim()) {
      setKeyError("Key name is required.");
      return;
    }
    if (keyScopes.length === 0) {
      setKeyError("Select at least one scope.");
      return;
    }

    setKeySaving(true);
    setKeyError(null);
    try {
      const result = await api.issueProjectKey(effectiveKeySlug, {
        name: keyName.trim(),
        scopes: keyScopes,
        is_global: canPlatform ? keyGlobal : false,
        user_id: canPlatform && keyUserId ? keyUserId : undefined,
      });
      setIssueKeyOpen(false);
      setKeyName("");
      setKeyScopes(["mcp:read"]);
      setKeyGlobal(false);
      setKeyUserId("");
      setCopiedSecret(false);
      setIssuedSecret(result);
      await queryClient.invalidateQueries({ queryKey: ["project-keys", effectiveKeySlug] });
    } catch (err) {
      setKeyError(
        err instanceof ApiError ? `${err.code}: ${err.message}` : "Failed to issue API key.",
      );
    } finally {
      setKeySaving(false);
    }
  };

  const handleRevokeKey = async () => {
    if (!revokeTarget) return;
    setRevoking(true);
    try {
      await api.revokeKey(revokeTarget.id);
      setRevokeTarget(null);
      await queryClient.invalidateQueries({ queryKey: ["project-keys", effectiveKeySlug] });
    } catch (err) {
      setRevokeTarget(null);
      setKeyError(
        err instanceof ApiError ? `${err.code}: ${err.message}` : "Failed to revoke key.",
      );
    } finally {
      setRevoking(false);
    }
  };

  const handleCreateUser = async (event: FormEvent) => {
    event.preventDefault();
    const username = newUsername.trim();
    if (!/^[A-Za-z0-9][A-Za-z0-9._-]{2,63}$/.test(username)) {
      setUserError("Username must be 3-64 letters, digits, dots, underscores, or dashes.");
      return;
    }
    if (newPassword.length < 8) {
      setUserError("Password must be at least 8 characters.");
      return;
    }

    setUserSaving(true);
    setUserError(null);
    try {
      await api.createUser({
        username,
        display_name: newDisplayName.trim(),
        password: newPassword,
        role: newRole,
      });
      setCreateUserOpen(false);
      setNewUsername("");
      setNewDisplayName("");
      setNewPassword("");
      setNewRole("member");
      await queryClient.invalidateQueries({ queryKey: ["users"] });
    } catch (err) {
      setUserError(
        err instanceof ApiError ? `${err.code}: ${err.message}` : "Failed to create user.",
      );
    } finally {
      setUserSaving(false);
    }
  };

  const copyIssuedSecret = async () => {
    if (!issuedSecret?.api_key) return;
    try {
      await navigator.clipboard.writeText(issuedSecret.api_key);
      setCopiedSecret(true);
      window.setTimeout(() => setCopiedSecret(false), 1800);
    } catch {
      // Ignore clipboard failures.
    }
  };

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-end justify-between gap-3 border-b border-hairline pb-3">
        <div>
          <h1 className="text-base font-semibold tracking-tight text-ink">
            Platform Governance &amp; Client Setup
          </h1>
          <p className="mt-0.5 text-xs text-ink-secondary">
            Manage isolated projects, scoped Bearer API keys, user roles, and Claude Code / OpenCode
            configurations.
          </p>
        </div>
      </div>

      <Tabs value={tab} onValueChange={(v) => setTab(v as PlatformTab)}>
        <TabsList>
          <TabsTrigger value="projects">Projects ({projects.length})</TabsTrigger>
          <TabsTrigger value="keys">API Keys</TabsTrigger>
          <TabsTrigger value="users">Users</TabsTrigger>
          <TabsTrigger value="setup">Client Setup</TabsTrigger>
        </TabsList>

        <TabsContent value="projects" className="space-y-3">
          <div className="flex items-center justify-between gap-3">
            <p className="text-xs text-ink-secondary">
              Each project maintains an independent{" "}
              <code className="font-mono">active_revision_id</code> and token budget.
            </p>
            {canApprove ? (
              <Button size="sm" onClick={() => setCreateProjectOpen(true)}>
                <Plus className="h-3.5 w-3.5" aria-hidden="true" />
                <span>Create Project</span>
              </Button>
            ) : null}
          </div>

          {projects.length === 0 ? (
            <EmptyPanel title="No projects available" />
          ) : (
            <div className="overflow-x-auto border border-hairline bg-surface">
              <table className="w-full text-xs">
                <thead>
                  <tr className="border-b border-hairline bg-subtle/60 text-left font-mono text-[11px] text-ink-muted">
                    <th className="px-3 py-2 font-medium">Slug</th>
                    <th className="px-3 py-2 font-medium">Name</th>
                    <th className="px-3 py-2 font-medium">Active Revision</th>
                    <th className="px-3 py-2 text-right font-medium">Token Budget</th>
                    <th className="px-3 py-2 text-right font-medium">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-hairline">
                  {projects.map((p) => (
                    <tr key={p.id} className="hover:bg-subtle/40">
                      <td className="px-3 py-2.5 font-mono font-semibold text-ink">{p.slug}</td>
                      <td className="px-3 py-2.5">
                        <div className="font-medium text-ink">{p.name}</div>
                        {p.description ? (
                          <div className="text-[11px] text-ink-muted">{p.description}</div>
                        ) : null}
                      </td>
                      <td className="px-3 py-2.5">
                        {p.active_revision_id ? (
                          <div className="flex items-center gap-2">
                            <CopyableHash value={p.active_revision_id} prefix="rev:" />
                            <Link
                              to="/revisions/$revisionId"
                              params={{ revisionId: p.active_revision_id }}
                              className="font-mono text-[11px] text-ink-secondary hover:text-ink underline underline-offset-2"
                            >
                              Diff
                            </Link>
                          </div>
                        ) : (
                          <Badge variant="dashed">UNSEEDED</Badge>
                        )}
                      </td>
                      <td className="px-3 py-2.5 text-right mono-num text-ink">
                        {formatTokens(p.token_budget)} tok
                      </td>
                      <td className="px-3 py-2.5 text-right">
                        <div className="inline-flex items-center gap-2">
                          <Link
                            to="/explorer"
                            onClick={() => setSelectedProjectSlug(p.slug)}
                            className="font-mono text-[11px] text-ink underline underline-offset-2"
                          >
                            Explorer
                          </Link>
                          {canApprove ? (
                            <button
                              type="button"
                              onClick={() => {
                                setKeyProjectSlug(p.slug);
                                setTab("keys");
                              }}
                              className="font-mono text-[11px] text-ink underline underline-offset-2 cursor-pointer"
                            >
                              Keys
                            </button>
                          ) : null}
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </TabsContent>

        <TabsContent value="keys" className="space-y-4">
          {!canApprove ? (
            <ForbiddenPanel
              title="Admin role required for API key management"
              description="Only admin and superadmin users can list, issue, or revoke project API keys."
            />
          ) : (
            <>
              <div className="flex flex-wrap items-center justify-between gap-3 border border-hairline bg-surface px-4 py-3">
                <div className="flex flex-wrap items-center gap-2">
                  <label
                    htmlFor="keys-project-select"
                    className="font-mono text-[11px] text-ink-muted"
                  >
                    PROJECT KEYS
                  </label>
                  <Select
                    id="keys-project-select"
                    value={effectiveKeySlug}
                    onChange={(e) => setKeyProjectSlug(e.target.value)}
                    className="h-7 min-w-[160px] font-mono"
                  >
                    {projects.map((p) => (
                      <option key={p.id} value={p.slug}>
                        {p.slug}
                      </option>
                    ))}
                  </Select>
                  <Button
                    variant="outline"
                    size="xs"
                    onClick={() => void keysQuery.refetch()}
                    disabled={keysQuery.isFetching}
                  >
                    <RefreshCw
                      className={cn("h-3 w-3", keysQuery.isFetching && "animate-spin")}
                      aria-hidden="true"
                    />
                    <span>Refresh</span>
                  </Button>
                </div>

                <Button
                  size="sm"
                  disabled={!effectiveKeySlug}
                  onClick={() => {
                    setKeyError(null);
                    setIssueKeyOpen(true);
                  }}
                >
                  <KeyRound className="h-3.5 w-3.5" aria-hidden="true" />
                  <span>Issue API Key</span>
                </Button>
              </div>

              <p className="text-[11px] text-ink-muted">
                Note: Project-bound keys for <code className="font-mono">{effectiveKeySlug}</code>{" "}
                are listed below. Global keys (
                <code className="font-mono">default_project_id = null</code>) are shown once at
                issuance.
              </p>

              {keysQuery.isLoading ? (
                <LoadingPanel label={`Loading API keys for ${effectiveKeySlug}…`} />
              ) : keysQuery.error ? (
                <ErrorPanel
                  title="Failed to load API keys"
                  error={keysQuery.error}
                  onRetry={() => void keysQuery.refetch()}
                />
              ) : (keysQuery.data?.keys.length ?? 0) === 0 ? (
                <EmptyPanel
                  title={`No project-bound API keys for ${effectiveKeySlug}`}
                  description="Issue a key scoped to mcp:read or admin:* permissions to connect an MCP client."
                />
              ) : (
                <div className="overflow-x-auto border border-hairline bg-surface">
                  <table className="w-full text-xs">
                    <thead>
                      <tr className="border-b border-hairline bg-subtle/60 text-left font-mono text-[11px] text-ink-muted">
                        <th className="px-3 py-2 font-medium">Name &amp; Prefix</th>
                        <th className="px-3 py-2 font-medium">Owner</th>
                        <th className="px-3 py-2 font-medium">Scopes</th>
                        <th className="px-3 py-2 font-medium">Status</th>
                        <th className="px-3 py-2 font-medium">Last Used</th>
                        <th className="px-3 py-2 text-right font-medium">Actions</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-hairline">
                      {(keysQuery.data?.keys ?? []).map((k) => {
                        const isRevoked = Boolean(k.revoked_at);
                        const isExpired =
                          Boolean(k.expires_at) &&
                          new Date(k.expires_at ?? "").getTime() <= Date.now();
                        return (
                          <tr key={k.id} className="hover:bg-subtle/40">
                            <td className="px-3 py-2.5">
                              <div className="font-medium text-ink">{k.name}</div>
                              <code className="mono-num text-[11px] text-ink-muted">
                                mreg_{k.key_prefix}_…
                              </code>
                            </td>
                            <td className="px-3 py-2.5 font-mono text-ink">{k.username}</td>
                            <td className="px-3 py-2.5">
                              <div className="flex flex-wrap gap-1">
                                {k.scopes.map((s) => (
                                  <Badge
                                    key={s}
                                    variant={s.startsWith("admin:") ? "outline" : "muted"}
                                  >
                                    {s}
                                  </Badge>
                                ))}
                              </div>
                            </td>
                            <td className="px-3 py-2.5">
                              {isRevoked ? (
                                <Badge variant="removed">REVOKED</Badge>
                              ) : isExpired ? (
                                <Badge variant="dashed">EXPIRED</Badge>
                              ) : (
                                <Badge variant="added">ACTIVE</Badge>
                              )}
                            </td>
                            <td
                              title={formatTimestamp(k.last_used_at)}
                              className="px-3 py-2.5 mono-num text-ink-secondary"
                            >
                              {k.last_used_at ? formatRelativeTime(k.last_used_at) : "Never"}
                            </td>
                            <td className="px-3 py-2.5 text-right">
                              {!isRevoked ? (
                                <Button
                                  variant="destructiveOutline"
                                  size="xs"
                                  onClick={() => setRevokeTarget(k)}
                                >
                                  <ShieldOff className="h-3 w-3" aria-hidden="true" />
                                  <span>Revoke</span>
                                </Button>
                              ) : (
                                <span className="mono-num text-[11px] text-ink-muted">
                                  {formatRelativeTime(k.revoked_at)}
                                </span>
                              )}
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              )}
            </>
          )}
        </TabsContent>

        <TabsContent value="users" className="space-y-4">
          {!canPlatform ? (
            <ForbiddenPanel
              title="Superadmin role required for user management"
              description="Listing or creating registry users requires a superadmin account (admin:platform level)."
            />
          ) : (
            <>
              <div className="flex items-center justify-between gap-3">
                <p className="text-xs text-ink-secondary">
                  Human workbench accounts. Only <code className="font-mono">superadmin</code> and{" "}
                  <code className="font-mono">admin</code> roles may approve revisions.
                </p>
                <Button
                  size="sm"
                  onClick={() => {
                    setUserError(null);
                    setCreateUserOpen(true);
                  }}
                >
                  <UserPlus className="h-3.5 w-3.5" aria-hidden="true" />
                  <span>Create User</span>
                </Button>
              </div>

              {usersQuery.isLoading ? (
                <LoadingPanel label="Loading registry users…" />
              ) : usersQuery.error ? (
                <ErrorPanel
                  title="Failed to load users"
                  error={usersQuery.error}
                  onRetry={() => void usersQuery.refetch()}
                />
              ) : (
                <div className="overflow-x-auto border border-hairline bg-surface">
                  <table className="w-full text-xs">
                    <thead>
                      <tr className="border-b border-hairline bg-subtle/60 text-left font-mono text-[11px] text-ink-muted">
                        <th className="px-3 py-2 font-medium">Username</th>
                        <th className="px-3 py-2 font-medium">Display Name</th>
                        <th className="px-3 py-2 font-medium">Role</th>
                        <th className="px-3 py-2 text-right font-medium">Active Keys</th>
                        <th className="px-3 py-2 text-right font-medium">Created</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-hairline">
                      {(usersQuery.data?.users ?? []).map((u) => (
                        <tr key={u.id} className="hover:bg-subtle/40">
                          <td className="px-3 py-2.5 font-mono font-semibold text-ink">
                            {u.username}
                          </td>
                          <td className="px-3 py-2.5 text-ink-secondary">
                            {u.display_name || "—"}
                          </td>
                          <td className="px-3 py-2.5">
                            <Badge
                              variant={
                                u.role === "superadmin"
                                  ? "solid"
                                  : u.role === "admin"
                                    ? "outline"
                                    : "muted"
                              }
                            >
                              {u.role.toUpperCase()}
                            </Badge>
                          </td>
                          <td className="px-3 py-2.5 text-right mono-num text-ink">
                            {formatTokens(u.key_count)}
                          </td>
                          <td
                            title={formatTimestamp(u.created_at)}
                            className="px-3 py-2.5 text-right mono-num text-ink-muted"
                          >
                            {formatRelativeTime(u.created_at)}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </>
          )}
        </TabsContent>

        <TabsContent value="setup">
          <ClientSetupHelper projects={projects} defaultProjectSlug={selectedProjectSlug} />
        </TabsContent>
      </Tabs>

      {/* Create Project Dialog */}
      <Dialog open={createProjectOpen} onOpenChange={setCreateProjectOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Create Project</DialogTitle>
            <DialogDescription>
              Projects have isolated file snapshots, active revision pointers, and API key
              boundaries.
            </DialogDescription>
          </DialogHeader>
          <form onSubmit={handleCreateProject} className="mt-3 space-y-3">
            {projError ? (
              <div className="border border-red-300 bg-red-50 px-3 py-2 text-xs text-red-900 font-mono">
                {projError}
              </div>
            ) : null}

            <div className="space-y-1">
              <label htmlFor="new-proj-slug" className="block text-xs font-medium text-ink">
                Slug
              </label>
              <Input
                id="new-proj-slug"
                value={newSlug}
                onChange={(e) => setNewSlug(e.target.value)}
                placeholder="platform-core"
                className="font-mono"
                required
              />
            </div>

            <div className="space-y-1">
              <label htmlFor="new-proj-name" className="block text-xs font-medium text-ink">
                Name
              </label>
              <Input
                id="new-proj-name"
                value={newProjName}
                onChange={(e) => setNewProjName(e.target.value)}
                placeholder="Platform Core"
                required
              />
            </div>

            <div className="space-y-1">
              <label htmlFor="new-proj-desc" className="block text-xs font-medium text-ink">
                Description
              </label>
              <Textarea
                id="new-proj-desc"
                value={newProjDesc}
                onChange={(e) => setNewProjDesc(e.target.value)}
                rows={2}
                placeholder="Shared skills and instructions…"
              />
            </div>

            <div className="space-y-1">
              <label htmlFor="new-proj-budget" className="block text-xs font-medium text-ink">
                Token Budget (<code className="font-mono">o200k_base</code>)
              </label>
              <Input
                id="new-proj-budget"
                type="number"
                min={1}
                value={newBudget}
                onChange={(e) => setNewBudget(e.target.value)}
                className="mono-num"
                required
              />
            </div>

            <DialogFooter>
              <Button
                variant="outline"
                size="sm"
                onClick={() => setCreateProjectOpen(false)}
                disabled={projSaving}
              >
                Cancel
              </Button>
              <Button type="submit" size="sm" disabled={projSaving}>
                {projSaving ? "Creating…" : "Create Project"}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      {/* Issue API Key Dialog */}
      <Dialog open={issueKeyOpen} onOpenChange={setIssueKeyOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Issue API Key ({effectiveKeySlug})</DialogTitle>
            <DialogDescription>
              The plaintext token is displayed once upon issuance and cannot be recovered afterward.
            </DialogDescription>
          </DialogHeader>
          <form onSubmit={handleIssueKey} className="mt-3 space-y-3">
            {keyError ? (
              <div className="border border-red-300 bg-red-50 px-3 py-2 text-xs text-red-900 font-mono">
                {keyError}
              </div>
            ) : null}

            <div className="space-y-1">
              <label htmlFor="issue-key-name" className="block text-xs font-medium text-ink">
                Key Label
              </label>
              <Input
                id="issue-key-name"
                value={keyName}
                onChange={(e) => setKeyName(e.target.value)}
                placeholder="ci-proposer"
                required
              />
            </div>

            <div className="space-y-1.5">
              <span className="block text-xs font-medium text-ink">Scopes</span>
              <div className="grid grid-cols-2 gap-2">
                {ALL_SCOPES.map((scope) => {
                  const locked = scope === "admin:platform" && !canPlatform;
                  const checked = keyScopes.includes(scope);
                  return (
                    <label
                      key={scope}
                      className={cn(
                        "flex items-center gap-2 rounded-sm border px-2.5 py-1.5 font-mono text-xs",
                        locked
                          ? "border-hairline bg-subtle text-ink-muted opacity-60 cursor-not-allowed"
                          : "border-zinc-300 bg-white text-ink cursor-pointer",
                      )}
                    >
                      <input
                        type="checkbox"
                        checked={checked}
                        disabled={locked}
                        onChange={() => toggleKeyScope(scope)}
                      />
                      <span>{scope}</span>
                    </label>
                  );
                })}
              </div>
            </div>

            {canPlatform ? (
              <>
                <label className="flex items-center gap-2 text-xs text-ink cursor-pointer">
                  <input
                    type="checkbox"
                    checked={keyGlobal}
                    onChange={(e) => setKeyGlobal(e.target.checked)}
                  />
                  <span>
                    Issue as global multi-project key (not bound to{" "}
                    <code className="font-mono">{effectiveKeySlug}</code>)
                  </span>
                </label>

                <div className="space-y-1">
                  <label htmlFor="issue-key-user" className="block text-xs font-medium text-ink">
                    Assign to User (optional)
                  </label>
                  <Select
                    id="issue-key-user"
                    value={keyUserId}
                    onChange={(e) => setKeyUserId(e.target.value)}
                    className="w-full font-mono"
                  >
                    <option value="">Current signed-in user</option>
                    {(usersQuery.data?.users ?? []).map((u) => (
                      <option key={u.id} value={u.id}>
                        {u.username} ({u.role})
                      </option>
                    ))}
                  </Select>
                </div>
              </>
            ) : null}

            <DialogFooter>
              <Button
                variant="outline"
                size="sm"
                onClick={() => setIssueKeyOpen(false)}
                disabled={keySaving}
              >
                Cancel
              </Button>
              <Button type="submit" size="sm" disabled={keySaving}>
                {keySaving ? "Issuing…" : "Issue API Key"}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      {/* One-Time Plaintext Secret Reveal Dialog */}
      <Dialog
        open={Boolean(issuedSecret)}
        onOpenChange={(open) => {
          if (!open) {
            setIssuedSecret(null);
            setCopiedSecret(false);
          }
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>API Key Issued — Save Plaintext Now</DialogTitle>
            <DialogDescription>
              {issuedSecret?.warning ??
                "This plaintext key is shown once and cannot be retrieved again."}
            </DialogDescription>
          </DialogHeader>

          {issuedSecret ? (
            <div className="mt-3 space-y-3">
              <div className="flex items-start gap-2 border border-amber-400 bg-amber-50 px-3 py-2 text-xs text-amber-950">
                <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
                <span>
                  Store this Bearer token securely (e.g.,{" "}
                  <code className="font-mono">AGENTRY_API_KEY</code>). Closing this window clears it
                  from memory.
                </span>
              </div>

              <div className="border border-zinc-950 bg-zinc-950 text-zinc-50 p-3 rounded-sm space-y-2">
                <div className="flex items-center justify-between text-[11px] font-mono text-zinc-400">
                  <span>{issuedSecret.name}</span>
                  <span>{issuedSecret.is_global ? "GLOBAL" : issuedSecret.project}</span>
                </div>
                <div className="flex items-center justify-between gap-2">
                  <code className="font-mono text-xs break-all select-all">
                    {issuedSecret.api_key}
                  </code>
                  <Button variant="secondary" size="xs" onClick={() => void copyIssuedSecret()}>
                    {copiedSecret ? (
                      <>
                        <Check className="h-3 w-3 text-emerald-700" aria-hidden="true" />
                        <span>Copied</span>
                      </>
                    ) : (
                      <>
                        <Copy className="h-3 w-3" aria-hidden="true" />
                        <span>Copy</span>
                      </>
                    )}
                  </Button>
                </div>
              </div>
            </div>
          ) : null}

          <DialogFooter>
            <Button
              size="sm"
              onClick={() => {
                setIssuedSecret(null);
                setCopiedSecret(false);
              }}
            >
              I have stored this key
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Revoke API Key Confirmation */}
      <ConfirmDialog
        open={Boolean(revokeTarget)}
        onOpenChange={(open) => {
          if (!open) setRevokeTarget(null);
        }}
        title="Revoke API key?"
        description="Any MCP client using this key will immediately receive 401 UNAUTHENTICATED on /mcp and /admin/mcp."
        confirmLabel="Revoke Key"
        variant="destructive"
        pending={revoking}
        onConfirm={() => void handleRevokeKey()}
        details={
          revokeTarget ? (
            <div className="border border-hairline bg-paper p-3 text-xs font-mono space-y-1">
              <div>Name: {revokeTarget.name}</div>
              <div>Prefix: mreg_{revokeTarget.key_prefix}_…</div>
              <div>Scopes: {revokeTarget.scopes.join(", ")}</div>
            </div>
          ) : null
        }
      />

      {/* Create User Dialog */}
      <Dialog open={createUserOpen} onOpenChange={setCreateUserOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Create Registry User</DialogTitle>
            <DialogDescription>
              Creates a human account with Argon2id password hashing.
            </DialogDescription>
          </DialogHeader>
          <form onSubmit={handleCreateUser} className="mt-3 space-y-3">
            {userError ? (
              <div className="border border-red-300 bg-red-50 px-3 py-2 text-xs text-red-900 font-mono">
                {userError}
              </div>
            ) : null}

            <div className="space-y-1">
              <label htmlFor="new-user-username" className="block text-xs font-medium text-ink">
                Username
              </label>
              <Input
                id="new-user-username"
                value={newUsername}
                onChange={(e) => setNewUsername(e.target.value)}
                autoComplete="off"
                placeholder="reviewer.alice"
                className="font-mono"
                required
              />
            </div>

            <div className="space-y-1">
              <label htmlFor="new-user-display" className="block text-xs font-medium text-ink">
                Display Name
              </label>
              <Input
                id="new-user-display"
                value={newDisplayName}
                onChange={(e) => setNewDisplayName(e.target.value)}
                placeholder="Alice"
              />
            </div>

            <div className="space-y-1">
              <label htmlFor="new-user-password" className="block text-xs font-medium text-ink">
                Password (min 8 chars)
              </label>
              <Input
                id="new-user-password"
                type="password"
                autoComplete="new-password"
                value={newPassword}
                onChange={(e) => setNewPassword(e.target.value)}
                minLength={8}
                required
              />
            </div>

            <div className="space-y-1">
              <label htmlFor="new-user-role" className="block text-xs font-medium text-ink">
                Role
              </label>
              <Select
                id="new-user-role"
                value={newRole}
                onChange={(e) => setNewRole(e.target.value as UserRole)}
                className="w-full font-mono"
              >
                <option value="member">member (read-only web workbench)</option>
                <option value="admin">admin (approve, reject, resolve, project keys)</option>
                <option value="superadmin">superadmin (full platform &amp; user management)</option>
              </Select>
            </div>

            <DialogFooter>
              <Button
                variant="outline"
                size="sm"
                onClick={() => setCreateUserOpen(false)}
                disabled={userSaving}
              >
                Cancel
              </Button>
              <Button type="submit" size="sm" disabled={userSaving}>
                {userSaving ? "Creating…" : "Create User"}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  );
}
