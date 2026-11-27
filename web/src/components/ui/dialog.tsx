import * as React from "react";
import { Dialog as BaseDialog } from "@base-ui/react/dialog";
import { X } from "lucide-react";
import { cn } from "@/lib/utils";

export function Dialog({ ...props }: BaseDialog.Root.Props) {
  return <BaseDialog.Root data-slot="dialog" {...props} />;
}

export function DialogTrigger({ ...props }: BaseDialog.Trigger.Props) {
  return <BaseDialog.Trigger data-slot="dialog-trigger" {...props} />;
}

export function DialogPortal({ ...props }: BaseDialog.Portal.Props) {
  return <BaseDialog.Portal data-slot="dialog-portal" {...props} />;
}

export function DialogClose({ ...props }: BaseDialog.Close.Props) {
  return <BaseDialog.Close data-slot="dialog-close" {...props} />;
}

export function DialogOverlay({ className, ...props }: BaseDialog.Backdrop.Props) {
  return (
    <BaseDialog.Backdrop
      data-slot="dialog-overlay"
      className={cn("fixed inset-0 z-50 bg-zinc-950/35 backdrop-blur-[1px]", className)}
      {...props}
    />
  );
}

export function DialogContent({ className, children, ...props }: BaseDialog.Popup.Props) {
  return (
    <DialogPortal>
      <DialogOverlay />
      <BaseDialog.Popup
        data-slot="dialog-content"
        className={cn(
          "fixed top-1/2 left-1/2 z-50 w-[calc(100%-2rem)] max-w-lg max-h-[90vh] overflow-y-auto -translate-x-1/2 -translate-y-1/2 rounded-sm border border-zinc-300 bg-white p-5 text-zinc-950 shadow-sm",
          className,
        )}
        {...props}
      >
        {children}
        <BaseDialog.Close
          aria-label="关闭对话框"
          className="absolute top-3.5 right-3.5 rounded-sm p-1 text-zinc-500 hover:bg-zinc-100 hover:text-zinc-950 cursor-pointer"
        >
          <X className="h-4 w-4" aria-hidden="true" />
        </BaseDialog.Close>
      </BaseDialog.Popup>
    </DialogPortal>
  );
}

export function DialogHeader({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return <div className={cn("flex flex-col gap-1 pr-6", className)} {...props} />;
}

export function DialogFooter({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={cn(
        "mt-4 flex items-center justify-end gap-2 border-t border-hairline pt-3",
        className,
      )}
      {...props}
    />
  );
}

export function DialogTitle({ className, ...props }: BaseDialog.Title.Props) {
  return (
    <BaseDialog.Title
      data-slot="dialog-title"
      className={cn("text-sm font-semibold tracking-tight text-zinc-950", className)}
      {...props}
    />
  );
}

export function DialogDescription({ className, ...props }: BaseDialog.Description.Props) {
  return (
    <BaseDialog.Description
      data-slot="dialog-description"
      className={cn("text-xs text-zinc-600 leading-relaxed", className)}
      {...props}
    />
  );
}
