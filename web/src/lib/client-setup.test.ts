import { describe, expect, test } from "bun:test";
import { generateClientSetup } from "@/lib/client-setup";

describe("client-setup generator", () => {
  test("blocks admin endpoint snippets when scopes lack admin:* permissions", () => {
    const res = generateClientSetup({
      origin: "https://registry.example.com",
      projectSlug: "alpha",
      mode: "fixed-admin",
      scopes: ["mcp:read"],
    });
    expect(res.allowed).toBe(false);
    expect(res.claudeJson).toBe("");
    expect(res.opencodeJson).toBe("");
  });

  test("generates project-slug read configuration with safe env placeholders", () => {
    const res = generateClientSetup({
      origin: "https://registry.example.com/",
      projectSlug: "alpha",
      mode: "slug-read",
      scopes: ["mcp:read"],
    });
    expect(res.allowed).toBe(true);
    expect(res.url).toBe("https://registry.example.com/mcp/projects/alpha");

    const parsedClaude = JSON.parse(res.claudeJson) as {
      mcpServers: Record<string, { url: string; headers: Record<string, string> }>;
    };
    expect(parsedClaude.mcpServers["agentry-alpha"]?.url).toBe(
      "https://registry.example.com/mcp/projects/alpha",
    );
    expect(parsedClaude.mcpServers["agentry-alpha"]?.headers.Authorization).toBe(
      "Bearer ${AGENTRY_API_KEY}",
    );

    const parsedOpenCode = JSON.parse(res.opencodeJson) as {
      mcp: Record<string, { type: string; url: string }>;
    };
    expect(parsedOpenCode.mcp["agentry-alpha"]?.type).toBe("remote");
  });

  test("includes X-MCP-Project header on fixed endpoints when requested", () => {
    const res = generateClientSetup({
      origin: "http://localhost:8080",
      projectSlug: "beta",
      mode: "fixed-admin",
      scopes: ["mcp:read", "admin:propose"],
      includeProjectHeader: true,
    });
    expect(res.allowed).toBe(true);
    expect(res.url).toBe("http://localhost:8080/admin/mcp");
    expect(res.claudeJson).toContain('"X-MCP-Project": "beta"');
    expect(res.claudeCli).toContain('--header "X-MCP-Project: beta"');
  });
});
