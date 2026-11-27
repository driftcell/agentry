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
        setErrorMessage("登录失败，请稍后重试。");
      }
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="min-h-screen bg-paper text-ink flex items-center justify-center px-4 py-10">
      <div className="w-full max-w-[360px]">
        <div className="border-b border-ink pb-3 mb-5 flex items-baseline justify-between">
          <h1 className="font-mono text-base font-bold tracking-tight">AGENTRY</h1>
          <span className="text-xs text-ink-muted">青塔代理知识库</span>
        </div>

        <form onSubmit={handleSubmit} className="space-y-4 border border-hairline bg-surface p-5">
          <h2 className="text-sm font-semibold text-ink">登录账号</h2>

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
      </div>
    </div>
  );
}
