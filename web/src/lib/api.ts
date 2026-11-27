import type {
  ApiKeyRow,
  DashboardResponse,
  FileSideName,
  FileSideResponse,
  IssueKeyResponse,
  MeResponse,
  Project,
  ProjectFileResponse,
  ProjectRevisionsResponse,
  Revision,
  RevisionDetailResponse,
  RevisionStatus,
  Scope,
  UserRole,
  UserRow,
  WebUser,
  WorkspaceResponse,
} from "./types";

export class ApiError extends Error {
  readonly status: number;
  readonly code: string;

  constructor(status: number, code: string, message: string) {
    super(message);
    this.name = "ApiError";
    this.status = status;
    this.code = code;
  }
}

type UnauthorizedListener = () => void;
const unauthorizedListeners = new Set<UnauthorizedListener>();

export function onUnauthorized(listener: UnauthorizedListener): () => void {
  unauthorizedListeners.add(listener);
  return () => {
    unauthorizedListeners.delete(listener);
  };
}

function notifyUnauthorized(): void {
  for (const listener of unauthorizedListeners) {
    listener();
  }
}

async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
  const headers = new Headers(init.headers);
  if (init.body !== undefined && !headers.has("Content-Type")) {
    headers.set("Content-Type", "application/json");
  }
  const response = await fetch(path, {
    ...init,
    credentials: "same-origin",
    headers,
  });

  const text = await response.text();
  let parsed: unknown = null;
  if (text.length > 0) {
    try {
      parsed = JSON.parse(text);
    } catch {
      parsed = null;
    }
  }

  if (!response.ok) {
    const errObj =
      parsed && typeof parsed === "object" && "error" in parsed
        ? (parsed as { error?: { code?: unknown; message?: unknown } }).error
        : undefined;
    const code = typeof errObj?.code === "string" ? errObj.code : `HTTP_${response.status}`;
    const message =
      typeof errObj?.message === "string"
        ? errObj.message
        : response.statusText || "request failed";

    if (response.status === 401 && !path.startsWith("/api/auth/login")) {
      notifyUnauthorized();
    }
    throw new ApiError(response.status, code, message);
  }

  return parsed as T;
}

export const api = {
  login(username: string, password: string): Promise<{ user: WebUser }> {
    return request<{ user: WebUser }>("/api/auth/login", {
      method: "POST",
      body: JSON.stringify({ username, password }),
    });
  },

  logout(): Promise<{ ok: boolean }> {
    return request<{ ok: boolean }>("/api/auth/logout", {
      method: "POST",
    });
  },

  me(): Promise<MeResponse> {
    return request<MeResponse>("/api/auth/me");
  },

  dashboard(projectSlug?: string): Promise<DashboardResponse> {
    const query = projectSlug ? `?project=${encodeURIComponent(projectSlug)}` : "";
    return request<DashboardResponse>(`/api/dashboard${query}`);
  },

  listProjects(): Promise<{ projects: Project[] }> {
    return request<{ projects: Project[] }>("/api/projects");
  },

  createProject(input: {
    slug: string;
    name: string;
    description?: string;
    token_budget?: number;
  }): Promise<{ project: Project }> {
    return request<{ project: Project }>("/api/projects", {
      method: "POST",
      body: JSON.stringify(input),
    });
  },

  deleteProject(slug: string): Promise<{ deleted: boolean; project: { id: string; slug: string } }> {
    return request<{ deleted: boolean; project: { id: string; slug: string } }>(
      `/api/projects/${encodeURIComponent(slug)}`,
      { method: "DELETE" },
    );
  },

  projectDetail(slug: string): Promise<{ project: Project; active_revision: Revision | null }> {
    return request<{ project: Project; active_revision: Revision | null }>(
      `/api/projects/${encodeURIComponent(slug)}`,
    );
  },

  workspace(slug: string): Promise<WorkspaceResponse> {
    return request<WorkspaceResponse>(`/api/projects/${encodeURIComponent(slug)}/workspace`);
  },

  projectFile(slug: string, path: string): Promise<ProjectFileResponse> {
    return request<ProjectFileResponse>(
      `/api/projects/${encodeURIComponent(slug)}/file?path=${encodeURIComponent(path)}`,
    );
  },

  projectRevisions(slug: string, statuses?: RevisionStatus[]): Promise<ProjectRevisionsResponse> {
    const query =
      statuses && statuses.length > 0 ? `?status=${encodeURIComponent(statuses.join(","))}` : "";
    return request<ProjectRevisionsResponse>(
      `/api/projects/${encodeURIComponent(slug)}/revisions${query}`,
    );
  },

  revisionDetail(id: string): Promise<RevisionDetailResponse> {
    return request<RevisionDetailResponse>(`/api/revisions/${encodeURIComponent(id)}`);
  },

  revisionFile(id: string, path: string, side: FileSideName): Promise<FileSideResponse> {
    return request<FileSideResponse>(
      `/api/revisions/${encodeURIComponent(id)}/file?path=${encodeURIComponent(path)}&side=${encodeURIComponent(side)}`,
    );
  },

  approveRevision(
    id: string,
    input: { comment?: string; activate_now?: boolean },
  ): Promise<{ revision: Revision }> {
    return request<{ revision: Revision }>(`/api/revisions/${encodeURIComponent(id)}/approve`, {
      method: "POST",
      body: JSON.stringify(input),
    });
  },

  rebaseRevision(id: string): Promise<{ revision: Revision }> {
    return request<{ revision: Revision }>(`/api/revisions/${encodeURIComponent(id)}/rebase`, {
      method: "POST",
    });
  },

  rejectRevision(id: string, input: { comment?: string }): Promise<{ revision: Revision }> {
    return request<{ revision: Revision }>(`/api/revisions/${encodeURIComponent(id)}/reject`, {
      method: "POST",
      body: JSON.stringify(input),
    });
  },

  resolveRevision(
    id: string,
    input: {
      resolutions: Array<{ path: string; content?: string; oss_key?: string }>;
      commit_message?: string;
    },
  ): Promise<{ revision: Revision }> {
    return request<{ revision: Revision }>(`/api/revisions/${encodeURIComponent(id)}/resolve`, {
      method: "POST",
      body: JSON.stringify(input),
    });
  },

  listProjectKeys(slug: string): Promise<{ keys: ApiKeyRow[]; project: Project }> {
    return request<{ keys: ApiKeyRow[]; project: Project }>(
      `/api/projects/${encodeURIComponent(slug)}/keys`,
    );
  },

  issueProjectKey(
    slug: string,
    input: { name: string; scopes: Scope[]; user_id?: string; is_global?: boolean },
  ): Promise<IssueKeyResponse> {
    return request<IssueKeyResponse>(`/api/projects/${encodeURIComponent(slug)}/keys`, {
      method: "POST",
      body: JSON.stringify(input),
    });
  },

  revokeKey(id: string): Promise<{ api_key_id: string; revoked: boolean }> {
    return request<{ api_key_id: string; revoked: boolean }>(
      `/api/keys/${encodeURIComponent(id)}/revoke`,
      { method: "POST" },
    );
  },

  listUsers(): Promise<{ users: UserRow[] }> {
    return request<{ users: UserRow[] }>("/api/users");
  },

  createUser(input: {
    username: string;
    display_name?: string;
    password: string;
    role: UserRole;
  }): Promise<{ user: { id: string; username: string; display_name: string; role: UserRole } }> {
    return request("/api/users", {
      method: "POST",
      body: JSON.stringify(input),
    });
  },
};
