import { createContext, use, useMemo, useState, type ReactNode } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api, ApiError } from "@/lib/api";
import type { ApiKeyRow, IssueKeyResponse, Scope } from "@/lib/types";
import { usePlatform } from "./PlatformProvider";
import { roleLabel } from "./types";

type Option = { value: string; label: string };

interface ApiKeysState {
  keys: ApiKeyRow[];
  keysLoading: boolean;
  keysError: unknown;
  keysUpdatedAt: number;
  keysFetching: boolean;
  issueOpen: boolean;
  name: string;
  nameError: string | null;
  scopes: Scope[];
  isGlobal: boolean;
  userId: string;
  formError: string | null;
  issuedSecret: IssueKeyResponse | null;
  revokeTarget: ApiKeyRow | null;
}

interface ApiKeysActions {
  setProjectSlug: (slug: string) => void;
  refetchKeys: () => void;
  openIssue: () => void;
  closeIssue: () => void;
  setName: (value: string) => void;
  toggleScope: (scope: Scope) => void;
  setIsGlobal: (value: boolean) => void;
  setUserId: (value: string) => void;
  submitIssue: () => void;
  closeIssued: () => void;
  requestRevoke: (key: ApiKeyRow) => void;
  cancelRevoke: () => void;
  confirmRevoke: () => void;
}

interface ApiKeysMeta {
  canApprove: boolean;
  canPlatform: boolean;
  effectiveKeySlug: string;
  projectOptions: Option[];
  selectedProject: Option | null;
  userOptions: Option[];
  selectedUser: Option | null;
  isIssuing: boolean;
  isRevoking: boolean;
}

interface ApiKeysContextValue {
  state: ApiKeysState;
  actions: ApiKeysActions;
  meta: ApiKeysMeta;
}

const ApiKeysContext = createContext<ApiKeysContextValue | null>(null);

export function useApiKeys() {
  const context = use(ApiKeysContext);
  if (!context) {
    throw new Error("useApiKeys must be used within ApiKeysProvider");
  }
  return context;
}

const DUPLICATE_NAME = "当前项目已存在同名密钥，请换一个名称。";

export function ApiKeysProvider({ children }: { children: ReactNode }) {
  const { actions: platformActions, meta: platformMeta } = usePlatform();
  const queryClient = useQueryClient();

  const effectiveKeySlug = platformMeta.effectiveKeySlug;
  const projectOptions = useMemo(
    () => platformMeta.projects.map((project) => ({ value: project.slug, label: project.slug })),
    [platformMeta.projects],
  );
  const selectedProject =
    projectOptions.find((option) => option.value === effectiveKeySlug) ?? null;

  const [issueOpen, setIssueOpen] = useState(false);
  const [name, setName] = useState("");
  const [nameError, setNameError] = useState<string | null>(null);
  const [scopes, setScopes] = useState<Scope[]>(["mcp:read"]);
  const [isGlobal, setIsGlobal] = useState(false);
  const [userId, setUserId] = useState("");
  const [formError, setFormError] = useState<string | null>(null);
  const [issuedSecret, setIssuedSecret] = useState<IssueKeyResponse | null>(null);
  const [revokeTarget, setRevokeTarget] = useState<ApiKeyRow | null>(null);

  const keysQuery = useQuery({
    queryKey: ["project-keys", effectiveKeySlug],
    queryFn: () => api.listProjectKeys(effectiveKeySlug),
    enabled: platformMeta.canApprove && Boolean(effectiveKeySlug),
  });

  const usersQuery = useQuery({
    queryKey: ["users"],
    queryFn: () => api.listUsers(),
    enabled: platformMeta.canPlatform && issueOpen,
  });

  const existingKeyNames = useMemo(
    () => new Set((keysQuery.data?.keys ?? []).map((key) => key.name.trim().toLowerCase())),
    [keysQuery.data?.keys],
  );

  const validateName = (value: string): string | null => {
    const trimmed = value.trim();
    if (!trimmed) return "请填写密钥名称。";
    if (existingKeyNames.has(trimmed.toLowerCase())) return DUPLICATE_NAME;
    return null;
  };

  const issueMutation = useMutation({
    mutationFn: (input: { name: string; scopes: Scope[]; user_id?: string; is_global: boolean }) =>
      api.issueProjectKey(effectiveKeySlug, input),
    onSuccess: (result) => {
      setIssueOpen(false);
      setName("");
      setNameError(null);
      setScopes(["mcp:read"]);
      setIsGlobal(false);
      setUserId("");
      setFormError(null);
      setIssuedSecret(result);
      void queryClient.invalidateQueries({ queryKey: ["project-keys", effectiveKeySlug] });
    },
    onError: (err) => {
      setFormError(err instanceof ApiError ? `${err.code}: ${err.message}` : "签发失败。");
    },
  });

  const revokeMutation = useMutation({
    mutationFn: (id: string) => api.revokeKey(id),
    onSuccess: () => {
      setRevokeTarget(null);
      void queryClient.invalidateQueries({ queryKey: ["project-keys", effectiveKeySlug] });
    },
    onError: (err) => {
      setRevokeTarget(null);
      setFormError(err instanceof ApiError ? `${err.code}: ${err.message}` : "吊销失败。");
    },
  });

  const userOptions = [
    { value: "", label: "当前登录用户" },
    ...(usersQuery.data?.users ?? []).map((user) => ({
      value: user.id,
      label: `${user.username} (${roleLabel(user.role)})`,
    })),
  ];
  const selectedUser = userOptions.find((option) => option.value === userId) ?? null;

  const actions: ApiKeysActions = {
    setProjectSlug: platformActions.setKeyProjectSlug,
    refetchKeys: () => void keysQuery.refetch(),
    openIssue: () => {
      setFormError(null);
      setNameError(null);
      setIssueOpen(true);
    },
    closeIssue: () => setIssueOpen(false),
    setName: (value) => {
      setName(value);
      setNameError(value.trim() ? validateName(value) : null);
    },
    toggleScope: (scope) =>
      setScopes((prev) =>
        prev.includes(scope) ? prev.filter((item) => item !== scope) : [...prev, scope],
      ),
    setIsGlobal,
    setUserId,
    submitIssue: () => {
      const nextNameError = validateName(name);
      if (nextNameError) {
        setNameError(nextNameError);
        return;
      }
      if (scopes.length === 0) {
        setFormError("请至少选择一个权限范围。");
        return;
      }
      setFormError(null);
      setNameError(null);
      issueMutation.mutate({
        name: name.trim(),
        scopes,
        is_global: platformMeta.canPlatform ? isGlobal : false,
        user_id: platformMeta.canPlatform && userId ? userId : undefined,
      });
    },
    closeIssued: () => setIssuedSecret(null),
    requestRevoke: setRevokeTarget,
    cancelRevoke: () => setRevokeTarget(null),
    confirmRevoke: () => {
      if (revokeTarget) revokeMutation.mutate(revokeTarget.id);
    },
  };

  return (
    <ApiKeysContext
      value={{
        state: {
          keys: keysQuery.data?.keys ?? [],
          keysLoading: keysQuery.isLoading,
          keysError: keysQuery.error,
          keysUpdatedAt: keysQuery.dataUpdatedAt,
          keysFetching: keysQuery.isFetching,
          issueOpen,
          name,
          nameError,
          scopes,
          isGlobal,
          userId,
          formError,
          issuedSecret,
          revokeTarget,
        },
        actions,
        meta: {
          canApprove: platformMeta.canApprove,
          canPlatform: platformMeta.canPlatform,
          effectiveKeySlug,
          projectOptions,
          selectedProject,
          userOptions,
          selectedUser,
          isIssuing: issueMutation.isPending,
          isRevoking: revokeMutation.isPending,
        },
      }}
    >
      {children}
    </ApiKeysContext>
  );
}
