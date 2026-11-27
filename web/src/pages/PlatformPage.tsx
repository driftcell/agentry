import { useState, useTransition, type FormEvent } from "react";
import { Link } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Folder,
  KeyRound,
  Plug,
  Plus,
  RefreshCw,
  ShieldOff,
  UserPlus,
  Users,
} from "lucide-react";
import { ClientSetupHelper } from "@/components/ClientSetupHelper";
import { ConfirmDialog } from "@/components/ConfirmDialog";
import { CopyableHash } from "@/components/CopyableHash";
import { CopyButton } from "@/components/CopyButton";
import { FadeTransition } from "@/components/FadeTransition";
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
import { Combobox, ComboboxContent, ComboboxItem, ComboboxList, ComboboxTrigger, ComboboxValue } from "@/components/ui/combobox";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
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

function roleLabel(role: UserRole): string {
  switch (role) {
    case "superadmin":
      return "超级管理员";
    case "admin":
      return "管理员";
    case "member":
      return "普通成员";
  }
}

const USER_ROLE_OPTIONS: ReadonlyArray<{ value: UserRole; label: string }> = [
  { value: "member", label: "普通成员（只读）" },
  { value: "admin", label: "管理员（审批与密钥管理）" },
  { value: "superadmin", label: "超级管理员（全部权限）" },
];

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
  const [, startTransition] = useTransition();

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
  const [keyNameError, setKeyNameError] = useState<string | null>(null);
  const [keyScopes, setKeyScopes] = useState<Scope[]>(["mcp:read"]);
  const [keyGlobal, setKeyGlobal] = useState(false);
  const [keyUserId, setKeyUserId] = useState("");
  const [keyError, setKeyError] = useState<string | null>(null);
  const [issuedSecret, setIssuedSecret] = useState<IssueKeyResponse | null>(null);
  const [revokeTarget, setRevokeTarget] = useState<ApiKeyRow | null>(null);

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

  const keyProjectOptions = projects.map((p) => ({ value: p.slug, label: p.slug }));
  const selectedKeyProject =
    keyProjectOptions.find((p) => p.value === effectiveKeySlug) ?? null;

  const keyUserOptions = [
    { value: "", label: "当前登录用户" },
    ...(usersQuery.data?.users ?? []).map((u) => ({
      value: u.id,
      label: `${u.username} (${roleLabel(u.role)})`,
    })),
  ];
  const selectedKeyUser = keyUserOptions.find((u) => u.value === keyUserId) ?? null;

  const selectedRole = USER_ROLE_OPTIONS.find((r) => r.value === newRole) ?? null;

  const existingKeyNames = new Set(
    (keysQuery.data?.keys ?? []).map((key) => key.name.trim().toLowerCase()),
  );

  const validateKeyName = (name: string) => {
    const trimmed = name.trim();
    if (!trimmed) return "请填写密钥名称。";
    if (existingKeyNames.has(trimmed.toLowerCase())) {
      return "当前项目已存在同名密钥，请换一个名称。";
    }
    return null;
  };

  const issueKeyMutation = useMutation({
    mutationFn: (input: { name: string; scopes: Scope[]; user_id?: string; is_global: boolean }) =>
      api.issueProjectKey(effectiveKeySlug, input),
    onSuccess: async (result) => {
      setIssueKeyOpen(false);
      setKeyName("");
      setKeyNameError(null);
      setKeyScopes(["mcp:read"]);
      setKeyGlobal(false);
      setKeyUserId("");
      setKeyError(null);
      setIssuedSecret(result);
      await queryClient.invalidateQueries({ queryKey: ["project-keys", effectiveKeySlug] });
    },
    onError: (err) => {
      setKeyError(err instanceof ApiError ? `${err.code}: ${err.message}` : "签发失败。");
    },
  });

  const revokeKeyMutation = useMutation({
    mutationFn: (id: string) => api.revokeKey(id),
    onSuccess: async () => {
      setRevokeTarget(null);
      await queryClient.invalidateQueries({ queryKey: ["project-keys", effectiveKeySlug] });
    },
    onError: (err) => {
      setRevokeTarget(null);
      setKeyError(err instanceof ApiError ? `${err.code}: ${err.message}` : "吊销失败。");
    },
  });

  const changeTab = (nextTab: PlatformTab) => {
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
      setTab(nextTab);
    });
  };

  const handleCreateProject = async (event: FormEvent) => {
    event.preventDefault();
    const slug = newSlug.trim();
    const name = newProjName.trim();
    const budget = Number(newBudget);
    if (!/^[a-z0-9][a-z0-9-]{1,62}[a-z0-9]$/.test(slug)) {
      setProjError("项目标识需为 3–64 位小写字母、数字或连字符。");
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

  const handleIssueKey = (event: FormEvent) => {
    event.preventDefault();
    if (!effectiveKeySlug) return;

    const nameError = validateKeyName(keyName);
    if (nameError) {
      setKeyNameError(nameError);
      return;
    }
    if (keyScopes.length === 0) {
      setKeyError("请至少选择一个权限范围。");
      return;
    }

    setKeyError(null);
    setKeyNameError(null);
    issueKeyMutation.mutate({
      name: keyName.trim(),
      scopes: keyScopes,
      is_global: canPlatform ? keyGlobal : false,
      user_id: canPlatform && keyUserId ? keyUserId : undefined,
    });
  };

  const handleRevokeKey = () => {
    if (!revokeTarget) return;
    revokeKeyMutation.mutate(revokeTarget.id);
  };

  const handleCreateUser = async (event: FormEvent) => {
    event.preventDefault();
    const username = newUsername.trim();
    if (!/^[A-Za-z0-9][A-Za-z0-9._-]{2,63}$/.test(username)) {
      setUserError("用户名需为 3–64 位字母、数字、点、下划线或连字符。");
      return;
    }
    if (newPassword.length < 8) {
      setUserError("密码至少 8 个字符。");
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

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-hairline pb-3">
        <h1 className="text-base font-semibold tracking-tight text-ink">平台管理</h1>
      </div>

      <Tabs value={tab} onValueChange={(v) => changeTab(v as PlatformTab)}>
        <TabsList>
          <TabsTrigger value="projects">
            <Folder aria-hidden="true" />
            项目 ({projects.length})
          </TabsTrigger>
          <TabsTrigger value="keys">
            <KeyRound aria-hidden="true" />
            API Key
          </TabsTrigger>
          <TabsTrigger value="users">
            <Users aria-hidden="true" />
            用户
          </TabsTrigger>
          <TabsTrigger value="setup">
            <Plug aria-hidden="true" />
            客户端接入
          </TabsTrigger>
        </TabsList>

        <TabsContent value="projects" className="space-y-3">
          <FadeTransition>
          {canApprove ? (
            <div className="flex justify-end">
              <Button size="sm" onClick={() => setCreateProjectOpen(true)}>
                <Plus className="h-3.5 w-3.5" aria-hidden="true" />
                <span>新建项目</span>
              </Button>
            </div>
          ) : null}

          {projects.length === 0 ? (
            <EmptyPanel title="暂无项目" />
          ) : (
            <div className="overflow-x-auto border border-hairline bg-surface">
              <table className="w-full text-xs">
                <thead>
                  <tr className="border-b border-hairline bg-subtle/60 text-left text-[11px] text-ink-muted">
                    <th className="px-3 py-2 font-medium">项目标识</th>
                    <th className="px-3 py-2 font-medium">名称</th>
                    <th className="px-3 py-2 font-medium">当前版本</th>
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
                            <CopyableHash value={p.active_revision_id} />
                            <Link
                              to="/revisions/$revisionId"
                              params={{ revisionId: p.active_revision_id }}
                              className="text-[11px] text-ink-secondary hover:text-ink underline underline-offset-2"
                            >
                              查看
                            </Link>
                          </div>
                        ) : (
                          <Badge variant="outline" className="border-dashed text-muted-foreground">
                            未激活
                          </Badge>
                        )}
                      </td>
                      <td className="px-3 py-2.5 text-right mono-num text-ink">
                        {formatTokens(p.token_budget)} tok
                      </td>
                      <td className="px-3 py-2.5 text-right">
                        <div className="inline-flex items-center gap-3">
                          <Link
                            to="/explorer"
                            onClick={() => setSelectedProjectSlug(p.slug)}
                            className="text-xs text-ink underline underline-offset-2"
                          >
                            文件
                          </Link>
                          {canApprove ? (
                            <button
                              type="button"
                              onClick={() => {
                                setKeyProjectSlug(p.slug);
                                setTab("keys");
                              }}
                              className="text-xs text-ink underline underline-offset-2 cursor-pointer"
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
          </FadeTransition>
        </TabsContent>

        <TabsContent value="keys" className="space-y-4">
          <FadeTransition>
          {!canApprove ? (
            <ForbiddenPanel
              title="需要管理员权限"
              description="仅管理员可以查看、签发或吊销 API Key。"
            />
          ) : (
            <>
              <div className="flex flex-wrap items-center justify-between gap-3 border border-hairline bg-surface px-4 py-3">
                <div className="flex flex-wrap items-center gap-2">
                  <Combobox
                    items={keyProjectOptions}
                    value={selectedKeyProject}
                    onValueChange={(next) => {
                      if (next) setKeyProjectSlug(next.value);
                    }}
                    itemToStringLabel={(item) => item.label}
                    itemToStringValue={(item) => item.value}
                    isItemEqualToValue={(item, current) => item.value === current.value}
                  >
                    <ComboboxTrigger
                      id="keys-project-select"
                      aria-label="选择项目"
                      render={
                        <Button
                          variant="outline"
                          size="sm"
                          className="h-7 min-w-[160px] justify-between font-mono"
                        />
                      }
                    >
                      <ComboboxValue />
                    </ComboboxTrigger>
                    <ComboboxContent>
                      <ComboboxList>
                        {(item) => (
                          <ComboboxItem key={item.value} value={item}>
                            {item.label}
                          </ComboboxItem>
                        )}
                      </ComboboxList>
                    </ComboboxContent>
                  </Combobox>
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
                  <span>新建密钥</span>
                </Button>
              </div>

              {keysQuery.isLoading ? (
                <LoadingPanel label="加载中…" />
              ) : keysQuery.error ? (
                <ErrorPanel
                  title="API Key 加载失败"
                  error={keysQuery.error}
                  onRetry={() => void keysQuery.refetch()}
                />
              ) : (keysQuery.data?.keys.length ?? 0) === 0 ? (
                <EmptyPanel title={`项目 ${effectiveKeySlug} 暂无绑定密钥`} />
              ) : (
                <div className="overflow-x-auto border border-hairline bg-surface">
                  <table className="w-full text-xs">
                    <thead>
                      <tr className="border-b border-hairline bg-subtle/60 text-left text-[11px] text-ink-muted">
                        <th className="px-3 py-2 font-medium">名称</th>
                        <th className="px-3 py-2 font-medium">所属用户</th>
                        <th className="px-3 py-2 font-medium">权限</th>
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
                          new Date(k.expires_at ?? "").getTime() <= keysQuery.dataUpdatedAt;
                        return (
                          <tr key={k.id} className="hover:bg-subtle/40">
                            <td className="px-3 py-2.5">
                              <div className="font-medium text-ink">{k.name}</div>
                              <code className="mono-num text-[11px] text-ink-muted">
                                ak-{k.key_prefix}-…
                              </code>
                            </td>
                            <td className="px-3 py-2.5 font-mono text-ink">{k.username}</td>
                            <td className="px-3 py-2.5">
                              <div className="flex flex-wrap gap-1">
                                {k.scopes.map((s) => (
                                  <Badge
                                    key={s}
                                    variant={s.startsWith("admin:") ? "outline" : "secondary"}
                                  >
                                    {s}
                                  </Badge>
                                ))}
                              </div>
                            </td>
                            <td className="px-3 py-2.5">
                              {isRevoked ? (
                                <Badge variant="destructive">已吊销</Badge>
                              ) : isExpired ? (
                                <Badge
                                  variant="outline"
                                  className="border-dashed text-muted-foreground"
                                >
                                  已过期
                                </Badge>
                              ) : (
                                <Badge
                                  variant="outline"
                                  className="border-emerald-300 bg-emerald-50 text-emerald-800"
                                >
                                  有效
                                </Badge>
                              )}
                            </td>
                            <td
                              title={formatTimestamp(k.last_used_at)}
                              className="px-3 py-2.5 mono-num text-ink-secondary"
                            >
                              {k.last_used_at ? formatRelativeTime(k.last_used_at) : "未使用"}
                            </td>
                            <td className="px-3 py-2.5 text-right">
                              {!isRevoked ? (
                                <Button
                                  variant="destructive"
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
          </FadeTransition>
        </TabsContent>

        <TabsContent value="users" className="space-y-4">
          <FadeTransition>
          {!canPlatform ? (
            <ForbiddenPanel
              title="需要超级管理员权限"
              description="仅超级管理员可以查看或创建用户。"
            />
          ) : (
            <>
              <div className="flex justify-end">
                <Button
                  size="sm"
                  onClick={() => {
                    setUserError(null);
                    setCreateUserOpen(true);
                  }}
                >
                  <UserPlus className="h-3.5 w-3.5" aria-hidden="true" />
                  <span>新建用户</span>
                </Button>
              </div>

              {usersQuery.isLoading ? (
                <LoadingPanel label="加载中…" />
              ) : usersQuery.error ? (
                <ErrorPanel
                  title="用户加载失败"
                  error={usersQuery.error}
                  onRetry={() => void usersQuery.refetch()}
                />
              ) : (
                <div className="overflow-x-auto border border-hairline bg-surface">
                  <table className="w-full text-xs">
                    <thead>
                      <tr className="border-b border-hairline bg-subtle/60 text-left text-[11px] text-ink-muted">
                        <th className="px-3 py-2 font-medium">用户名</th>
                        <th className="px-3 py-2 font-medium">显示名称</th>
                        <th className="px-3 py-2 font-medium">角色</th>
                        <th className="px-3 py-2 text-right font-medium">密钥数</th>
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
                                  ? "default"
                                  : u.role === "admin"
                                    ? "outline"
                                    : "secondary"
                              }
                            >
                              {roleLabel(u.role)}
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
          </FadeTransition>
        </TabsContent>

        <TabsContent value="setup">
          <FadeTransition>
            <ClientSetupHelper projects={projects} defaultProjectSlug={selectedProjectSlug} />
          </FadeTransition>
        </TabsContent>
      </Tabs>

      {/* 新建项目弹窗 */}
      <Dialog open={createProjectOpen} onOpenChange={setCreateProjectOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>新建项目</DialogTitle>
            <DialogDescription>创建新的独立项目工作区。</DialogDescription>
          </DialogHeader>
          <form onSubmit={handleCreateProject} className="mt-3 space-y-3">
            {projError ? (
              <div className="border border-red-300 bg-red-50 px-3 py-2 text-xs text-red-900 font-mono">
                {projError}
              </div>
            ) : null}

            <div className="space-y-1">
              <label htmlFor="new-proj-slug" className="block text-xs font-medium text-ink">
                项目标识 (Slug)
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
                名称
              </label>
              <Input
                id="new-proj-name"
                value={newProjName}
                onChange={(e) => setNewProjName(e.target.value)}
                placeholder="核心平台"
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
              />
            </div>

            <div className="space-y-1">
              <label htmlFor="new-proj-budget" className="block text-xs font-medium text-ink">
                Token 预算上限
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
                type="button"
                variant="outline"
                size="sm"
                onClick={() => setCreateProjectOpen(false)}
                disabled={projSaving}
              >
                取消
              </Button>
              <Button type="submit" size="sm" disabled={projSaving}>
                {projSaving ? "正在创建…" : "创建"}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      {/* 新建 API Key 弹窗 */}
      <Dialog open={issueKeyOpen} onOpenChange={setIssueKeyOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>新建密钥（{effectiveKeySlug}）</DialogTitle>
            <DialogDescription>密钥明文仅显示一次，请妥善保存。</DialogDescription>
          </DialogHeader>
          <form onSubmit={handleIssueKey} className="mt-3 space-y-3">
            {keyError ? (
              <div className="border border-red-300 bg-red-50 px-3 py-2 text-xs text-red-900 font-mono">
                {keyError}
              </div>
            ) : null}

            <div className="space-y-1">
              <label htmlFor="issue-key-name" className="block text-xs font-medium text-ink">
                名称
              </label>
              <Input
                id="issue-key-name"
                value={keyName}
                onChange={(e) => {
                  const next = e.target.value;
                  setKeyName(next);
                  setKeyNameError(
                    next.trim() && validateKeyName(next) ? "当前项目已存在同名密钥，请换一个名称。" : null,
                  );
                }}
                placeholder="ci-proposer"
                aria-invalid={keyNameError ? true : undefined}
                aria-describedby={keyNameError ? "issue-key-name-error" : undefined}
                required
              />
              {keyNameError ? (
                <p id="issue-key-name-error" className="text-[11px] text-red-700">
                  {keyNameError}
                </p>
              ) : null}
            </div>

            <div className="space-y-1.5">
              <span className="block text-xs font-medium text-ink">权限范围</span>
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
                  <span>全局多项目密钥（不限定到当前项目）</span>
                </label>

                <div className="space-y-1">
                  <label htmlFor="issue-key-user" className="block text-xs font-medium text-ink">
                    归属用户（可选）
                  </label>
                  <Combobox
                    items={keyUserOptions}
                    value={selectedKeyUser}
                    onValueChange={(next) => setKeyUserId(next?.value ?? "")}
                    itemToStringLabel={(item) => item.label}
                    itemToStringValue={(item) => item.value}
                    isItemEqualToValue={(item, current) => item.value === current.value}
                  >
                    <ComboboxTrigger
                      id="issue-key-user"
                      render={
                        <Button variant="outline" size="sm" className="w-full justify-between font-mono" />
                      }
                    >
                      <ComboboxValue />
                    </ComboboxTrigger>
                    <ComboboxContent>
                      <ComboboxList>
                        {(item) => (
                          <ComboboxItem key={item.value} value={item}>
                            {item.label}
                          </ComboboxItem>
                        )}
                      </ComboboxList>
                    </ComboboxContent>
                  </Combobox>
                </div>
              </>
            ) : null}

            <DialogFooter>
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => setIssueKeyOpen(false)}
                disabled={issueKeyMutation.isPending}
              >
                取消
              </Button>
              <Button type="submit" size="sm" disabled={issueKeyMutation.isPending}>
                {issueKeyMutation.isPending ? "正在生成…" : "生成密钥"}
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
          }
        }}
      >
        <DialogContent className="grid-cols-1 sm:max-w-xl">
          <DialogHeader>
            <DialogTitle>请立即复制保存密钥</DialogTitle>
            <DialogDescription>此明文密钥仅展示这一次，关闭后无法再次查看。</DialogDescription>
          </DialogHeader>

          {issuedSecret ? (
            <div className="mt-3">
              <div className="space-y-2 rounded-lg border border-border bg-muted/40 p-3">
                <div className="flex items-center justify-between gap-2 text-[11px] text-muted-foreground">
                  <span className="truncate font-mono">{issuedSecret.name}</span>
                  <span className="shrink-0 font-mono">
                    {issuedSecret.is_global ? "全局" : issuedSecret.project}
                  </span>
                </div>
                <div className="flex items-center gap-2">
                  <code className="min-w-0 flex-1 overflow-x-auto whitespace-nowrap rounded-md border border-border bg-background px-2.5 py-2 font-mono text-xs leading-relaxed text-foreground select-all">
                    {issuedSecret.api_key}
                  </code>
                  <CopyButton
                    value={issuedSecret.api_key}
                    label="复制密钥"
                    variant="outline"
                    size="icon-sm"
                    className="shrink-0"
                  />
                </div>
              </div>
            </div>
          ) : null}

          <DialogFooter>
            <Button
              size="sm"
              onClick={() => {
                setIssuedSecret(null);
              }}
            >
              我已保存
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
        title="吊销此密钥？"
        description="吊销后立即失效，使用该密钥的客户端将无法再访问服务。"
        confirmLabel="确认吊销"
        variant="destructive"
        pending={revokeKeyMutation.isPending}
        onConfirm={() => void handleRevokeKey()}
        details={
          revokeTarget ? (
            <div className="border border-hairline bg-paper p-3 text-xs font-mono space-y-1">
              <div>名称：{revokeTarget.name}</div>
              <div>前缀：ak-{revokeTarget.key_prefix}-…</div>
            </div>
          ) : null
        }
      />

      {/* 新建用户弹窗 */}
      <Dialog open={createUserOpen} onOpenChange={setCreateUserOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>新建用户</DialogTitle>
            <DialogDescription>创建工作台登录账号。</DialogDescription>
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
              <Combobox
                items={[...USER_ROLE_OPTIONS]}
                value={selectedRole}
                onValueChange={(next) => {
                  if (next) setNewRole(next.value);
                }}
                itemToStringLabel={(item) => item.label}
                itemToStringValue={(item) => item.value}
                isItemEqualToValue={(item, current) => item.value === current.value}
              >
                <ComboboxTrigger
                  id="new-user-role"
                  render={<Button variant="outline" size="sm" className="w-full justify-between" />}
                >
                  <ComboboxValue />
                </ComboboxTrigger>
                <ComboboxContent>
                  <ComboboxList>
                    {(item) => (
                      <ComboboxItem key={item.value} value={item}>
                        {item.label}
                      </ComboboxItem>
                    )}
                  </ComboboxList>
                </ComboboxContent>
              </Combobox>
            </div>

            <DialogFooter>
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => setCreateUserOpen(false)}
                disabled={userSaving}
              >
                取消
              </Button>
              <Button type="submit" size="sm" disabled={userSaving}>
                {userSaving ? "正在创建…" : "创建"}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  );
}
