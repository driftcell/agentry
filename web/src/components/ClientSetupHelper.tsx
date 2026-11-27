import { useMemo, useState } from "react";
import { AlertCircle, Check, Copy, Terminal } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input, Select } from "@/components/ui/input";
import { generateClientSetup, hasAdminScope, type EndpointMode } from "@/lib/client-setup";
import { ALL_SCOPES, type Project, type Scope } from "@/lib/types";
import { cn } from "@/lib/utils";

interface ClientSetupHelperProps {
  projects: Project[];
  defaultProjectSlug: string;
}

const ENDPOINT_OPTIONS: ReadonlyArray<{
  mode: EndpointMode;
  label: string;
  pathHint: string;
  adminOnly: boolean;
}> = [
  {
    mode: "fixed-read",
    label: "标准只读 (/mcp)",
    pathHint: "自动使用密钥绑定的默认项目",
    adminOnly: false,
  },
  {
    mode: "slug-read",
    label: "指定项目只读 (/mcp/projects/{slug})",
    pathHint: "同一客户端挂载多个项目时使用",
    adminOnly: false,
  },
  {
    mode: "fixed-admin",
    label: "标准管理 (/admin/mcp)",
    pathHint: "提交修订提案、解决冲突与激活",
    adminOnly: true,
  },
  {
    mode: "slug-admin",
    label: "指定项目管理 (/admin/mcp/projects/{slug})",
    pathHint: "固定管理单个项目",
    adminOnly: true,
  },
];

function CopyBlock({ title, code }: { title: string; code: string }) {
  const [copied, setCopied] = useState(false);

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(code);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1500);
    } catch {
      // Clipboard may be unavailable.
    }
  };

  return (
    <div className="border border-hairline bg-surface">
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-hairline bg-subtle/50 px-3 py-2">
        <p className="font-mono text-xs font-semibold text-ink">{title}</p>
        <Button variant="outline" size="xs" onClick={() => void handleCopy()}>
          {copied ? (
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
      <pre className="p-3 font-mono text-xs leading-relaxed text-ink overflow-x-auto whitespace-pre">
        {code}
      </pre>
    </div>
  );
}

export function ClientSetupHelper({ projects, defaultProjectSlug }: ClientSetupHelperProps) {
  const origin = typeof window !== "undefined" ? window.location.origin : "http://localhost:8080";
  const [projectSlug, setProjectSlug] = useState(
    defaultProjectSlug || projects[0]?.slug || "default",
  );
  const [mode, setMode] = useState<EndpointMode>("fixed-read");
  const [scopes, setScopes] = useState<Scope[]>(["mcp:read"]);
  const [includeHeader, setIncludeHeader] = useState(false);
  const [serverName, setServerName] = useState("");

  const adminEnabled = hasAdminScope(scopes);

  const toggleScope = (scope: Scope) => {
    setScopes((prev) => {
      const next = prev.includes(scope) ? prev.filter((s) => s !== scope) : [...prev, scope];
      if (!hasAdminScope(next) && (mode === "fixed-admin" || mode === "slug-admin")) {
        setMode("fixed-read");
      }
      return next;
    });
  };

  const setup = useMemo(
    () =>
      generateClientSetup({
        origin,
        projectSlug,
        mode,
        scopes,
        includeProjectHeader: includeHeader,
        serverName,
      }),
    [origin, projectSlug, mode, scopes, includeHeader, serverName],
  );

  return (
    <div className="space-y-4">
      <div className="border border-hairline bg-surface p-4 space-y-4">
        <h2 className="text-sm font-semibold text-ink border-b border-hairline pb-2.5">
          生成客户端配置
        </h2>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <div className="space-y-1.5">
            <label htmlFor="setup-project" className="block text-xs text-ink-muted">
              项目
            </label>
            <Select
              id="setup-project"
              value={projectSlug}
              onChange={(e) => setProjectSlug(e.target.value)}
              className="w-full font-mono"
            >
              {projects.length > 0 ? (
                projects.map((p) => (
                  <option key={p.id} value={p.slug}>
                    {p.slug}
                  </option>
                ))
              ) : (
                <option value="default">default</option>
              )}
            </Select>
          </div>

          <div className="space-y-1.5">
            <label htmlFor="setup-server-name" className="block text-xs text-ink-muted">
              配置名称（可选）
            </label>
            <Input
              id="setup-server-name"
              value={serverName}
              onChange={(e) => setServerName(e.target.value)}
              placeholder="agentry"
              className="font-mono"
            />
          </div>

          <div className="space-y-1.5">
            <span className="block text-xs text-ink-muted">密钥权限 (Scopes)</span>
            <div className="flex flex-wrap gap-1.5 pt-0.5">
              {ALL_SCOPES.map((scope) => {
                const checked = scopes.includes(scope);
                return (
                  <button
                    key={scope}
                    type="button"
                    aria-pressed={checked}
                    onClick={() => toggleScope(scope)}
                    className={cn(
                      "rounded-sm border px-2 py-1 font-mono text-[11px] cursor-pointer transition-colors",
                      checked
                        ? "border-zinc-950 bg-zinc-950 text-zinc-50"
                        : "border-zinc-300 bg-white text-ink-secondary hover:border-zinc-400",
                    )}
                  >
                    {scope}
                  </button>
                );
              })}
            </div>
          </div>
        </div>

        <div className="space-y-2">
          <span className="block text-xs text-ink-muted">接入方式</span>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-2">
            {ENDPOINT_OPTIONS.map((opt) => {
              const disabled = opt.adminOnly && !adminEnabled;
              const selected = mode === opt.mode;
              return (
                <button
                  key={opt.mode}
                  type="button"
                  disabled={disabled}
                  onClick={() => setMode(opt.mode)}
                  aria-pressed={selected}
                  className={cn(
                    "text-left rounded-sm border p-2.5 transition-colors space-y-1",
                    disabled
                      ? "border-hairline bg-subtle/60 text-ink-muted opacity-55 cursor-not-allowed"
                      : selected
                        ? "border-zinc-950 bg-zinc-950 text-zinc-50 cursor-pointer"
                        : "border-hairline bg-white text-ink hover:border-zinc-400 cursor-pointer",
                  )}
                >
                  <div className="font-mono text-xs font-semibold">{opt.label}</div>
                  <div
                    className={cn(
                      "text-[11px] leading-snug",
                      selected ? "text-zinc-300" : "text-ink-muted",
                    )}
                  >
                    {disabled ? "需先选择管理权限 (admin:*)" : opt.pathHint}
                  </div>
                </button>
              );
            })}
          </div>
        </div>

        {mode === "fixed-read" || mode === "fixed-admin" ? (
          <label className="inline-flex items-center gap-2 text-xs text-ink cursor-pointer">
            <input
              type="checkbox"
              checked={includeHeader}
              onChange={(e) => setIncludeHeader(e.target.checked)}
              className="rounded-sm border-zinc-400"
            />
            <span>
              附加指定项目请求头 (<code className="font-mono">X-MCP-Project: {projectSlug}</code>)
            </span>
          </label>
        ) : null}
      </div>

      {!setup.allowed ? (
        <div
          role="alert"
          className="flex items-start gap-2 border border-amber-400 bg-amber-50 px-4 py-3 text-xs text-amber-950"
        >
          <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
          <span>{setup.errorReason}</span>
        </div>
      ) : (
        <div className="space-y-3">
          <div className="flex flex-wrap items-center justify-between gap-2 border border-hairline bg-subtle/40 px-3 py-2 text-xs font-mono">
            <span className="flex items-center gap-1.5 text-ink">
              <Terminal className="h-3.5 w-3.5" aria-hidden="true" />
              <span>地址：{setup.url}</span>
            </span>
            <span className="text-ink-muted">令牌请配置环境变量 AGENTRY_API_KEY</span>
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            <CopyBlock title="Claude Code (.mcp.json)" code={setup.claudeJson} />
            <CopyBlock title="OpenCode (opencode.json)" code={setup.opencodeJson} />
          </div>

          <CopyBlock title="Claude Code 命令行" code={setup.claudeCli} />
        </div>
      )}
    </div>
  );
}
