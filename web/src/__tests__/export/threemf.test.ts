// docs/04 §2 + docs/06 §4: generateMultiColor3MF (D4)
import JSZip from "jszip";
import { DOMParser } from "@xmldom/xmldom";
import { describe, expect, it } from "vitest";
import { generateMultiColor3MF } from "../../exporters/slicerExporters";
import type { ExportBucket } from "../../types/color";
import { cubeMesh, tJunctionSlab } from "../helpers";

const bucket = (id: number, x: number, hex: string, name = `Slot ${id}`): ExportBucket => ({ bucketId: id, name, hexColor: hex, mesh: cubeMesh(id, x, 0, 0, 16) });
const two = () => [bucket(1, 0, "#7A797A", "Slot 1 – Stone Gray (#7A797A)"), bucket(2, 16, "#A12722")];

const parse = (xml: string): Document =>
  new DOMParser({ onError: (level: string, msg: string) => { if (level !== "warning") throw new Error(`XML ${level}: ${msg}`); } } as never).parseFromString(xml, "text/xml") as unknown as Document;
const els = (parent: Document | Element, tag: string): Element[] => Array.from(parent.getElementsByTagName(tag) as unknown as ArrayLike<Element>);

async function open(buckets: ExportBucket[], scale = 4) {
  const blob = await generateMultiColor3MF(buckets, "Test Build", scale);
  const zip = await JSZip.loadAsync(await blob.arrayBuffer());
  const files = Object.keys(zip.files).filter((n) => !zip.files[n]!.dir).sort();
  const text = async (n: string) => zip.file(n)!.async("string");
  return { blob, zip, files, text, model: parse(await text("3D/3dmodel.model")) };
}

describe("generateMultiColor3MF", () => {
  it("contains exactly the four OPC parts", async () => {
    const { files } = await open(two());
    expect(files).toEqual(["3D/3dmodel.model", "Metadata/model_settings.config", "_rels/.rels", "[Content_Types].xml"].sort());
  });

  it("declares rels/model content types and a relationship to /3D/3dmodel.model", async () => {
    const { text } = await open(two());
    const ct = parse(await text("[Content_Types].xml"));
    const exts = els(ct, "Default").map((e) => e.getAttribute("Extension"));
    expect(exts).toEqual(expect.arrayContaining(["rels", "model"]));
    const rels = parse(await text("_rels/.rels"));
    expect(els(rels, "Relationship").map((e) => e.getAttribute("Target"))).toContain("/3D/3dmodel.model");
  });

  it("uses millimetres, the core namespace and one basematerials list with 0-based pindex", async () => {
    const { model } = await open(two());
    const root = model.documentElement;
    expect(root.getAttribute("unit")).toBe("millimeter");
    expect(root.getAttribute("xmlns")).toBe("http://schemas.microsoft.com/3dmanufacturing/core/2015/02");
    const bm = els(model, "basematerials");
    expect(bm).toHaveLength(1);
    expect(bm[0]!.getAttribute("id")).toBe("100");
    expect(els(bm[0]!, "base").map((b) => b.getAttribute("displaycolor"))).toEqual(["#7A797AFF", "#A12722FF"]);
    const parts = els(model, "object").filter((o) => els(o, "mesh").length > 0);
    expect(parts.map((o) => [o.getAttribute("id"), o.getAttribute("pid"), o.getAttribute("pindex"), o.getAttribute("type")])).toEqual([
      ["1", "100", "0", "model"],
      ["2", "100", "1", "model"],
    ]);
  });

  it("wraps all colour objects in ONE parent object and builds exactly one item pointing at it", async () => {
    const { model } = await open(two());
    const objects = els(model, "object");
    const parents = objects.filter((o) => els(o, "components").length > 0);
    expect(parents).toHaveLength(1);
    expect(parents[0]!.getAttribute("id")).toBe("3");
    const comps = els(parents[0]!, "component").map((c) => c.getAttribute("objectid"));
    expect(comps).toEqual(["1", "2"]);
    const items = els(model, "item");
    expect(items).toHaveLength(1);
    expect(items[0]!.getAttribute("objectid")).toBe("3");
    const ids = objects.map((o) => o.getAttribute("id"));
    expect(new Set(ids).size).toBe(ids.length);
    for (const c of comps) expect(ids).toContain(c);
  });

  it("keeps ids unique and the parent id clear of sparse bucket ids", async () => {
    const { model } = await open([bucket(2, 0, "#111111"), bucket(5, 16, "#EEEEEE")]);
    const objects = els(model, "object");
    const ids = objects.map((o) => Number(o.getAttribute("id")));
    expect(new Set(ids).size).toBe(ids.length);
    const parent = objects.find((o) => els(o, "components").length > 0)!;
    expect(Number(parent.getAttribute("id"))).toBeGreaterThan(5);
    const meshes = objects.filter((o) => els(o, "mesh").length > 0);
    expect(meshes.map((o) => o.getAttribute("id"))).toEqual(["2", "5"]);
    expect(meshes.map((o) => o.getAttribute("pindex"))).toEqual(["0", "1"]);
    expect(els(model, "item")[0]!.getAttribute("objectid")).toBe(parent.getAttribute("id"));
  });

  it("writes welded vertices and valid triangles; coordinates are scaled to mm and winding preserved", async () => {
    const { model } = await open(two(), 4);
    const mesh = els(model, "mesh")[0]!;
    const verts = els(mesh, "vertex").map((v) => ["x", "y", "z"].map((a) => Number(v.getAttribute(a))));
    const tris = els(mesh, "triangle").map((t) => ["v1", "v2", "v3"].map((a) => Number(t.getAttribute(a))));
    expect(verts).toHaveLength(8);
    expect(tris).toHaveLength(12);
    for (const t of tris) for (const i of t) expect(i).toBeLessThan(verts.length);
    expect(Math.max(...verts.map((v) => v[0]!))).toBeCloseTo(4, 4);
    let vol6 = 0;
    for (const [a, b, c] of tris) {
      const [p, q, r] = [verts[a!]!, verts[b!]!, verts[c!]!];
      vol6 += p[0]! * (q[1]! * r[2]! - q[2]! * r[1]!) - p[1]! * (q[0]! * r[2]! - q[2]! * r[0]!) + p[2]! * (q[0]! * r[1]! - q[1]! * r[0]!);
    }
    expect(vol6 / 6).toBeCloseTo(64, 3); // 4 mm cube, outward winding
  });

  it("scales with scaleMmPerBlock", async () => {
    const { model } = await open([bucket(1, 0, "#7A797A")], 8);
    const xs = els(els(model, "mesh")[0]!, "vertex").map((v) => Number(v.getAttribute("x")));
    expect(Math.max(...xs)).toBeCloseTo(8, 4);
  });

  it("XML-escapes names", async () => {
    const nasty = `Slot "1" & <Gray>`;
    const { model } = await open([bucket(1, 0, "#7A797A", nasty)]);
    expect(els(model, "object")[0]!.getAttribute("name")).toBe(nasty);
    expect(els(model, "base")[0]!.getAttribute("name")).toBe(nasty);
  });

  it("maps slot N to extruder N in model_settings.config", async () => {
    const { text, model } = await open(two());
    const cfg = parse(await text("Metadata/model_settings.config"));
    const parts = els(cfg, "part");
    expect(parts.map((p) => p.getAttribute("id"))).toEqual(["1", "2"]);
    for (const p of parts) {
      const ex = els(p, "metadata").find((m) => m.getAttribute("key") === "extruder");
      expect(ex!.getAttribute("value")).toBe(p.getAttribute("id"));
    }
    const objectIds = els(model, "object").map((o) => o.getAttribute("id"));
    for (const p of parts) expect(objectIds).toContain(p.getAttribute("id"));
  });

  it("skips empty buckets and rejects when nothing is left", async () => {
    const empty: ExportBucket = { bucketId: 2, name: "empty", hexColor: "#000000", mesh: { bucketId: 2, positions: new Int32Array(0), indices: new Uint32Array(0) } };
    const { model } = await open([bucket(1, 0, "#7A797A"), empty]);
    expect(els(model, "mesh")).toHaveLength(1);
    await expect(generateMultiColor3MF([empty], "x", 4)).rejects.toThrow();
  });

  it("refuses to export a bucket that fails manifold validation", async () => {
    const bad: ExportBucket = { bucketId: 1, name: "bad", hexColor: "#7A797A", mesh: tJunctionSlab(1) };
    await expect(generateMultiColor3MF([bad], "x", 4)).rejects.toThrow(/manifold|valid|open/i);
  });

  it("exports an invalid bucket only when validation is explicitly skipped", async () => {
    const bad: ExportBucket = { bucketId: 1, name: "bad", hexColor: "#7A797A", mesh: tJunctionSlab(1) };
    const blob = await generateMultiColor3MF([bad], "x", 4, { skipValidation: true });
    expect(blob.size).toBeGreaterThan(0);
  });

  it("is byte-for-byte deterministic", async () => {
    const a = new Uint8Array(await (await generateMultiColor3MF(two(), "Test Build", 4)).arrayBuffer());
    const b = new Uint8Array(await (await generateMultiColor3MF(two(), "Test Build", 4)).arrayBuffer());
    expect(b).toEqual(a);
  });
});
