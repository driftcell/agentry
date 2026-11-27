import * as React from "react";
import { cn } from "@/lib/utils";

export const Input = React.forwardRef<
  HTMLInputElement,
  React.InputHTMLAttributes<HTMLInputElement>
>(({ className, ...props }, ref) => (
  <input
    ref={ref}
    className={cn(
      "flex h-8 w-full rounded-sm border border-zinc-300 bg-white px-2.5 py-1 text-xs text-zinc-950 placeholder:text-zinc-400",
      "disabled:cursor-not-allowed disabled:bg-zinc-100 disabled:opacity-60",
      className,
    )}
    {...props}
  />
));
Input.displayName = "Input";

export const Textarea = React.forwardRef<
  HTMLTextAreaElement,
  React.TextareaHTMLAttributes<HTMLTextAreaElement>
>(({ className, ...props }, ref) => (
  <textarea
    ref={ref}
    className={cn(
      "flex min-h-[72px] w-full rounded-sm border border-zinc-300 bg-white px-2.5 py-2 text-xs text-zinc-950 placeholder:text-zinc-400",
      "disabled:cursor-not-allowed disabled:bg-zinc-100 disabled:opacity-60",
      className,
    )}
    {...props}
  />
));
Textarea.displayName = "Textarea";

export const Select = React.forwardRef<
  HTMLSelectElement,
  React.SelectHTMLAttributes<HTMLSelectElement>
>(({ className, children, ...props }, ref) => (
  <select
    ref={ref}
    className={cn(
      "flex h-8 rounded-sm border border-zinc-300 bg-white px-2 py-1 text-xs text-zinc-950",
      "disabled:cursor-not-allowed disabled:bg-zinc-100 disabled:opacity-60",
      className,
    )}
    {...props}
  >
    {children}
  </select>
));
Select.displayName = "Select";
