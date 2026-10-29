// Finer lattice (detail 2 or 4): a block is detail^3 chunks of 16^3 cells and every kernel step follows.
import { describe, expect, it } from "vitest";
import { PayloadBuilder } from "../../samples/builder";
import { B } from "../../samples/blocks";
import { reliefFrom } from "../../samples/relief";
import { DEFAULT_FDM_OPTIONS, DEFAULT_RESIN_OPTIONS, type MeshingOptions } from "../../types/mesh";
import type { PaletteEntry } from "../../types/voxelPayload";
import { applyFaceSkins, skinDepth } from "../../worker/meshingKernel/faces";
import { buildSparseGrid } from "../../worker/meshingKernel/grid";
import { applyRelief, reliefLevels } from "../../worker/meshingKernel/relief";
import { chooseDetail, runPipeline } from "../../worker/pipeline";
import { cellAt, countCells } from "../helpers";

const at = (detail: 1 | 2 | 4, over: Partial<MeshingOptions> = {}): MeshingOptions => ({ ...DEFAULT_RESIN_OPTIONS, scaleMmPerBlock: 8, detail, ...over });
const ident = (n: number) => Uint16Array.from({ length: n + 1 }, (_, i) => i);
const one = (e: PaletteEntry) => new PayloadBuilder("t", [1, 1, 1]).set(0, 0, 0, e).build();
const cube = (extra: Partial<PaletteEntry> = {}): PaletteEntry => ({ id: "t:cube", name: "Cube", color: "#808080", category: "solid", boxes: [[0, 0, 0, 16, 16, 16]], ...extra });

describe("grid at detail", () => {
  it("a full cube is detail^3 uniform chunks", () => {
    const g = buildSparseGrid(one(cube()), at(2), ident(1));
    expect(g.blocks).toEqual([2, 2, 2]);
    expect(g.cells).toEqual(new Array(8).fill(1));
  });
  it("boxes scale with the lattice: a half slab fills half the chunks and the rest are air", () => {
    const g = buildSparseGrid(one(B.stoneSlab), at(4), ident(2));
    expect(g.blocks).toEqual([4, 4, 4]);
    expect(countCells(g, 1)).toBe(64 * 64 * 32); // 64^3 cells in all, half of them
    expect(g.cells.filter((c) => c === 1).length).toBe(32); // whole chunks stay numbers
  });
  it("a thin box splits across chunk seams and keeps its exact size", () => {
    const post = cube({ boxes: [[7, 0, 7, 9, 16, 9]], category: "partial" });
    const g = buildSparseGrid(one(post), at(2), ident(1));
    // 2 sub-voxels at detail 2 = 4 cells, from cell 14 to 18 in x and z (seam at 16)
    let n = 0;
    for (let z = 0; z < 32; z++) for (let y = 0; y < 32; y++) for (let x = 0; x < 32; x++) if (cellAt(g, x, y, z) === 1) n++;
    expect(n).toBe(4 * 4 * 32);
  });
});

describe("relief at detail", () => {
  it("a texel's levels are smoothed between centres and keep the extremes", () => {
    const face = Uint8Array.from({ length: 256 }, (_, i) => (i === 17 ? 0 : 255));
    const fine = reliefLevels(face, 2, false, 4);
    expect(fine.length).toBe(64 * 64);
    expect(Math.max(...fine)).toBe(2);
    // the dark texel is texel (1,1): cells 4..7, and the smooth map falls off outside it
    expect(fine[6 + 6 * 64]).toBeGreaterThanOrEqual(fine[0]!);
    expect(fine[0]).toBe(0);
  });
  it("detail 1 is exactly the old map", () => {
    const face = Uint8Array.from({ length: 256 }, (_, i) => (i === 17 ? 0 : 255));
    expect([...reliefLevels(face, 1, false, 1)]).toEqual([...reliefLevels(face, 1, false)]);
  });
  it("carves only the surface layer on a face with a hole, at detail 2", () => {
    const e = cube({ relief: reliefFrom((f, a, b) => (f === 1 && a >= 6 && a < 10 && b >= 6 && b < 10 ? 0 : 255)) });
    const p = one(e);
    const o = at(2, { reliefDepth: 1 });
    const g = buildSparseGrid(p, o, ident(1));
    const r = applyRelief(g, p, ident(1), o);
    expect(r.removed).toBeGreaterThan(0);
    // MC up is slicer Z: the middle of the top face is carved one cell, the rim is not
    expect(cellAt(g, 16, 16, 31)).toBe(0);
    expect(cellAt(g, 16, 16, 30)).toBe(1);
    expect(cellAt(g, 1, 1, 31)).toBe(1);
  });
});

describe("face skins at detail", () => {
  it("recolour whole texels, 4x4 cells each at detail 4, and the skin gets thicker in cells", () => {
    const six = Uint16Array.from({ length: 1536 }, (_, t) => (t === 256 + 3 ? 2 : 0)); // only the top texel (3,0)
    const o = at(4, { scaleMmPerBlock: 16 });
    expect(skinDepth(o)).toBe(3); // 0.8 mm at 0.25 mm per cell
    const p = one(cube());
    const g = buildSparseGrid(p, o, ident(1));
    applyFaceSkins(g, p, new Map([[1, six]]), o);
    expect(countCells(g, 2)).toBe(4 * 4 * 3);
    expect(cellAt(g, 12, 63, 63)).toBe(2); // texel a = 3 -> cells 12..15, b = 0 -> MC z 0 = slicer y 63
    expect(cellAt(g, 16, 63, 63)).toBe(1);
  });
});

describe("pipeline at detail", () => {
  const textured = new PayloadBuilder("t", [2, 1, 2])
    .set(0, 0, 0, cube({ relief: reliefFrom((_f, a, b) => ((a * 7 + b * 13) % 5) * 50) })).set(1, 0, 1, B.stone).set(1, 0, 0, B.stoneSlab).build();
  it("is watertight at 2x and 4x and reports the detail it used", () => {
    for (const d of [2, 4] as const) {
      const r = runPipeline(textured, at(d, { reliefDepth: 1, fillInteriorCavities: true, fixNonManifold: true }), { maxSlots: 4 });
      expect(r.detail).toBe(d);
      expect(r.reliefCarved).toBeGreaterThan(0);
      expect(r.reports.every((x) => x.ok)).toBe(true);
    }
  });
  it("a block is 16 * detail lattice units wide", () => {
    const r = runPipeline(one(cube()), at(4), { maxSlots: 1 });
    const xs = Array.from(r.meshes[0]!.positions).filter((_, i) => i % 3 === 0);
    expect(Math.max(...xs)).toBe(64);
  });
  it("lowers detail for a build too big for it, and keeps what it can afford", () => {
    const big = { ...one(cube()), dimensions: [100, 1, 1] as [number, number, number] };
    expect(chooseDetail(big, at(4))).toBe(2); // 100 blocks * 4 > 256 cells per axis in blocks
    expect(chooseDetail(big, at(1))).toBe(1);
    expect(chooseDetail(one(cube()), at(4))).toBe(4);
  });
  it("is deterministic", () => {
    const o = at(2, { reliefDepth: 1 });
    const a = runPipeline(textured, o, { maxSlots: 4 }), b = runPipeline(textured, o, { maxSlots: 4 });
    expect(a.meshes.map((m) => Array.from(m.positions))).toEqual(b.meshes.map((m) => Array.from(m.positions)));
  });
  it("thin parts are still thickened to the minimum wall at detail", () => {
    const post = cube({ boxes: [[7, 0, 7, 9, 16, 9]], category: "partial" });
    const o = at(2, { ...DEFAULT_FDM_OPTIONS, scaleMmPerBlock: 8, detail: 2, minNozzleWallMm: 0.8 });
    const g = buildSparseGrid(one(post), o, ident(1));
    // 0.8 mm at 8 mm per block and 32 cells per block = 3.2 -> 4 cells; the post was 4 cells already
    let n = 0;
    for (let x = 0; x < 32; x++) if (cellAt(g, x, 15, 16) === 1) n++;
    expect(n).toBeGreaterThanOrEqual(4);
  });
});
