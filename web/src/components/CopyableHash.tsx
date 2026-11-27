import { useState } from "react";
import { Check, Copy } from "lucide-react";
import { shortHash } from "@/lib/format";
import { cn } from "@/lib/utils";

interface CopyableHashProps {
  value: string | null | undefined;
  prefix?: string;
  length?: number;
  className?: string;
  label?: string;
}

export function CopyableHash({
  value,
  prefix = "",
  length = 8,
  className,
  label = "复制摘要",
}: CopyableHashProps) {
  const [copied, setCopied] = useState(false);

  if (!value) {
    return <span className={cn("mono-num text-xs text-ink-muted", className)}>—</span>;
  }

  const handleCopy = async (event: React.MouseEvent) => {
    event.preventDefault();
    event.stopPropagation();
    try {
      await navigator.clipboard.writeText(value);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1500);
    } catch {
      // Clipboard may be unavailable in restricted contexts.
    }
  };

  return (
    <span className={cn("inline-flex items-center gap-1", className)}>
      <code
        title={value}
        className="mono-num rounded-sm border border-hairline bg-subtle px-1.5 py-0.5 text-[11px] text-ink"
      >
        {prefix}
        {shortHash(value, length)}
      </code>
      <button
        type="button"
        onClick={handleCopy}
        title={copied ? "已复制" : `${label}: ${value}`}
        aria-label={copied ? "已复制到剪贴板" : `${label} ${value}`}
        className="inline-flex h-5 w-5 items-center justify-center rounded-sm text-ink-muted hover:bg-subtle hover:text-ink cursor-pointer"
      >
        {copied ? (
          <Check className="h-3 w-3 text-emerald-700" aria-hidden="true" />
        ) : (
          <Copy className="h-3 w-3" aria-hidden="true" />
        )}
      </button>
    </span>
  );
}
