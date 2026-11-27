import { formatTokens } from "@/lib/format";
import { cn } from "@/lib/utils";

export function TokenDelta({
  added,
  removed,
  className,
}: {
  added: number;
  removed: number;
  className?: string;
}) {
  return (
    <span className={cn("mono-num inline-flex items-center gap-1.5 text-xs", className)}>
      <span className={added > 0 ? "text-emerald-800 font-medium" : "text-ink-muted"}>
        +{formatTokens(added)}
      </span>
      <span className="text-zinc-300">/</span>
      <span className={removed > 0 ? "text-red-800 font-medium" : "text-ink-muted"}>
        -{formatTokens(removed)}
      </span>
      <span className="text-[11px] text-ink-muted">tok</span>
    </span>
  );
}

export function SingleTokenDelta({ delta, className }: { delta: number; className?: string }) {
  const prefix = delta > 0 ? "+" : delta < 0 ? "-" : "";
  const formatted = `${prefix}${formatTokens(Math.abs(delta))}`;
  return (
    <span
      className={cn(
        "mono-num text-xs font-medium",
        delta > 0 ? "text-emerald-800" : delta < 0 ? "text-red-800" : "text-ink-muted",
        className,
      )}
    >
      {formatted}
    </span>
  );
}
