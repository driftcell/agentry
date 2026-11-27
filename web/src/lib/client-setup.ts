import type { Scope } from "./types";

export type ClientKind = "claude-code" | "opencode";
export type EndpointMode = "fixed-read" | "slug-read" | "fixed-admin" | "slug-admin";

export interface ClientSetupInput {
  origin: string;
  projectSlug: string;
  mode: EndpointMode;
  scopes: Scope[];
  includeProjectHeader?: boolean;
  serverName?: string;
}

export interface ClientSetupResult {
  allowed: boolean;
  errorReason: string | null;
  url: string;
  requiredScopes: Scope[];
  claudeJson: string;
  claudeCli: string;
  opencodeJson: string;
}

export function hasAdminScope(scopes: readonly Scope[]): boolean {
  return scopes.some((scope) => scope.startsWith("admin:"));
}

export function requiredScopesForMode(mode: EndpointMode): Scope[] {
  if (mode === "fixed-read" || mode === "slug-read") {
    return ["mcp:read"];
  }
  return ["admin:propose", "admin:activate"];
}

export function buildMcpUrl(origin: string, mode: EndpointMode, projectSlug: string): string {
  const base = origin.replace(/\/+$/, "");
  const encodedSlug = encodeURIComponent(projectSlug);
  switch (mode) {
    case "fixed-read":
      return `${base}/mcp`;
    case "slug-read":
      return `${base}/mcp/projects/${encodedSlug}`;
    case "fixed-admin":
      return `${base}/admin/mcp`;
    case "slug-admin":
      return `${base}/admin/mcp/projects/${encodedSlug}`;
  }
}

export function generateClientSetup(input: ClientSetupInput): ClientSetupResult {
  const isAdminMode = input.mode === "fixed-admin" || input.mode === "slug-admin";
  const requiredScopes = requiredScopesForMode(input.mode);
  const url = buildMcpUrl(input.origin, input.mode, input.projectSlug);

  if (isAdminMode && !hasAdminScope(input.scopes)) {
    return {
      allowed: false,
      errorReason: "所选 Scope 不包含任何 admin:* 权限，禁止生成越权的 /admin/mcp 管理端接入配置。",
      url,
      requiredScopes,
      claudeJson: "",
      claudeCli: "",
      opencodeJson: "",
    };
  }

  if (!isAdminMode && !input.scopes.includes("mcp:read")) {
    return {
      allowed: false,
      errorReason: "所选 Scope 不包含 mcp:read，无法生成只读 /mcp 入口配置。",
      url,
      requiredScopes,
      claudeJson: "",
      claudeCli: "",
      opencodeJson: "",
    };
  }

  const rawServerName =
    input.serverName?.trim() ||
    (input.mode === "slug-read"
      ? `agentry-${input.projectSlug}`
      : input.mode === "slug-admin"
        ? `agentry-${input.projectSlug}-admin`
        : isAdminMode
          ? "agentry-admin"
          : "agentry");
  const serverName = rawServerName.replace(/[^a-zA-Z0-9_-]/g, "-") || "agentry";

  const useHeader =
    (input.mode === "fixed-read" || input.mode === "fixed-admin") &&
    Boolean(input.includeProjectHeader) &&
    input.projectSlug.trim().length > 0;

  const claudeHeaders: Record<string, string> = {
    Authorization: "Bearer ${AGENTRY_API_KEY}",
  };
  if (useHeader) {
    claudeHeaders["X-MCP-Project"] = input.projectSlug;
  }

  const claudeJson = JSON.stringify(
    {
      mcpServers: {
        [serverName]: {
          type: "http",
          url,
          headers: claudeHeaders,
        },
      },
    },
    null,
    2,
  );

  const cliHeaderArgs = Object.entries(claudeHeaders)
    .map(([k, v]) => `--header "${k}: ${v}"`)
    .join(" ");
  const claudeCli = `claude mcp add --transport http ${serverName} ${url} ${cliHeaderArgs}`;

  const opencodeHeaders: Record<string, string> = {
    Authorization: "Bearer {env:AGENTRY_API_KEY}",
  };
  if (useHeader) {
    opencodeHeaders["X-MCP-Project"] = input.projectSlug;
  }

  const opencodeJson = JSON.stringify(
    {
      $schema: "https://opencode.ai/config.json",
      mcp: {
        [serverName]: {
          type: "remote",
          url,
          headers: opencodeHeaders,
          enabled: true,
        },
      },
    },
    null,
    2,
  );

  return {
    allowed: true,
    errorReason: null,
    url,
    requiredScopes,
    claudeJson,
    claudeCli,
    opencodeJson,
  };
}
