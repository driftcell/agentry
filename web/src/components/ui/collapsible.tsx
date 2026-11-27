import { Collapsible as BaseCollapsible } from "@base-ui/react/collapsible";
import { cn } from "@/lib/utils";

export function Collapsible({ ...props }: BaseCollapsible.Root.Props) {
  return <BaseCollapsible.Root data-slot="collapsible" {...props} />;
}

export function CollapsibleTrigger({ ...props }: BaseCollapsible.Trigger.Props) {
  return <BaseCollapsible.Trigger data-slot="collapsible-trigger" {...props} />;
}

export function CollapsibleContent({ className, ...props }: BaseCollapsible.Panel.Props) {
  return (
    <BaseCollapsible.Panel data-slot="collapsible-content" className={cn(className)} {...props} />
  );
}
