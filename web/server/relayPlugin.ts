import type { Plugin } from "vite";
import { createRelay } from "./relay";

/** Mounts the build relay on the Vite dev and preview servers. */
export function relayPlugin(): Plugin {
  const relay = createRelay();
  return {
    name: "voxelmesh-relay",
    configureServer(server) {
      server.middlewares.use("/api/builds", relay);
    },
    configurePreviewServer(server) {
      server.middlewares.use("/api/builds", relay);
    },
  };
}
