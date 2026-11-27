import { useState, type FormEvent } from "react";
import { AlertCircle, ArrowRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ApiError } from "@/lib/api";
import { useAuth } from "@/lib/auth-context";

export function LoginPage({ onSuccess }: { onSuccess?: () => void }) {
  const { login } = useAuth();
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const handleSubmit = async (event: FormEvent) => {
    event.preventDefault();
    const trimmedUser = username.trim();
    if (!trimmedUser || !password) {
      setErrorMessage("请输入用户名和密码。");
      return;
    }
    setSubmitting(true);
    setErrorMessage(null);
    try {
      await login(trimmedUser, password);
      onSuccess?.();
    } catch (err) {
      if (err instanceof ApiError) {
        setErrorMessage(err.message);
      } else {
        setErrorMessage("无法完成登录，请确认服务端运行正常后重试。");
      }
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="min-h-screen bg-paper text-ink flex flex-col justify-between px-4 py-8">
      <div className="mx-auto w-full max-w-[400px] pt-10 sm:pt-20">
        <div className="border-b border-ink pb-4 mb-6">
          <div className="flex items-baseline justify-between">
            <h1 className="font-mono text-lg font-bold tracking-tight">AGENTRY</h1>
            <span className="font-mono text-[11px] text-ink-muted">MCP 注册中心</span>
          </div>
          <p className="mt-1.5 text-xs text-ink-secondary leading-relaxed">
            面向人类管理员的 MCP 活跃版本审阅、工作区浏览与密钥治理工作台。
          </p>
        </div>

        <form onSubmit={handleSubmit} className="space-y-4 border border-hairline bg-surface p-5">
          <div>
            <h2 className="text-sm font-semibold text-ink">登录工作台</h2>
            <p className="mt-0.5 text-xs text-ink-muted">
              使用人类 Web 会话 Cookie 登录；API Key 仅用于 MCP 客户端调用。
            </p>
          </div>

          {errorMessage ? (
            <div
              role="alert"
              className="flex items-start gap-2 border border-red-300 bg-red-50/70 px-3 py-2 text-xs text-red-900"
            >
              <AlertCircle
                className="mt-0.5 h-3.5 w-3.5 shrink-0 text-red-700"
                aria-hidden="true"
              />
              <span>{errorMessage}</span>
            </div>
          ) : null}

          <div className="space-y-1.5">
            <label htmlFor="login-username" className="block text-xs font-medium text-ink">
              用户名
            </label>
            <Input
              id="login-username"
              name="username"
              type="text"
              autoComplete="username"
              autoCapitalize="none"
              spellCheck={false}
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              placeholder="admin"
              disabled={submitting}
              required
            />
          </div>

          <div className="space-y-1.5">
            <label htmlFor="login-password" className="block text-xs font-medium text-ink">
              密码
            </label>
            <Input
              id="login-password"
              name="password"
              type="password"
              autoComplete="current-password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="••••••••"
              disabled={submitting}
              required
            />
          </div>

          <Button type="submit" className="w-full" disabled={submitting}>
            <span>{submitting ? "正在登录…" : "登录"}</span>
            <ArrowRight className="h-3.5 w-3.5" aria-hidden="true" />
          </Button>
        </form>

        <div className="mt-4 border-t border-hairline pt-3 text-[11px] text-ink-muted font-mono flex items-center justify-between">
          <span>MCP 入口：/mcp · /admin/mcp</span>
          <span>人类审批门禁</span>
        </div>
      </div>

      <footer className="mx-auto w-full max-w-[400px] text-[11px] text-ink-muted">
        修订批准与三方冲突解决必须由人类 Web 会话执行。
      </footer>
    </div>
  );
}
