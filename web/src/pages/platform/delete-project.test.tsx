import { afterEach, describe, expect, test } from "bun:test";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { api } from "@/lib/api";
import { AuthProvider, ME_QUERY_KEY } from "@/lib/auth-context";
import type { MeResponse, Project } from "@/lib/types";
import { DeleteProjectDialog } from "./DeleteProjectDialog";
import { PlatformProvider, usePlatform } from "./PlatformProvider";

const project = (slug: string, name: string): Project => ({
  id: `id-${slug}`,
  slug,
  name,
  description: "",
  token_budget: 200000,
  active_revision_id: null,
});

function Harness() {
  const { meta, actions } = usePlatform();
  return (
    <>
      {meta.projects.map((item) => (
        <button key={item.slug} type="button" onClick={() => actions.requestDelete(item)}>
          删除 {item.slug}
        </button>
      ))}
      <DeleteProjectDialog />
    </>
  );
}

describe("DeleteProjectDialog", () => {
  const originalMe = api.me;
  const originalDelete = api.deleteProject;

  afterEach(() => {
    api.me = originalMe;
    api.deleteProject = originalDelete;
  });

  test("confirms soft delete and updates the shared projects cache", async () => {
    let projects = [project("default", "Default"), project("trash", "Trash")];
    let deletedSlug: string | null = null;

    api.me = async (): Promise<MeResponse> => ({
      user: {
        id: "user-1",
        username: "admin",
        display_name: "Admin",
        role: "superadmin",
      },
      projects,
      can_approve: true,
      can_platform: true,
    });
    api.deleteProject = async (slug) => {
      deletedSlug = slug;
      projects = projects.filter((item) => item.slug !== slug);
      return { deleted: true, project: { id: `id-${slug}`, slug } };
    };

    const queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
    });

    render(
      <QueryClientProvider client={queryClient}>
        <AuthProvider>
          <PlatformProvider>
            <Harness />
          </PlatformProvider>
        </AuthProvider>
      </QueryClientProvider>,
    );

    fireEvent.click(await screen.findByRole("button", { name: "删除 trash" }));
    expect(screen.getByText("删除此项目？")).toBeDefined();

    fireEvent.click(screen.getByRole("button", { name: "确认删除" }));

    await waitFor(() => expect(deletedSlug).toBe("trash"));
    await waitFor(() =>
      expect(
        queryClient
          .getQueryData<MeResponse>(ME_QUERY_KEY)
          ?.projects.map((item) => item.slug),
      ).toEqual(["default"]),
    );
    await waitFor(() =>
      expect(screen.queryByRole("button", { name: "删除 trash" })).toBeNull(),
    );
    expect(screen.queryByText("删除此项目？")).toBeNull();
  });
});
