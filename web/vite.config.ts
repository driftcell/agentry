import fs from "node:fs";
import path from "node:path";
import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { defineConfig, type Plugin } from "vite";

const outDir = path.resolve(import.meta.dirname, "../crates/server/static");
const apiTarget = process.env.AGENTRY_API_TARGET ?? "http://127.0.0.1:8080";

function cleanStaticExceptGitkeep(): Plugin {
  return {
    name: "clean-static-except-gitkeep",
    buildStart() {
      if (!fs.existsSync(outDir)) {
        fs.mkdirSync(outDir, { recursive: true });
      }
      for (const entry of fs.readdirSync(outDir)) {
        if (entry === ".gitkeep") continue;
        fs.rmSync(path.join(outDir, entry), { recursive: true, force: true });
      }
    },
    closeBundle() {
      const gitkeep = path.join(outDir, ".gitkeep");
      if (!fs.existsSync(gitkeep)) {
        fs.writeFileSync(gitkeep, "");
      }
    },
  };
}

export default defineConfig({
  base: "/",
  plugins: [cleanStaticExceptGitkeep(), react(), tailwindcss()],
  resolve: {
    alias: {
      "@": path.resolve(import.meta.dirname, "./src"),
    },
  },
  build: {
    outDir,
    emptyOutDir: false,
    sourcemap: false,
    rollupOptions: {
      output: {
        manualChunks(id) {
          if (!id.includes("node_modules")) return;
          if (id.includes("@tanstack")) return "vendor-tanstack";
          if (id.includes("@base-ui")) return "vendor-baseui";
          if (id.includes("lucide-react")) return "vendor-icons";
          if (id.includes("react-dom") || id.includes("/react/")) return "vendor-react";
        },
      },
    },
  },
  server: {
    port: 5173,
    proxy: {
      "/api": apiTarget,
      "/mcp": apiTarget,
      "/admin/mcp": apiTarget,
      "/health": apiTarget,
    },
  },
});
