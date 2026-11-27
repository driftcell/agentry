import { Folder, KeyRound, Plug, Users } from "lucide-react";
import { FadeTransition } from "@/components/FadeTransition";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { ApiKeysPanel } from "./platform/ApiKeysPanel";
import { ClientSetupPanel } from "./platform/ClientSetupPanel";
import { PlatformProvider, usePlatform } from "./platform/PlatformProvider";
import { ProjectsPanel } from "./platform/ProjectsPanel";
import type { PlatformTab } from "./platform/types";
import { UsersPanel } from "./platform/UsersPanel";

function PlatformShell() {
  const { state, actions, meta } = usePlatform();

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-hairline pb-3">
        <h1 className="text-base font-semibold tracking-tight text-ink">平台管理</h1>
      </div>

      <Tabs value={state.tab} onValueChange={(value) => actions.setTab(value as PlatformTab)}>
        <TabsList>
          <TabsTrigger value="projects">
            <Folder aria-hidden="true" />
            项目 ({meta.projects.length})
          </TabsTrigger>
          <TabsTrigger value="keys">
            <KeyRound aria-hidden="true" />
            API Key
          </TabsTrigger>
          <TabsTrigger value="users">
            <Users aria-hidden="true" />
            用户
          </TabsTrigger>
          <TabsTrigger value="setup">
            <Plug aria-hidden="true" />
            客户端接入
          </TabsTrigger>
        </TabsList>

        <TabsContent value="projects" className="space-y-3">
          <FadeTransition>
            <ProjectsPanel />
          </FadeTransition>
        </TabsContent>

        <TabsContent value="keys" className="space-y-4">
          <FadeTransition>
            <ApiKeysPanel />
          </FadeTransition>
        </TabsContent>

        <TabsContent value="users" className="space-y-4">
          <FadeTransition>
            <UsersPanel />
          </FadeTransition>
        </TabsContent>

        <TabsContent value="setup">
          <FadeTransition>
            <ClientSetupPanel />
          </FadeTransition>
        </TabsContent>
      </Tabs>
    </div>
  );
}

export function PlatformPage({ initialTab }: { initialTab?: PlatformTab }) {
  return (
    <PlatformProvider initialTab={initialTab}>
      <PlatformShell />
    </PlatformProvider>
  );
}
