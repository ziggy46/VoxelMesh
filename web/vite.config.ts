import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { relayPlugin } from "./server/relayPlugin";

export default defineConfig({
  plugins: [react(), tailwindcss(), relayPlugin()],
  // Loopback only: the dev server and preview are never exposed on the network (CLAUDE.md invariant 8).
  server: { host: "127.0.0.1", port: 5173, strictPort: true },
  preview: { host: "127.0.0.1", port: 5173, strictPort: true },
  worker: { format: "es" },
  test: {
    environment: "node",
    include: ["src/**/*.test.ts"],
    testTimeout: 30000,
  },
});
