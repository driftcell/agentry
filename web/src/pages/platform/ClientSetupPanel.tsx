import { ClientSetupHelper } from "@/components/ClientSetupHelper";
import { usePlatform } from "./PlatformProvider";

export function ClientSetupPanel() {
  const { meta } = usePlatform();
  return (
    <ClientSetupHelper
      projects={meta.projects}
      defaultProjectSlug={meta.selectedProjectSlug}
    />
  );
}
