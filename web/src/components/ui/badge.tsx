import * as React from "react";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "@/lib/utils";

const badgeVariants = cva(
  "inline-flex items-center gap-1 rounded-sm px-1.5 py-0.5 font-mono text-[11px] font-medium leading-tight tabular",
  {
    variants: {
      variant: {
        solid: "bg-zinc-950 text-zinc-50 border border-zinc-950",
        outline: "bg-white text-zinc-900 border border-zinc-400",
        muted: "bg-zinc-100 text-zinc-700 border border-zinc-200",
        dashed: "bg-zinc-50 text-zinc-600 border border-dashed border-zinc-400",
        added: "bg-emerald-50 text-emerald-900 border border-emerald-300",
        removed: "bg-red-50 text-red-900 border border-red-300",
        warning: "bg-amber-50 text-amber-950 border border-dashed border-amber-500",
      },
    },
    defaultVariants: {
      variant: "muted",
    },
  },
);

export interface BadgeProps
  extends React.HTMLAttributes<HTMLSpanElement>, VariantProps<typeof badgeVariants> {}

export function Badge({ className, variant, ...props }: BadgeProps) {
  return <span className={cn(badgeVariants({ variant }), className)} {...props} />;
}
