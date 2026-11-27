import { CopyButton } from "@/components/CopyButton";
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
  if (!value) {
    return <span className={cn("mono-num text-xs text-ink-muted", className)}>—</span>;
  }

  return (
    <span className={cn("inline-flex items-center gap-1", className)}>
      <code
        title={value}
        className="mono-num rounded-sm border border-hairline bg-subtle px-1.5 py-0.5 text-[11px] text-ink"
      >
        {prefix}
        {shortHash(value, length)}
      </code>
      <CopyButton
        value={value}
        label={label}
        variant="ghost"
        size="icon-xs"
        className="h-5 w-5"
      />
    </span>
  );
}
