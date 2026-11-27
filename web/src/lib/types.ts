export type UserRole = "superadmin" | "admin" | "member";

export type RevisionStatus =
  "pending_review" | "approved" | "rejected" | "conflict" | "active" | "superseded";

export type Scope = "mcp:read" | "admin:propose" | "admin:activate" | "admin:platform";

export const ALL_SCOPES: readonly Scope[] = [
  "mcp:read",
  "admin:propose",
  "admin:activate",
  "admin:platform",
] as const;

export interface WebUser {
  id: string;
  username: string;
  display_name: string;
  role: UserRole;
}

export interface Project {
  id: string;
  slug: string;
  name: string;
  description: string;
  token_budget: number;
  active_revision_id: string | null;
}

export interface MeResponse {
  user: WebUser;
  projects: Project[];
  can_approve: boolean;
  can_platform: boolean;
}

export interface DashboardMetrics {
  projects: number;
  active_skills: number;
  tokens_used: number;
  token_budget: number;
  pending_reviews: number;
}

export interface DashboardRecentRow {
  id: string;
  project_slug: string;
  project_name: string;
  status: RevisionStatus;
  commit_message: string;
  token_added: number;
  token_removed: number;
  total_tokens: number;
  created_at: string;
  author: string;
  reviewer: string | null;
  comment: string | null;
  stale: boolean;
  conflict_count: number;
}

export interface EndpointStat {
  endpoint: string;
  calls: number;
  errors: number;
  avg_ms: number;
}

export interface MethodStat {
  method: string;
  calls: number;
  errors: number;
  avg_ms: number;
}

export interface KeyStat {
  api_key_id: string | null;
  key_prefix: string | null;
  key_name: string | null;
  calls: number;
  errors: number;
  last_called_at: string | null;
}

export interface DashboardResponse {
  scope: string | null;
  metrics: DashboardMetrics;
  recent: DashboardRecentRow[];
  stats: {
    endpoints: EndpointStat[];
    methods: MethodStat[];
    keys: KeyStat[];
  };
  projects: Project[];
}

export interface WorkspaceFileView {
  path: string;
  tokens: number;
  size: number;
  sha256: string;
  media_type: string;
  is_text: boolean;
  description: string;
}

export interface WorkspaceResponse {
  project: Project;
  revision_id: string | null;
  files: WorkspaceFileView[];
  tree: string;
  tokens: number;
}

export interface ProjectFileResponse {
  path: string;
  content: string | null;
  url: string | null;
  sha256: string;
  size: number;
  media_type: string;
  is_text: boolean;
  tokens: number | null;
}

export interface Revision {
  id: string;
  project_id: string;
  base_revision_id: string | null;
  merged_against_revision_id: string | null;
  status: RevisionStatus;
  commit_message: string;
  author_user_id: string | null;
  author_api_key_id: string | null;
  token_added: number;
  token_removed: number;
  total_tokens: number;
  file_count: number;
  conflict_summary: unknown;
  review_comment: string | null;
  reviewed_by: string | null;
  reviewed_at: string | null;
  activated_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface RevisionListRow {
  id: string;
  project_slug: string;
  status: RevisionStatus;
  commit_message: string;
  token_added: number;
  token_removed: number;
  total_tokens: number;
  file_count: number;
  created_at: string;
  updated_at: string;
  author: string;
  reviewer: string | null;
  comment: string | null;
  stale: boolean;
  conflict_count: number;
}

export interface ProjectRevisionsResponse {
  revisions: RevisionListRow[];
  project: Project;
}

export type FileChangeType = "added" | "modified" | "deleted" | "unchanged";

export interface RevisionFileView {
  path: string;
  change_type: FileChangeType;
  token_delta: number;
  token_count: number;
  is_text: boolean;
  size_bytes: number;
  blob_id: string;
  sha256: string;
  previous_sha256: string | null;
  base_sha256: string | null;
  active_sha256: string | null;
}

export interface ConflictDetail {
  path: string;
  hunks: number;
  lines: number[];
  base_sha256: string | null;
  active_sha256: string | null;
  incoming_sha256: string | null;
  merged_sha256: string | null;
  preview?: string | null;
}

export interface RevisionDetailResponse {
  revision: Revision;
  project: Project;
  stale: boolean;
  files: RevisionFileView[];
  conflicts: ConflictDetail[];
  author: string;
  reviewer: string | null;
}

export type FileSideName = "base" | "active" | "incoming";

export interface FileSideResponse {
  path: string;
  side: FileSideName;
  content: string | null;
  url: string | null;
  sha256: string | null;
  size_bytes: number;
  is_text: boolean;
  media_type: string | null;
  token_count: number | null;
}

export interface ApiKeyRow {
  id: string;
  name: string;
  key_prefix: string;
  default_project_id: string | null;
  project_slug: string | null;
  is_global: boolean;
  scopes: Scope[];
  revoked_at: string | null;
  expires_at: string | null;
  last_used_at: string | null;
  created_at: string;
  username: string;
}

export interface IssueKeyResponse {
  api_key_id: string;
  api_key: string;
  name: string;
  project: string | null;
  scopes: Scope[];
  is_global: boolean;
  warning: string;
}

export interface UserRow {
  id: string;
  username: string;
  display_name: string;
  role: UserRole;
  created_at: string;
  key_count: number;
}
