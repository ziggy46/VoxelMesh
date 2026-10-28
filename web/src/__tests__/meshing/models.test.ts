// Exact block shapes: colour planning, templates in the grid, the minimum wall, and the pipeline around them.
import { describe, expect, it } from "vitest";
import { PayloadBuilder } from "../../samples/builder";
import { B } from "../../samples/blocks";
import { parsePayload } from "../../payload/loader";
import { DEFAULT_FDM_OPTIONS, type MeshingOptions } from "../../types/mesh";
import type { PaletteEntry } from "../../types/voxelPayload";
import { buildSparseGrid } from "../../worker/meshingKernel/grid";
import { buildModelTemplates, modelBuckets, modelOf, planModelColors } from "../../worker/meshingKernel/models";
import { runPipeline } from "../../worker/pipeline";
import { cellAt, countCells } from "../helpers";

const PINK = "#E3B3AD", DARK = "#553322";
const noWall: MeshingOptions = { ...DEFAULT_FDM_OPTIONS, minNozzleWallMm: 0 };
const withWall: MeshingOptions = { ...DEFAULT_FDM_OPTIONS, scaleMmPerBlock: 4, minNozzleWallMm: 0.8 }; // 4 cells

/** A fence-like block: its hitbox is the whole post, but the model is a post with two rails and a gap. */
const fence = (extra: Partial<PaletteEntry> = {}): PaletteEntry => ({
  id: "test:fence", name: "Fence", color: PINK, category: "thin", boxes: [[6, 0, 6, 10, 16, 10]],
  model: {
    palette: [PINK, DARK],
    boxes: [[6, 0, 6, 10, 6, 10, 0], [6, 6, 6, 10, 9, 10, 1], [6, 12, 6, 10, 15, 10, 1], [6, 15, 6, 10, 16, 10, 0]],
  },
  ...extra,
});
const one = (e: PaletteEntry) => new PayloadBuilder("t", [1, 1, 1]).set(0, 0, 0, e).build();
const ident = (n: number) => Uint16Array.from({ length: n + 1 }, (_, i) => i);

describe("planModelColors", () => {
  const p = one(fence());
  const counts = Uint32Array.from([0, 5]);
  const colors = p.palette.map((e) => ({ color: e.color }));
  it("makes the colour with most cells the block's own and adds the others as extras", () => {
    const plan = planModelColors(p.palette, colors, counts, DEFAULT_FDM_OPTIONS);
    expect(plan.dominant.get(1)).toBe(PINK); // 4x4x(6+1) = 112 cells vs 4x4x6 = 96 dark
    expect(plan.colors[1]!.color).toBe(PINK);
    expect(plan.colors[2]!.color).toBe(DARK);
    expect(plan.modelIndex.get(1)).toEqual([0, 2]);
    expect(plan.counts[2]).toBe(5); // 5 blocks, at least weight 1 each
  });
  it("does nothing when off, without a model, or when the filters drop the block", () => {
    expect(planModelColors(p.palette, colors, counts, { ...DEFAULT_FDM_OPTIONS, exactShapes: false }).modelIndex.size).toBe(0);
    const plain = one(fence({ model: undefined }));
    expect(planModelColors(plain.palette, colors, counts, DEFAULT_FDM_OPTIONS).modelIndex.size).toBe(0);
    const glass = one(fence({ tags: ["glass"] }));
    expect(planModelColors(glass.palette, colors, counts, { ...DEFAULT_FDM_OPTIONS, includeGlass: false }).modelIndex.size).toBe(0);
    expect(modelOf(fence(), { ...DEFAULT_FDM_OPTIONS, exactShapes: false })).toBeNull();
  });
});

describe("templates and the grid", () => {
  const p = one(fence());
  const plan = planModelColors(p.palette, p.palette.map((e) => ({ color: e.color })), Uint32Array.from([0, 1]), noWall);
  const bucketOfIndex = Uint16Array.from([0, 1, 2]);
  const main = Uint16Array.from([0, 1]);

  it("builds the drawn shape, with each colour in its slot, in slicer layout", () => {
    const t = buildModelTemplates(p.palette, plan, bucketOfIndex, main, noWall).get(1)!;
    // MC (x, y, z) -> slicer-local x, 15 - z, y
    const at = (x: number, y: number, z: number) => t[x + (15 - z) * 16 + y * 256]!;
    expect(at(8, 2, 8)).toBe(1); // the post's lower part, own colour
    expect(at(8, 7, 8)).toBe(2); // a rail, the other colour
    expect(at(8, 13, 8)).toBe(2);
    expect(at(8, 10, 8)).toBe(0); // the gap between the rails
    expect(at(2, 7, 8)).toBe(0); // outside the post
  });
  it("replaces the hitbox in the grid", () => {
    const templates = buildModelTemplates(p.palette, plan, bucketOfIndex, main, noWall);
    const g = buildSparseGrid(p, noWall, main, templates);
    expect(countCells(g, 1) + countCells(g, 2)).toBe(4 * 4 * 13);
    expect(countCells(g, 2)).toBe(4 * 4 * 6);
    const plain = buildSparseGrid(p, noWall, main);
    expect(countCells(plain, 1)).toBe(4 * 4 * 16); // the hitbox: one solid post, no gap
    expect(countCells(plain, 2)).toBe(0);
  });
  it("lists the other slots a block's colours reach", () => {
    expect(modelBuckets(p.palette, plan, bucketOfIndex, main).get(1)).toEqual([[2, DARK]]);
    expect(modelBuckets(p.palette, plan, Uint16Array.from([0, 1, 1]), main).size).toBe(0);
  });
  it("widens a thin model to the minimum wall like any thin part", () => {
    const sheet = fence({ boxes: [[0, 0, 0, 16, 16, 1]], model: { palette: [PINK], boxes: [[0, 0, 0, 16, 16, 1, 0]] } });
    const sp = one(sheet);
    const sPlan = planModelColors(sp.palette, sp.palette.map((e) => ({ color: e.color })), Uint32Array.from([0, 1]), withWall);
    const t = buildModelTemplates(sp.palette, sPlan, Uint16Array.from([0, 1]), main, withWall).get(1)!;
    expect(t.filter((v) => v !== 0).length).toBe(16 * 16 * 4); // one cell thick in z becomes four
  });
});

describe("pipeline with exact shapes", () => {
  const scene = new PayloadBuilder("t", [3, 1, 1]).set(0, 0, 0, fence()).set(1, 0, 0, B.stone).set(2, 0, 0, fence()).build();
  it("prints the drawn shape, keeps every colour a closed manifold and reports the blocks", () => {
    const exact = runPipeline(scene, noWall, { maxSlots: 4 });
    const hitbox = runPipeline(scene, { ...noWall, exactShapes: false }, { maxSlots: 4 });
    expect(exact.modelBlocks).toBe(1);
    expect(hitbox.modelBlocks).toBe(0);
    expect(exact.reports.every((r) => r.ok)).toBe(true);
    const vol = (r: ReturnType<typeof runPipeline>) => r.reports.reduce((s, x) => s + x.signedVolume, 0);
    expect(vol(exact)).toBeLessThan(vol(hitbox)); // the gaps between the rails are gone from the model
    expect(exact.modelBuckets.size).toBe(1);
    for (const b of exact.quantization.buckets) expect(b.paletteIndices.every((i) => i < scene.palette.length)).toBe(true);
  });
  it("works with the default wall, relief and face colours all on, deterministically", () => {
    const o = { ...DEFAULT_FDM_OPTIONS, scaleMmPerBlock: 4, reliefDepth: 1 as const };
    const a = runPipeline(scene, o, { maxSlots: 4 }), b = runPipeline(scene, o, { maxSlots: 4 });
    expect(a.reports.every((r) => r.ok)).toBe(true);
    expect(a.meshes.map((m) => Array.from(m.positions))).toEqual(b.meshes.map((m) => Array.from(m.positions)));
  });
  it("is unchanged for builds without models", () => {
    const plain = new PayloadBuilder("t", [1, 1, 1]).set(0, 0, 0, B.stone).build();
    expect(runPipeline(plain, noWall, { maxSlots: 4 }).modelBlocks).toBe(0);
  });
});

describe("loader", () => {
  const base = () => JSON.parse(JSON.stringify({ ...one(fence()), voxelsBase64: one(fence()).voxelsBase64 }));
  it("accepts a well-formed model and keeps it", () => {
    expect(parsePayload(base()).payload.palette[1]!.model?.boxes).toHaveLength(4);
  });
  it("rejects malformed models", () => {
    const bad = (mut: (p: any) => void) => { const p = base(); mut(p); expect(() => parsePayload(p)).toThrow(/model/); };
    bad((p) => { p.palette[1].model = "x"; });
    bad((p) => { p.palette[1].model.palette = ["pink"]; });
    bad((p) => { p.palette[1].model.boxes[0] = [0, 0, 0, 4, 4]; });
    bad((p) => { p.palette[1].model.boxes[0] = [0, 0, 0, 17, 4, 4, 0]; });
    bad((p) => { p.palette[1].model.boxes[0] = [4, 0, 0, 4, 4, 4, 0]; });
    bad((p) => { p.palette[1].model.boxes[0] = [0, 0, 0, 4, 4, 4, 9]; });
  });
});
