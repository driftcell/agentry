import { Copy } from "lucide-react";
import { toast } from "sonner";
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

export function CopyButton({
  value,
  label = "复制",
  copiedLabel = "已复制",
  showLabel = false,
  variant = "ghost",
  size = "icon-xs",
  className,
}: CopyButtonProps) {
  const handleCopy = async () => {
    if (!value) return;
    try {
      await navigator.clipboard.writeText(value);
      toast.success(copiedLabel);
    } catch {
      toast.error("复制失败，请手动选择文本");
    }
  };

  return (
    <Button
      type="button"
      variant={variant}
      size={size}
      onClick={() => void handleCopy()}
      disabled={!value}
      title={label}
      aria-label={label}
      className={cn(className)}
    >
      <Copy aria-hidden="true" />
      {showLabel ? <span>{label}</span> : null}
    </Button>
  );
}
