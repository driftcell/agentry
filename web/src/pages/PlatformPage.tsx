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
      setProjError("Slug 必须为 3–64 位小写字母、数字或连字符（不能以连字符开头或结尾）。");
      return;
    }
    if (!name) {
      setProjError("请填写项目名称。");
      return;
    }
    if (!Number.isInteger(budget) || budget <= 0) {
      setProjError("Token 预算必须为正整数。");
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
      setProjError(err instanceof ApiError ? `${err.code}: ${err.message}` : "创建项目失败。");
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
      setKeyError("请填写 API Key 名称。");
      return;
    }
    if (keyScopes.length === 0) {
      setKeyError("请至少勾选一个 Scope 权限。");
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
      setKeyError(err instanceof ApiError ? `${err.code}: ${err.message}` : "签发 API Key 失败。");
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
      setKeyError(err instanceof ApiError ? `${err.code}: ${err.message}` : "吊销密钥失败。");
    } finally {
      setRevoking(false);
    }
  };

  const handleCreateUser = async (event: FormEvent) => {
    event.preventDefault();
    const username = newUsername.trim();
    if (!/^[A-Za-z0-9][A-Za-z0-9._-]{2,63}$/.test(username)) {
      setUserError("用户名必须为 3–64 位字母、数字、点、下划线或连字符。");
      return;
    }
    if (newPassword.length < 8) {
      setUserError("密码长度至少需要 8 个字符。");
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
      setUserError(err instanceof ApiError ? `${err.code}: ${err.message}` : "创建用户失败。");
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
          <h1 className="text-base font-semibold tracking-tight text-ink">平台治理与客户端接入</h1>
          <p className="mt-0.5 text-xs text-ink-secondary">
            管理隔离项目、Scoped Bearer API Key、工作台用户角色以及 Claude Code / OpenCode
            接入配置。
          </p>
        </div>
      </div>

      <Tabs value={tab} onValueChange={(v) => setTab(v as PlatformTab)}>
        <TabsList>
          <TabsTrigger value="projects">项目管理 ({projects.length})</TabsTrigger>
          <TabsTrigger value="keys">API Keys</TabsTrigger>
          <TabsTrigger value="users">用户管理</TabsTrigger>
          <TabsTrigger value="setup">客户端接入</TabsTrigger>
        </TabsList>

        <TabsContent value="projects" className="space-y-3">
          <div className="flex items-center justify-between gap-3">
            <p className="text-xs text-ink-secondary">
              每个项目拥有独立的 <code className="font-mono">active_revision_id</code> 指针与 Token
              预算上限。
            </p>
            {canApprove ? (
              <Button size="sm" onClick={() => setCreateProjectOpen(true)}>
                <Plus className="h-3.5 w-3.5" aria-hidden="true" />
                <span>新建项目</span>
              </Button>
            ) : null}
          </div>

          {projects.length === 0 ? (
            <EmptyPanel title="暂无可用项目" />
          ) : (
            <div className="overflow-x-auto border border-hairline bg-surface">
              <table className="w-full text-xs">
                <thead>
                  <tr className="border-b border-hairline bg-subtle/60 text-left font-mono text-[11px] text-ink-muted">
                    <th className="px-3 py-2 font-medium">Slug</th>
                    <th className="px-3 py-2 font-medium">名称与说明</th>
                    <th className="px-3 py-2 font-medium">当前 Active Revision</th>
                    <th className="px-3 py-2 text-right font-medium">Token 预算</th>
                    <th className="px-3 py-2 text-right font-medium">操作</th>
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
                              查看快照
                            </Link>
                          </div>
                        ) : (
                          <Badge variant="dashed">未激活版本</Badge>
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
                            工作区
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
                              密钥
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
              title="API Key 管理需要管理员权限"
              description="仅 admin 与 superadmin 用户可以查看、签发或吊销项目 API Key。"
            />
          ) : (
            <>
              <div className="flex flex-wrap items-center justify-between gap-3 border border-hairline bg-surface px-4 py-3">
                <div className="flex flex-wrap items-center gap-2">
                  <label
                    htmlFor="keys-project-select"
                    className="font-mono text-[11px] text-ink-muted"
                  >
                    所属项目
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
                    <span>刷新</span>
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
                  <span>签发 API Key</span>
                </Button>
              </div>

              <p className="text-[11px] text-ink-muted">
                注：下方列出绑定到 <code className="font-mono">{effectiveKeySlug}</code>{" "}
                的项目密钥；全局密钥（
                <code className="font-mono">default_project_id = null</code>
                ）的明文仅在签发响应中展示一次。
              </p>

              {keysQuery.isLoading ? (
                <LoadingPanel label={`正在加载 ${effectiveKeySlug} 的 API Keys…`} />
              ) : keysQuery.error ? (
                <ErrorPanel
                  title="API Key 列表加载失败"
                  error={keysQuery.error}
                  onRetry={() => void keysQuery.refetch()}
                />
              ) : (keysQuery.data?.keys.length ?? 0) === 0 ? (
                <EmptyPanel
                  title={`项目 ${effectiveKeySlug} 暂无绑定 API Key`}
                  description="签发带有 mcp:read 或 admin:* Scope 的密钥后即可供 MCP 客户端接入。"
                />
              ) : (
                <div className="overflow-x-auto border border-hairline bg-surface">
                  <table className="w-full text-xs">
                    <thead>
                      <tr className="border-b border-hairline bg-subtle/60 text-left font-mono text-[11px] text-ink-muted">
                        <th className="px-3 py-2 font-medium">名称与前缀</th>
                        <th className="px-3 py-2 font-medium">所属用户</th>
                        <th className="px-3 py-2 font-medium">Scopes 权限</th>
                        <th className="px-3 py-2 font-medium">状态</th>
                        <th className="px-3 py-2 font-medium">最近使用</th>
                        <th className="px-3 py-2 text-right font-medium">操作</th>
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
                                <Badge variant="removed">已吊销</Badge>
                              ) : isExpired ? (
                                <Badge variant="dashed">已过期</Badge>
                              ) : (
                                <Badge variant="added">有效</Badge>
                              )}
                            </td>
                            <td
                              title={formatTimestamp(k.last_used_at)}
                              className="px-3 py-2.5 mono-num text-ink-secondary"
                            >
                              {k.last_used_at ? formatRelativeTime(k.last_used_at) : "从未使用"}
                            </td>
                            <td className="px-3 py-2.5 text-right">
                              {!isRevoked ? (
                                <Button
                                  variant="destructiveOutline"
                                  size="xs"
                                  onClick={() => setRevokeTarget(k)}
                                >
                                  <ShieldOff className="h-3 w-3" aria-hidden="true" />
                                  <span>吊销</span>
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
              title="用户管理需要超级管理员权限"
              description="查看或创建平台用户需要 superadmin 角色（对应 admin:platform 能力）。"
            />
          ) : (
            <>
              <div className="flex items-center justify-between gap-3">
                <p className="text-xs text-ink-secondary">
                  人类工作台账号管理。仅 <code className="font-mono">superadmin</code> 与{" "}
                  <code className="font-mono">admin</code> 角色拥有修订审批权。
                </p>
                <Button
                  size="sm"
                  onClick={() => {
                    setUserError(null);
                    setCreateUserOpen(true);
                  }}
                >
                  <UserPlus className="h-3.5 w-3.5" aria-hidden="true" />
                  <span>创建用户</span>
                </Button>
              </div>

              {usersQuery.isLoading ? (
                <LoadingPanel label="正在加载用户列表…" />
              ) : usersQuery.error ? (
                <ErrorPanel
                  title="用户列表加载失败"
                  error={usersQuery.error}
                  onRetry={() => void usersQuery.refetch()}
                />
              ) : (
                <div className="overflow-x-auto border border-hairline bg-surface">
                  <table className="w-full text-xs">
                    <thead>
                      <tr className="border-b border-hairline bg-subtle/60 text-left font-mono text-[11px] text-ink-muted">
                        <th className="px-3 py-2 font-medium">用户名</th>
                        <th className="px-3 py-2 font-medium">显示名称</th>
                        <th className="px-3 py-2 font-medium">角色</th>
                        <th className="px-3 py-2 text-right font-medium">有效密钥数</th>
                        <th className="px-3 py-2 text-right font-medium">创建时间</th>
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

      {/* 新建项目弹窗 */}
      <Dialog open={createProjectOpen} onOpenChange={setCreateProjectOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>新建项目</DialogTitle>
            <DialogDescription>
              每个项目拥有相互隔离的文件快照、Active Revision 指针与 API Key 边界。
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
                项目 Slug
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
                项目名称
              </label>
              <Input
                id="new-proj-name"
                value={newProjName}
                onChange={(e) => setNewProjName(e.target.value)}
                placeholder="核心平台工作区"
                required
              />
            </div>

            <div className="space-y-1">
              <label htmlFor="new-proj-desc" className="block text-xs font-medium text-ink">
                描述（可选）
              </label>
              <Textarea
                id="new-proj-desc"
                value={newProjDesc}
                onChange={(e) => setNewProjDesc(e.target.value)}
                rows={2}
                placeholder="共享 Skills 与团队协作规范…"
              />
            </div>

            <div className="space-y-1">
              <label htmlFor="new-proj-budget" className="block text-xs font-medium text-ink">
                Token 预算（<code className="font-mono">o200k_base</code>）
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
                取消
              </Button>
              <Button type="submit" size="sm" disabled={projSaving}>
                {projSaving ? "正在创建…" : "创建项目"}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      {/* 签发 API Key 弹窗 */}
      <Dialog open={issueKeyOpen} onOpenChange={setIssueKeyOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>签发 API Key（{effectiveKeySlug}）</DialogTitle>
            <DialogDescription>
              明文密钥仅在签发时展示一次，系统仅保存 SHA-256 哈希，后续无法再次查看。
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
                密钥标签名称
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
              <span className="block text-xs font-medium text-ink">授予 Scopes</span>
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
                    签发为全局多项目密钥（不绑定到{" "}
                    <code className="font-mono">{effectiveKeySlug}</code>）
                  </span>
                </label>

                <div className="space-y-1">
                  <label htmlFor="issue-key-user" className="block text-xs font-medium text-ink">
                    归属用户（可选）
                  </label>
                  <Select
                    id="issue-key-user"
                    value={keyUserId}
                    onChange={(e) => setKeyUserId(e.target.value)}
                    className="w-full font-mono"
                  >
                    <option value="">当前登录用户</option>
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
                取消
              </Button>
              <Button type="submit" size="sm" disabled={keySaving}>
                {keySaving ? "正在签发…" : "确认签发"}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      {/* 一次性明文密钥展示弹窗 */}
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
            <DialogTitle>API Key 已签发 — 请立即妥善保存明文</DialogTitle>
            <DialogDescription>
              {issuedSecret?.warning ?? "该明文密钥仅完整展示这一次，关闭后无法再次找回。"}
            </DialogDescription>
          </DialogHeader>

          {issuedSecret ? (
            <div className="mt-3 space-y-3">
              <div className="flex items-start gap-2 border border-amber-400 bg-amber-50 px-3 py-2 text-xs text-amber-950">
                <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
                <span>
                  请立即复制并保存该 Bearer Token（例如写入{" "}
                  <code className="font-mono">AGENTRY_API_KEY</code>
                  ）。关闭弹窗后明文将从页面内存清除。
                </span>
              </div>

              <div className="border border-zinc-950 bg-zinc-950 text-zinc-50 p-3 rounded-sm space-y-2">
                <div className="flex items-center justify-between text-[11px] font-mono text-zinc-400">
                  <span>{issuedSecret.name}</span>
                  <span>{issuedSecret.is_global ? "全局密钥" : issuedSecret.project}</span>
                </div>
                <div className="flex items-center justify-between gap-2">
                  <code className="font-mono text-xs break-all select-all">
                    {issuedSecret.api_key}
                  </code>
                  <Button variant="secondary" size="xs" onClick={() => void copyIssuedSecret()}>
                    {copiedSecret ? (
                      <>
                        <Check className="h-3 w-3 text-emerald-700" aria-hidden="true" />
                        <span>已复制</span>
                      </>
                    ) : (
                      <>
                        <Copy className="h-3 w-3" aria-hidden="true" />
                        <span>复制</span>
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
              我已保存此密钥
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* 吊销 API Key 确认弹窗 */}
      <ConfirmDialog
        open={Boolean(revokeTarget)}
        onOpenChange={(open) => {
          if (!open) setRevokeTarget(null);
        }}
        title="确认吊销此 API Key？"
        description="吊销后立即生效，任何使用该密钥的 /mcp 和 /admin/mcp 调用都将返回 401 UNAUTHENTICATED。"
        confirmLabel="确认吊销"
        variant="destructive"
        pending={revoking}
        onConfirm={() => void handleRevokeKey()}
        details={
          revokeTarget ? (
            <div className="border border-hairline bg-paper p-3 text-xs font-mono space-y-1">
              <div>名称：{revokeTarget.name}</div>
              <div>前缀：mreg_{revokeTarget.key_prefix}_…</div>
              <div>Scopes：{revokeTarget.scopes.join(", ")}</div>
            </div>
          ) : null
        }
      />

      {/* 创建用户弹窗 */}
      <Dialog open={createUserOpen} onOpenChange={setCreateUserOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>创建工作台用户</DialogTitle>
            <DialogDescription>
              创建用于人类登录 Web 工作台的账户，密码在服务端使用 Argon2id 哈希存储。
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
                用户名
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
                显示名称
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
                密码（至少 8 位）
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
                角色
              </label>
              <Select
                id="new-user-role"
                value={newRole}
                onChange={(e) => setNewRole(e.target.value as UserRole)}
                className="w-full font-mono"
              >
                <option value="member">member（工作台只读浏览）</option>
                <option value="admin">admin（审批、拒绝、冲突解决、项目管理与密钥管理）</option>
                <option value="superadmin">superadmin（全平台治理与用户管理）</option>
              </Select>
            </div>

            <DialogFooter>
              <Button
                variant="outline"
                size="sm"
                onClick={() => setCreateUserOpen(false)}
                disabled={userSaving}
              >
                取消
              </Button>
              <Button type="submit" size="sm" disabled={userSaving}>
                {userSaving ? "正在创建…" : "创建用户"}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  );
}
