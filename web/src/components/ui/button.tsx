import * as React from "react";
import { Button as BaseButton } from "@base-ui/react/button";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "@/lib/utils";

const buttonVariants = cva(
  "inline-flex items-center justify-center gap-1.5 whitespace-nowrap rounded-sm text-xs font-medium transition-colors disabled:pointer-events-none disabled:opacity-45 cursor-pointer disabled:cursor-not-allowed",
  {
    variants: {
      variant: {
        default: "bg-zinc-950 text-zinc-50 hover:bg-zinc-800 border border-zinc-950",
        secondary: "bg-zinc-100 text-zinc-900 hover:bg-zinc-200 border border-zinc-200",
        outline:
          "bg-white text-zinc-900 border border-zinc-300 hover:bg-zinc-50 hover:border-zinc-400",
        ghost:
          "bg-transparent text-zinc-700 hover:bg-zinc-100 hover:text-zinc-950 border border-transparent",
        destructive: "bg-red-700 text-white hover:bg-red-800 border border-red-700",
        destructiveOutline:
          "bg-white text-red-700 border border-red-300 hover:bg-red-50 hover:border-red-400",
      },
      size: {
        default: "h-8 px-3 py-1.5",
        sm: "h-7 px-2.5 text-xs",
        xs: "h-6 px-2 text-[11px]",
        lg: "h-9 px-4 text-sm",
        icon: "h-7 w-7 p-0",
      },
    },
    defaultVariants: {
      variant: "default",
      size: "default",
    },
  },
);

export type ButtonProps = BaseButton.Props & VariantProps<typeof buttonVariants>;

export function Button({
  className,
  variant,
  size,
  type = "button",
  ...props
}: ButtonProps & { ref?: React.Ref<HTMLButtonElement> }) {
  return (
    <BaseButton
      type={type}
      className={cn(buttonVariants({ variant, size, className }))}
      {...props}
    />
  );
}

export { buttonVariants };
