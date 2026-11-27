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
      setErrorMessage("Enter both username and password.");
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
        setErrorMessage("Unable to sign in. Verify server availability and try again.");
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
            <span className="font-mono text-[11px] text-ink-muted">MCP REGISTRY</span>
          </div>
          <p className="mt-1.5 text-xs text-ink-secondary leading-relaxed">
            Human review, workspace inspection, and key governance for active MCP revisions.
          </p>
        </div>

        <form onSubmit={handleSubmit} className="space-y-4 border border-hairline bg-surface p-5">
          <div>
            <h2 className="text-sm font-semibold text-ink">Sign in to Workbench</h2>
            <p className="mt-0.5 text-xs text-ink-muted">
              Cookie-backed human session. API keys are for MCP clients only.
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
              Username
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
              Password
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
            <span>{submitting ? "Signing in…" : "Sign in"}</span>
            <ArrowRight className="h-3.5 w-3.5" aria-hidden="true" />
          </Button>
        </form>

        <div className="mt-4 border-t border-hairline pt-3 text-[11px] text-ink-muted font-mono flex items-center justify-between">
          <span>Endpoints: /mcp · /admin/mcp</span>
          <span>Human approval gate</span>
        </div>
      </div>

      <footer className="mx-auto w-full max-w-[400px] text-[11px] text-ink-muted">
        Approvals and conflict resolutions require a human web session.
      </footer>
    </div>
  );
}
