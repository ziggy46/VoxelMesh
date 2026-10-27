// docs/03 §1-§2: buildSparseGrid (D1)
import { describe, expect, it } from "vitest";
import { B } from "../../samples/blocks";
import { PayloadBuilder } from "../../samples/builder";
import { buildSparseGrid } from "../../worker/meshingKernel/grid";
import { DEFAULT_FDM_OPTIONS, DEFAULT_RESIN_OPTIONS } from "../../types/mesh";
import type { PaletteEntry } from "../../types/voxelPayload";
import { cellAt, countCells, numericChunks } from "../helpers";

const ident = (n: number) => Uint16Array.from({ length: n + 1 }, (_, i) => i);
const POST: PaletteEntry = { id: "test:post", name: "Post", color: "#808080", category: "thin", boxes: [[0, 0, 0, 4, 16, 4]] };

describe("buildSparseGrid", () => {
  it("maps a full block to one uniform numeric chunk", () => {
    const p = new PayloadBuilder("t", [1, 1, 1]).set(0, 0, 0, B.stone).build();
    const g = buildSparseGrid(p, DEFAULT_RESIN_OPTIONS, ident(1));
    expect(g.blocks).toEqual([1, 1, 1]);
    expect(g.cells).toEqual([1]);
  });

  it("swaps dimensions into slicer space: blocks = [sizeX, sizeZ, sizeY]", () => {
    const p = new PayloadBuilder("t", [3, 2, 4]).set(0, 0, 0, B.stone).build();
    const g = buildSparseGrid(p, DEFAULT_RESIN_OPTIONS, ident(1));
    expect(g.blocks).toEqual([3, 4, 2]);
    expect(g.cells.length).toBe(24);
  });

  it("places MC block (x,y,z) at slicer block (x, sizeZ-1-z, y), index bx + by*Bx + bz*Bx*By", () => {
    const p = new PayloadBuilder("t", [3, 1, 3]).set(1, 0, 2, B.stone).build(); // -> slicer block (1,0,0) = index 1
    const g = buildSparseGrid(p, DEFAULT_RESIN_OPTIONS, ident(1));
    expect(g.cells.map((c) => (typeof c === "number" ? c : -1))).toEqual([0, 1, 0, 0, 0, 0, 0, 0, 0]);
    const q = new PayloadBuilder("t", [2, 3, 2]).set(0, 2, 0, B.stone).build(); // slicer block (0, 1, 2); blocks [2,2,3]
    const h = buildSparseGrid(q, DEFAULT_RESIN_OPTIONS, ident(1));
    expect(h.blocks).toEqual([2, 2, 3]);
    expect(h.cells[0 + 1 * 2 + 2 * 4]).toBe(1);
    expect(h.cells.filter((c) => c !== 0).length).toBe(1);
  });

  it("maps MC y to slicer z (a bottom slab fills the lower half of the chunk's z)", () => {
    const p = new PayloadBuilder("t", [1, 1, 1]).set(0, 0, 0, B.stoneSlab).build();
    const g = buildSparseGrid(p, DEFAULT_RESIN_OPTIONS, ident(1));
    expect(g.cells[0]).toBeInstanceOf(Uint16Array);
    expect(countCells(g, 1)).toBe(16 * 16 * 8);
    expect(cellAt(g, 5, 5, 7)).toBe(1);
    expect(cellAt(g, 5, 5, 8)).toBe(0);
  });

  it("flips MC z within the block (rotation, not mirror): box z [0,4] -> slicer y [12,16]", () => {
    const p = new PayloadBuilder("t", [1, 1, 1]).set(0, 0, 0, POST).build();
    const g = buildSparseGrid(p, DEFAULT_RESIN_OPTIONS, Uint16Array.from([0, 3])); // palette 1 -> bucket 3
    expect(countCells(g, 3)).toBe(4 * 16 * 4);
    expect(cellAt(g, 1, 14, 5)).toBe(3);
    expect(cellAt(g, 1, 2, 5)).toBe(0);
    expect(cellAt(g, 5, 14, 5)).toBe(0);
  });

  it("skips fluid and foliage unless included", () => {
    const p = new PayloadBuilder("t", [3, 1, 1]).set(0, 0, 0, B.water).set(1, 0, 0, B.poppy).set(2, 0, 0, B.stone).build();
    const map = Uint16Array.from([0, 1, 2, 3]);
    const none = buildSparseGrid(p, DEFAULT_RESIN_OPTIONS, map);
    expect([countCells(none, 1), countCells(none, 2), countCells(none, 3)]).toEqual([0, 0, 4096]);
    const fluid = buildSparseGrid(p, { ...DEFAULT_RESIN_OPTIONS, includeFluids: true }, map);
    expect([countCells(fluid, 1), countCells(fluid, 2)]).toEqual([16 * 14 * 16, 0]);
    const foliage = buildSparseGrid(p, { ...DEFAULT_RESIN_OPTIONS, includeFoliage: true }, map);
    expect([countCells(foliage, 1), countCells(foliage, 2)]).toEqual([0, 8 * 10 * 8]);
  });

  it("treats entries mapped to bucket 0 as air", () => {
    const p = new PayloadBuilder("t", [1, 1, 1]).set(0, 0, 0, B.stone).build();
    expect(countCells(buildSparseGrid(p, DEFAULT_RESIN_OPTIONS, Uint16Array.from([0, 0])))).toBe(0);
  });

  it("dilates thin boxes in FDM only", () => {
    const p = new PayloadBuilder("t", [1, 1, 1]).set(0, 0, 0, B.chain).build(); // 2 wide
    expect(countCells(buildSparseGrid(p, DEFAULT_FDM_OPTIONS, ident(1)))).toBe(4 * 16 * 4);
    expect(countCells(buildSparseGrid(p, DEFAULT_RESIN_OPTIONS, ident(1)))).toBe(2 * 16 * 2);
  });

  it("is sparse: a mostly-empty 100^3-block selection stays numeric chunks and builds quickly", () => {
    const b = new PayloadBuilder("big", [100, 100, 100]);
    b.set(0, 0, 0, B.stone).set(99, 99, 99, B.stone).set(50, 50, 50, B.stoneSlab);
    const t0 = performance.now();
    const g = buildSparseGrid(b.build(), DEFAULT_RESIN_OPTIONS, ident(2));
    const ms = performance.now() - t0;
    expect(g.cells.length).toBe(1_000_000);
    expect(numericChunks(g)).toBeGreaterThanOrEqual(999_999 - 1); // only the slab block is a dense chunk
    expect(ms).toBeLessThan(5000);
  });

  it("is deterministic", () => {
    const p = new PayloadBuilder("t", [2, 2, 2]).set(0, 0, 0, B.stairHiS).set(1, 1, 1, B.lantern).build();
    const a = buildSparseGrid(p, DEFAULT_FDM_OPTIONS, ident(3));
    const c = buildSparseGrid(p, DEFAULT_FDM_OPTIONS, ident(3));
    expect(a.cells.map((x) => (typeof x === "number" ? x : Array.from(x)))).toEqual(c.cells.map((x) => (typeof x === "number" ? x : Array.from(x))));
  });
});
