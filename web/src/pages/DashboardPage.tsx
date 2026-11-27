import { useState } from "react";
import { Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { ArrowUpRight, RefreshCw } from "lucide-react";
import { StatusBadge } from "@/components/StatusBadge";
import { EmptyPanel, ErrorPanel, LoadingPanel } from "@/components/StateViews";
import { TokenDelta } from "@/components/TokenDelta";
import { Button } from "@/components/ui/button";
import { Select } from "@/components/ui/input";
import { api } from "@/lib/api";
import { useAuth } from "@/lib/auth-context";
import {
  firstLine,
  formatLatencyMs,
  formatRelativeTime,
  formatTimestamp,
  formatTokens,
  shortUuid,
} from "@/lib/format";
import { cn } from "@/lib/utils";

export function DashboardPage() {
  const { projects } = useAuth();
  const [scopeSlug, setScopeSlug] = useState<string>("");

  const query = useQuery({
    queryKey: ["dashboard", scopeSlug || "__all__"],
    queryFn: () => api.dashboard(scopeSlug || undefined),
  });

  const data = query.data;
  const budgetPct =
    data && data.metrics.token_budget > 0
      ? Math.min(100, Math.round((data.metrics.tokens_used / data.metrics.token_budget) * 100))
      : 0;

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-hairline pb-3">
        <h1 className="text-base font-semibold tracking-tight text-ink">概览</h1>

        <div className="flex items-center gap-2">
          <Select
            id="dashboard-scope"
            aria-label="统计范围"
            value={scopeSlug}
            onChange={(e) => setScopeSlug(e.target.value)}
            className="h-7 min-w-[160px] font-mono"
          >
            <option value="">全部项目 ({projects.length})</option>
            {projects.map((p) => (
              <option key={p.id} value={p.slug}>
                {p.slug}
              </option>
            ))}
          </Select>
          <Button
            variant="outline"
            size="sm"
            onClick={() => void query.refetch()}
            disabled={query.isFetching}
            aria-label="刷新概览"
          >
            <RefreshCw
              className={cn("h-3.5 w-3.5", query.isFetching && "animate-spin")}
              aria-hidden="true"
            />
            <span>刷新</span>
          </Button>
        </div>
      </div>

      {query.isLoading ? (
        <LoadingPanel label="加载中…" />
      ) : query.error ? (
        <ErrorPanel
          title="概览数据加载失败"
          error={query.error}
          onRetry={() => void query.refetch()}
        />
      ) : data ? (
        <>
          <section
            aria-label="核心指标"
            className="grid grid-cols-2 lg:grid-cols-4 border border-hairline bg-surface divide-y lg:divide-y-0 divide-x divide-hairline"
          >
            <div className="px-4 py-3.5">
              <div className="flex items-baseline justify-between gap-2">
                <span className="text-xs text-ink-muted">项目数</span>
                <span className="font-mono text-[11px] text-ink-muted">{data.scope ?? "全部"}</span>
              </div>
              <p className="mono-num mt-1.5 text-2xl font-semibold text-ink">
                {formatTokens(data.metrics.projects)}
              </p>
            </div>

            <div className="px-4 py-3.5">
              <div className="flex items-baseline justify-between gap-2">
                <span className="text-xs text-ink-muted">生效 Skills</span>
                <span className="font-mono text-[11px] text-ink-muted">SKILL.md</span>
              </div>
              <p className="mono-num mt-1.5 text-2xl font-semibold text-ink">
                {formatTokens(data.metrics.active_skills)}
              </p>
            </div>

            <div className="px-4 py-3.5">
              <div className="flex items-baseline justify-between gap-2">
                <span className="text-xs text-ink-muted">Token 预算使用</span>
                <span className="mono-num text-[11px] font-medium text-ink">{budgetPct}%</span>
              </div>
              <p className="mono-num mt-1.5 text-xl font-semibold text-ink">
                {formatTokens(data.metrics.tokens_used)}
                <span className="text-xs font-normal text-ink-muted">
                  {" "}
                  / {formatTokens(data.metrics.token_budget)}
                </span>
              </p>
              <div
                className="mt-2 h-1.5 w-full bg-zinc-200 overflow-hidden"
                role="progressbar"
                aria-valuenow={budgetPct}
                aria-valuemin={0}
                aria-valuemax={100}
                aria-label="Token 预算使用率"
              >
                <div
                  className={cn(
                    "h-full transition-all",
                    budgetPct >= 90
                      ? "bg-red-700"
                      : budgetPct >= 75
                        ? "bg-amber-600"
                        : "bg-zinc-950",
                  )}
                  style={{ width: `${budgetPct}%` }}
                />
              </div>
            </div>

            <div className="px-4 py-3.5">
              <div className="flex items-baseline justify-between gap-2">
                <span className="text-xs text-ink-muted">待审批</span>
                <Link
                  to="/review"
                  className="inline-flex items-center gap-0.5 text-xs text-ink underline underline-offset-2 hover:text-ink-secondary"
                >
                  去处理
                  <ArrowUpRight className="h-3 w-3" aria-hidden="true" />
                </Link>
              </div>
              <p className="mono-num mt-1.5 text-2xl font-semibold text-ink">
                {formatTokens(data.metrics.pending_reviews)}
              </p>
            </div>
          </section>

          <div className="grid grid-cols-1 xl:grid-cols-12 border border-hairline bg-surface divide-y xl:divide-y-0 xl:divide-x divide-hairline">
            <section aria-label="最近修订动态" className="xl:col-span-7 flex flex-col">
              <div className="flex items-center justify-between border-b border-hairline px-4 py-2.5 bg-subtle/60">
                <h2 className="text-xs font-semibold text-ink">最近修订</h2>
                <Link
                  to="/review"
                  className="text-xs text-ink-secondary hover:text-ink underline underline-offset-2"
                >
                  全部
                </Link>
              </div>

              {data.recent.length === 0 ? (
                <div className="p-4">
                  <EmptyPanel title="暂无修订记录" />
                </div>
              ) : (
                <ul className="divide-y divide-hairline">
                  {data.recent.map((row) => (
                    <li key={row.id} className="px-4 py-3 hover:bg-subtle/40 transition-colors">
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <div className="flex flex-wrap items-center gap-2">
                          <StatusBadge
                            status={row.status}
                            stale={row.stale}
                            conflictCount={row.conflict_count}
                          />
                          <span className="font-mono text-xs font-medium text-ink">
                            {row.project_slug}
                          </span>
                          <code className="mono-num text-[11px] text-ink-muted">
                            {shortUuid(row.id)}
                          </code>
                        </div>

                        <div className="flex items-center gap-3">
                          <TokenDelta added={row.token_added} removed={row.token_removed} />
                          <span
                            title={formatTimestamp(row.created_at)}
                            className="mono-num text-[11px] text-ink-muted"
                          >
                            {formatRelativeTime(row.created_at)}
                          </span>
                        </div>
                      </div>

                      <div className="mt-1.5 flex items-start justify-between gap-3">
                        <Link
                          to="/revisions/$revisionId"
                          params={{ revisionId: row.id }}
                          className="text-xs font-medium text-ink hover:underline underline-offset-2 leading-snug"
                        >
                          {firstLine(row.commit_message)}
                        </Link>
                        <span className="mono-num shrink-0 text-[11px] text-ink-muted">
                          {formatTokens(row.total_tokens)} tok
                        </span>
                      </div>

                      <div className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-ink-secondary">
                        <span>
                          提交：<code className="text-ink">{row.author}</code>
                        </span>
                        {row.reviewer ? (
                          <span>
                            审批：<code className="text-ink">{row.reviewer}</code>
                          </span>
                        ) : null}
                        {row.comment ? (
                          <span className="text-ink-muted truncate max-w-md">“{row.comment}”</span>
                        ) : null}
                      </div>
                    </li>
                  ))}
                </ul>
              )}
            </section>

            <section aria-label="调用统计" className="xl:col-span-5 flex flex-col">
              <div className="border-b border-hairline px-4 py-2.5 bg-subtle/60">
                <h2 className="text-xs font-semibold text-ink">调用统计（近 30 天）</h2>
              </div>

              <div className="divide-y divide-hairline">
                <div className="p-4">
                  <h3 className="text-xs font-medium text-ink-muted mb-2">入口</h3>
                  {data.stats.endpoints.length === 0 ? (
                    <p className="text-xs text-ink-muted">暂无调用记录</p>
                  ) : (
                    <table className="w-full text-xs">
                      <thead>
                        <tr className="border-b border-hairline text-left text-[11px] text-ink-muted">
                          <th className="py-1 font-medium">路径</th>
                          <th className="py-1 text-right font-medium">次数</th>
                          <th className="py-1 text-right font-medium">失败</th>
                          <th className="py-1 text-right font-medium">平均耗时</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-hairline">
                        {data.stats.endpoints.map((ep) => (
                          <tr key={ep.endpoint}>
                            <td className="py-1.5 font-mono text-ink">/{ep.endpoint}</td>
                            <td className="py-1.5 text-right mono-num">{formatTokens(ep.calls)}</td>
                            <td
                              className={cn(
                                "py-1.5 text-right mono-num",
                                ep.errors > 0 ? "text-red-700 font-medium" : "text-ink-muted",
                              )}
                            >
                              {formatTokens(ep.errors)}
                            </td>
                            <td className="py-1.5 text-right mono-num text-ink-secondary">
                              {formatLatencyMs(ep.avg_ms)}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  )}
                </div>

                <div className="p-4">
                  <h3 className="text-xs font-medium text-ink-muted mb-2">API Key</h3>
                  {data.stats.keys.length === 0 ? (
                    <p className="text-xs text-ink-muted">暂无密钥调用</p>
                  ) : (
                    <div className="overflow-x-auto">
                      <table className="w-full text-xs">
                        <thead>
                          <tr className="border-b border-hairline text-left text-[11px] text-ink-muted">
                            <th className="py-1 font-medium">密钥</th>
                            <th className="py-1 text-right font-medium">次数</th>
                            <th className="py-1 text-right font-medium">失败</th>
                            <th className="py-1 text-right font-medium">最近调用</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-hairline">
                          {data.stats.keys.map((k, idx) => (
                            <tr key={k.api_key_id ?? `anon-${idx}`}>
                              <td className="py-1.5">
                                <div className="font-medium text-ink">{k.key_name ?? "未认证"}</div>
                                {k.key_prefix ? (
                                  <div className="font-mono text-[11px] text-ink-muted">
                                    mreg_{k.key_prefix}…
                                  </div>
                                ) : null}
                              </td>
                              <td className="py-1.5 text-right mono-num">
                                {formatTokens(k.calls)}
                              </td>
                              <td
                                className={cn(
                                  "py-1.5 text-right mono-num",
                                  k.errors > 0 ? "text-red-700 font-medium" : "text-ink-muted",
                                )}
                              >
                                {formatTokens(k.errors)}
                              </td>
                              <td className="py-1.5 text-right mono-num text-ink-muted">
                                {formatRelativeTime(k.last_called_at)}
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  )}
                </div>

                <div className="p-4">
                  <h3 className="text-xs font-medium text-ink-muted mb-2">热门方法</h3>
                  {data.stats.methods.length === 0 ? (
                    <p className="text-xs text-ink-muted">暂无方法调用</p>
                  ) : (
                    <table className="w-full text-xs">
                      <thead>
                        <tr className="border-b border-hairline text-left text-[11px] text-ink-muted">
                          <th className="py-1 font-medium">方法</th>
                          <th className="py-1 text-right font-medium">次数</th>
                          <th className="py-1 text-right font-medium">平均耗时</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-hairline">
                        {data.stats.methods.map((m) => (
                          <tr key={m.method}>
                            <td className="py-1.5 font-mono text-ink">{m.method}</td>
                            <td className="py-1.5 text-right mono-num">{formatTokens(m.calls)}</td>
                            <td className="py-1.5 text-right mono-num text-ink-secondary">
                              {formatLatencyMs(m.avg_ms)}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  )}
                </div>
              </div>
            </section>
          </div>
        </>
      ) : null}
    </div>
  );
}
