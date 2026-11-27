import { Tabs as BaseTabs } from "@base-ui/react/tabs";
import { cn } from "@/lib/utils";

export function Tabs({ className, ...props }: BaseTabs.Root.Props) {
  return <BaseTabs.Root data-slot="tabs" className={cn(className)} {...props} />;
}

export function TabsList({ className, ...props }: BaseTabs.List.Props) {
  return (
    <BaseTabs.List
      data-slot="tabs-list"
      className={cn(
        "inline-flex items-center gap-0.5 border border-hairline bg-zinc-100 p-0.5 rounded-sm",
        className,
      )}
      {...props}
    />
  );
}

export function TabsTrigger({ className, ...props }: BaseTabs.Tab.Props) {
  return (
    <BaseTabs.Tab
      data-slot="tabs-trigger"
      className={cn(
        "inline-flex items-center justify-center gap-1.5 rounded-sm px-2.5 py-1 text-xs font-medium text-zinc-600 transition-colors cursor-pointer border border-transparent",
        "hover:text-zinc-950 data-active:bg-white data-active:text-zinc-950 data-active:border-zinc-300",
        className,
      )}
      {...props}
    />
  );
}

export function TabsContent({ className, ...props }: BaseTabs.Panel.Props) {
  return <BaseTabs.Panel data-slot="tabs-content" className={cn("mt-3", className)} {...props} />;
}
