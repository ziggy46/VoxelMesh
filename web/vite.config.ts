import { defineConfig, type Plugin } from "vitest/config";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { relayPlugin } from "./server/relayPlugin";

/**
 * Production-only Content-Security-Policy. The app never needs to talk to anyone but its own origin, so say so in the page:
 * a static host (GitHub Pages) cannot send headers, and dev needs inline scripts for hot reload, so this is build-only.
 */
const CSP = [
  "default-src 'none'",
  "script-src 'self'",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob:",
  "connect-src 'self'",
  "worker-src 'self'",
  "base-uri 'none'",
  "form-action 'none'",
  "object-src 'none'",
].join("; ");

const productionCsp = (): Plugin => ({
  name: "voxelmesh-csp",
  apply: "build",
  transformIndexHtml: (html) =>
    html.replace("<head>", `<head>\n    <meta http-equiv="Content-Security-Policy" content="${CSP}" />`),
});

export default defineConfig({
  // GitHub Pages serves a project site under /<repo>/; set VITE_BASE=/VoxelMesh/ for that build. Local and root hosting use "/".
  base: process.env.VITE_BASE ?? "/",
  plugins: [react(), tailwindcss(), relayPlugin(), productionCsp()],
  // Loopback only: the dev server and preview are never exposed on the network (CLAUDE.md invariant 8).
  server: { host: "127.0.0.1", port: 5173, strictPort: true },
  preview: { host: "127.0.0.1", port: 5173, strictPort: true },
  worker: { format: "es" },
  test: {
    environment: "node",
    include: ["src/**/*.test.ts"],
    // Shared CI runners are 2-3x slower than a desktop, so allow the heavy fuzz tests longer there.
    testTimeout: process.env.CI ? 240_000 : 30_000,
  },
});
