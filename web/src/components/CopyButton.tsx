import { useEffect, useRef, useState } from "react";
import { Check, Copy } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

interface CopyButtonProps {
  value: string | null | undefined;
  label?: string;
  copiedLabel?: string;
  showLabel?: boolean;
  variant?: React.ComponentProps<typeof Button>["variant"];
  size?: React.ComponentProps<typeof Button>["size"];
  className?: string;
}

const RESET_MS = 1500;

export function CopyButton({
  value,
  label = "复制",
  copiedLabel = "已复制",
  showLabel = false,
  variant = "ghost",
  size = "icon-xs",
  className,
}: CopyButtonProps) {
  const [copied, setCopied] = useState(false);
  const timeoutRef = useRef<number | null>(null);

  useEffect(
    () => () => {
      if (timeoutRef.current !== null) {
        window.clearTimeout(timeoutRef.current);
      }
    },
    [],
  );

  const handleCopy = async () => {
    if (!value) return;
    try {
      await navigator.clipboard.writeText(value);
      setCopied(true);
      if (timeoutRef.current !== null) {
        window.clearTimeout(timeoutRef.current);
      }
      timeoutRef.current = window.setTimeout(() => setCopied(false), RESET_MS);
    } catch {
      // Clipboard may be unavailable in restricted contexts.
    }
  };

  return (
    <Button
      type="button"
      variant={variant}
      size={size}
      onClick={() => void handleCopy()}
      disabled={!value}
      title={copied ? copiedLabel : label}
      aria-label={copied ? copiedLabel : label}
      className={cn(copied && "text-emerald-700", className)}
    >
      {copied ? (
        <Check aria-hidden="true" />
      ) : (
        <Copy aria-hidden="true" />
      )}
      {showLabel ? <span>{copied ? copiedLabel : label}</span> : null}
      <span className="sr-only" role="status" aria-live="polite">
        {copied ? copiedLabel : ""}
      </span>
    </Button>
  );
}
