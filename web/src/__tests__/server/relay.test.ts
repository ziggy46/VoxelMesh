import { request as httpRequest, createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { afterEach, describe, expect, it } from "vitest";
import { createRelay, type RelayOptions } from "../../../server/relay";

let server: Server | null = null;
afterEach(async () => {
  await new Promise<void>((r) => (server ? server.close(() => r()) : r()));
  server = null;
});

async function start(opts?: RelayOptions): Promise<number> {
  const relay = createRelay(opts);
  server = createServer(relay);
  await new Promise<void>((r) => server!.listen(0, "127.0.0.1", r));
  return (server.address() as AddressInfo).port;
}

interface Resp { status: number; headers: Record<string, string | string[] | undefined>; body: Buffer }
function call(port: number, method: string, path: string, body?: Buffer, headers: Record<string, string> = {}): Promise<Resp> {
  return new Promise((resolve, reject) => {
    const req = httpRequest({ host: "127.0.0.1", port, method, path, headers: { ...(body ? { "content-length": String(body.length) } : {}), ...headers } }, (res) => {
      const chunks: Buffer[] = [];
      res.on("data", (c: Buffer) => chunks.push(c));
      res.on("end", () => resolve({ status: res.statusCode ?? 0, headers: res.headers, body: Buffer.concat(chunks) }));
    });
    req.on("error", reject);
    if (body) req.write(body);
    req.end();
  });
}

const json = (r: Resp) => JSON.parse(r.body.toString("utf8")) as { id?: string; url?: string; error?: string };

describe("build relay", () => {
  it("stores a build and returns it by an unguessable 128-bit id", async () => {
    const port = await start();
    const data = Buffer.from([1, 2, 3, 4, 5]);
    const post = await call(port, "POST", "/", data);
    expect(post.status).toBe(201);
    const { id, url } = json(post);
    expect(id).toMatch(/^[0-9a-f]{32}$/);
    expect(url).toBe(`http://127.0.0.1:${port}/?build=${id}`);
    const get = await call(port, "GET", `/${id}`);
    expect(get.status).toBe(200);
    expect(get.body).toEqual(data);
    const again = json(await call(port, "POST", "/", data));
    expect(again.id).not.toBe(id);
  });

  it("never sends CORS headers and marks responses uncacheable", async () => {
    const port = await start();
    const r = await call(port, "POST", "/", Buffer.from("x"));
    expect(Object.keys(r.headers).filter((h) => h.startsWith("access-control"))).toEqual([]);
    expect(r.headers["cache-control"]).toBe("no-store");
  });

  it("rejects bodies over the cap by declared length and by streamed length", async () => {
    const port = await start({ maxBytes: 100 });
    expect((await call(port, "POST", "/", Buffer.alloc(101))).status).toBe(413);
    const chunked = await new Promise<number>((resolve) => {
      const req = httpRequest({ host: "127.0.0.1", port, method: "POST", path: "/", headers: { "transfer-encoding": "chunked" } }, (res) => {
        res.resume();
        resolve(res.statusCode ?? 0);
      });
      req.on("error", () => resolve(-1));
      req.write(Buffer.alloc(60));
      req.write(Buffer.alloc(60));
      req.end();
    });
    expect(chunked).toBe(413);
    expect((await call(port, "POST", "/", Buffer.alloc(100))).status).toBe(201);
  });

  it("rejects empty bodies, unknown/malformed ids and wrong methods", async () => {
    const port = await start();
    expect((await call(port, "POST", "/", undefined)).status).toBe(400);
    expect((await call(port, "GET", `/${"0".repeat(32)}`)).status).toBe(404);
    expect((await call(port, "GET", "/not-an-id")).status).toBe(404);
    expect((await call(port, "GET", "/../../etc/passwd")).status).toBe(404);
    expect((await call(port, "DELETE", "/")).status).toBe(405);
  });

  it("expires builds after the TTL", async () => {
    let t = 1000;
    const port = await start({ ttlMs: 500, now: () => t });
    const { id } = json(await call(port, "POST", "/", Buffer.from("x")));
    t += 499;
    expect((await call(port, "GET", `/${id}`)).status).toBe(200);
    t += 2;
    expect((await call(port, "GET", `/${id}`)).status).toBe(404);
  });

  it("evicts the oldest build beyond the count limit", async () => {
    const port = await start({ maxBuilds: 2 });
    const ids: string[] = [];
    for (let i = 0; i < 3; i++) ids.push(json(await call(port, "POST", "/", Buffer.from([i + 1])))!.id!);
    expect((await call(port, "GET", `/${ids[0]}`)).status).toBe(404);
    expect((await call(port, "GET", `/${ids[2]}`)).status).toBe(200);
  });

  it("refuses non-loopback Host headers (DNS rebinding) and foreign Origins (other sites posting to localhost)", async () => {
    const port = await start();
    expect((await call(port, "POST", "/", Buffer.from("x"), { host: "evil.example.com" })).status).toBe(403);
    expect((await call(port, "POST", "/", Buffer.from("x"), { origin: "https://evil.example.com" })).status).toBe(403);
    expect((await call(port, "POST", "/", Buffer.from("x"), { origin: `http://127.0.0.1:${port}` })).status).toBe(201);
    expect((await call(port, "GET", `/${"0".repeat(32)}`, undefined, { host: "10.0.0.5:5173" })).status).toBe(403);
  });
});
