// Localhost build relay (docs/00 §3, CLAUDE.md invariant 8). Receives a gzipped .vxm.json from the Fabric mod and hands it
// to the web app. Loopback hosts only, body cap, unguessable ids, in-memory with a TTL, no CORS headers at all.
import { randomBytes } from "node:crypto";
import type { IncomingMessage, ServerResponse } from "node:http";

export interface RelayOptions {
  maxBytes?: number; // default 64 MB
  ttlMs?: number; // default 1 hour
  maxBuilds?: number; // oldest evicted beyond this
  now?: () => number;
}

interface Stored {
  bytes: Buffer;
  expires: number;
}

export const RELAY_MAX_BYTES = 64 * 1024 * 1024;
export const RELAY_TTL_MS = 60 * 60 * 1000;

const ID = /^[0-9a-f]{32}$/;
const LOOPBACK = new Set(["127.0.0.1", "localhost", "[::1]"]);

const hostnameOf = (hostHeader: string): string => {
  // "127.0.0.1:5173", "localhost:5173", "[::1]:5173"
  if (hostHeader.startsWith("[")) return hostHeader.slice(0, hostHeader.indexOf("]") + 1);
  return hostHeader.split(":")[0] ?? "";
};

function send(res: ServerResponse, status: number, body: string | Buffer, type = "application/json"): void {
  res.statusCode = status;
  res.setHeader("Content-Type", type);
  res.setHeader("Cache-Control", "no-store");
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.end(body);
}

const fail = (res: ServerResponse, status: number, message: string) => send(res, status, JSON.stringify({ error: message }));

/**
 * Returns a connect-style handler to mount at `/api/builds` (so `req.url` is the part after the mount point).
 * POST /        body = gzipped payload  -> 201 { id, url }
 * GET  /<id>    -> the stored bytes, or 404 once unknown/expired
 */
export function createRelay(opts: RelayOptions = {}): (req: IncomingMessage, res: ServerResponse) => void {
  const maxBytes = opts.maxBytes ?? RELAY_MAX_BYTES;
  const ttlMs = opts.ttlMs ?? RELAY_TTL_MS;
  const maxBuilds = opts.maxBuilds ?? 16;
  const now = opts.now ?? Date.now;
  const builds = new Map<string, Stored>();

  const sweep = () => {
    const t = now();
    for (const [id, b] of builds) if (b.expires <= t) builds.delete(id);
    while (builds.size > maxBuilds) builds.delete(builds.keys().next().value as string);
  };

  return (req, res) => {
    sweep();
    const host = req.headers.host ?? "";
    if (!LOOPBACK.has(hostnameOf(host))) return fail(res, 403, "loopback hosts only"); // DNS-rebinding guard
    const origin = req.headers.origin;
    if (origin !== undefined) {
      // A browser page may only talk to us from our own origin; this also blocks other sites POSTing at localhost.
      let ok = false;
      try {
        ok = new URL(origin).host === host;
      } catch {
        ok = false;
      }
      if (!ok) return fail(res, 403, "cross-origin requests are not allowed");
    }

    const path = (req.url ?? "/").split("?")[0] ?? "/";

    if (req.method === "POST" && (path === "/" || path === "")) {
      const declared = Number(req.headers["content-length"] ?? 0);
      if (declared > maxBytes) {
        res.setHeader("Connection", "close");
        fail(res, 413, `body exceeds ${maxBytes} bytes`);
        req.resume();
        return;
      }
      const chunks: Buffer[] = [];
      let size = 0;
      let rejected = false;
      req.on("data", (c: Buffer) => {
        if (rejected) return;
        size += c.length;
        if (size > maxBytes) {
          rejected = true;
          chunks.length = 0;
          res.setHeader("Connection", "close");
          fail(res, 413, `body exceeds ${maxBytes} bytes`);
          return;
        }
        chunks.push(c);
      });
      req.on("end", () => {
        if (rejected) return;
        if (size === 0) return fail(res, 400, "empty body");
        const id = randomBytes(16).toString("hex");
        builds.set(id, { bytes: Buffer.concat(chunks), expires: now() + ttlMs });
        sweep();
        send(res, 201, JSON.stringify({ id, url: `http://${host}/?build=${id}` }));
      });
      req.on("error", () => {
        rejected = true;
      });
      return;
    }

    if (req.method === "GET" && path.startsWith("/")) {
      const id = path.slice(1);
      const b = ID.test(id) ? builds.get(id) : undefined;
      if (!b) return fail(res, 404, "unknown or expired build");
      return send(res, 200, b.bytes, "application/octet-stream");
    }

    if (req.method === "POST" || req.method === "GET") return fail(res, 404, "not found");
    res.setHeader("Allow", "GET, POST");
    return fail(res, 405, "method not allowed");
  };
}
