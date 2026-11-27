import { AlertCircle, Lock, RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

export function LoadingPanel({
  label = "Loading…",
  className,
}: {
  label?: string;
  className?: string;
}) {
  return (
    <div
      role="status"
      aria-live="polite"
      className={cn(
        "flex items-center gap-2 border border-hairline bg-surface px-4 py-8 text-xs text-ink-secondary font-mono",
        className,
      )}
    >
      <span className="inline-block h-3 w-3 animate-spin rounded-full border-2 border-zinc-400 border-t-zinc-950" />
      <span>{label}</span>
    </div>
  );
}

export function EmptyPanel({
  title,
  description,
  action,
  className,
}: {
  title: string;
  description?: string;
  action?: React.ReactNode;
  className?: string;
}) {
  return (
    <div
      className={cn(
        "flex flex-col items-start gap-1.5 border border-dashed border-hairline-strong bg-surface px-4 py-6",
        className,
      )}
    >
      <p className="text-xs font-semibold text-ink">{title}</p>
      {description ? <p className="text-xs text-ink-secondary">{description}</p> : null}
      {action ? <div className="mt-2">{action}</div> : null}
    </div>
  );
}

export function ErrorPanel({
  title = "Unable to load data",
  error,
  onRetry,
  className,
}: {
  title?: string;
  error: unknown;
  onRetry?: () => void;
  className?: string;
}) {
  const message = error instanceof Error ? error.message : String(error ?? "Unknown error");
  return (
    <div
      role="alert"
      className={cn(
        "flex items-start justify-between gap-3 border border-red-300 bg-red-50/70 px-4 py-3 text-red-950",
        className,
      )}
    >
      <div className="flex items-start gap-2.5">
        <AlertCircle className="mt-0.5 h-4 w-4 shrink-0 text-red-700" aria-hidden="true" />
        <div className="space-y-0.5">
          <p className="text-xs font-semibold">{title}</p>
          <p className="font-mono text-[11px] text-red-900">{message}</p>
        </div>
      </div>
      {onRetry ? (
        <Button variant="outline" size="xs" onClick={onRetry}>
          <RefreshCw className="h-3 w-3" aria-hidden="true" />
          Retry
        </Button>
      ) : null}
    </div>
  );
}

export function ForbiddenPanel({
  title = "Insufficient permissions",
  description,
}: {
  title?: string;
  description: string;
}) {
  return (
    <div className="flex items-start gap-2.5 border border-hairline-strong bg-subtle px-4 py-3 text-ink">
      <Lock className="mt-0.5 h-4 w-4 shrink-0 text-ink-secondary" aria-hidden="true" />
      <div className="space-y-0.5">
        <p className="text-xs font-semibold">{title}</p>
        <p className="text-xs text-ink-secondary">{description}</p>
      </div>
    </div>
  );
}
