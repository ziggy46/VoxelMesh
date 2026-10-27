// docs/03 §3: fillInteriorCavities (D1)
import { describe, expect, it } from "vitest";
import { fillInteriorCavities } from "../../worker/meshingKernel/fill";
import type { SparseGrid } from "../../types/mesh";
import { cellAt, countCells, gridsEqual, makeGrid } from "../helpers";

const inCube = (x: number, y: number, z: number, lo: number, hi: number) =>
  x >= lo && x < hi && y >= lo && y < hi && z >= lo && z < hi;
/** Solid shell [4,28)^3 with a cavity [10,22)^3 inside a 2x2x2-block grid. */
const shell = (id: (x: number, y: number, z: number) => number = () => 1, hole?: (x: number, y: number, z: number) => boolean) =>
  makeGrid([2, 2, 2], (x, y, z) => (inCube(x, y, z, 4, 28) && !inCube(x, y, z, 10, 22) && !(hole?.(x, y, z) ?? false) ? id(x, y, z) : 0));

describe("fillInteriorCavities", () => {
  it("fills a sealed cavity with the surrounding bucket and leaves the outside alone", () => {
    const g = shell();
    fillInteriorCavities(g);
    expect(countCells(g)).toBe(24 ** 3);
    expect(cellAt(g, 16, 16, 16)).toBe(1);
    expect(cellAt(g, 2, 2, 2)).toBe(0);
    expect(cellAt(g, 28, 16, 16)).toBe(0);
  });

  it("does not fill a cavity with a 1-sub-voxel leak", () => {
    const hole = (x: number, y: number, z: number) => x === 16 && y === 16 && z >= 4 && z < 10;
    const g = shell(() => 1, hole);
    fillInteriorCavities(g);
    expect(gridsEqual(g, shell(() => 1, hole))).toBe(true);
  });

  it("assigns the LOWEST adjacent bucket id, not the majority or first-seen", () => {
    const g = shell((_x, _y, z) => (z < 10 ? 1 : 2)); // floor is bucket 1 (one face), five faces are bucket 2
    fillInteriorCavities(g);
    expect(cellAt(g, 16, 16, 16)).toBe(1);
    expect(countCells(g, 1) + countCells(g, 2)).toBe(24 ** 3);
  });

  it("fills each cavity from its own neighbours", () => {
    const g = makeGrid([3, 1, 1], (x, y, z) => {
      const pocket = (x >= 6 && x < 10 || x >= 30 && x < 34) && y >= 6 && y < 10 && z >= 6 && z < 10;
      return pocket ? 0 : x < 24 ? 3 : 2;
    });
    fillInteriorCavities(g);
    expect(cellAt(g, 7, 7, 7)).toBe(3);
    expect(cellAt(g, 31, 7, 7)).toBe(2);
    expect(countCells(g, 0)).toBe(0);
  });

  it("treats air touching the model boundary as exterior", () => {
    const g = makeGrid([1, 1, 1], (x, y, z) => ((x === 0 && y === 8 && z === 8) || (x === 8 && y === 8 && z === 8) ? 0 : 1));
    fillInteriorCavities(g);
    expect(cellAt(g, 0, 8, 8)).toBe(0);
    expect(cellAt(g, 8, 8, 8)).toBe(1);
  });

  it("fills a whole enclosed numeric-air chunk without expanding it", () => {
    const cells: Array<number | Uint16Array> = Array.from({ length: 27 }, (_, i) => (i === 13 ? 0 : 1));
    const g: SparseGrid = { blocks: [3, 3, 3], cells };
    fillInteriorCavities(g);
    expect(g.cells[13]).toBe(1);
  });

  it("is a no-op on empty and fully solid grids", () => {
    const empty: SparseGrid = { blocks: [2, 2, 2], cells: new Array(8).fill(0) };
    fillInteriorCavities(empty);
    expect(empty.cells).toEqual(new Array(8).fill(0));
    const solid: SparseGrid = { blocks: [2, 2, 2], cells: new Array(8).fill(4) };
    fillInteriorCavities(solid);
    expect(solid.cells).toEqual(new Array(8).fill(4));
  });

  it("is idempotent", () => {
    const g = shell();
    fillInteriorCavities(g);
    const again = shell();
    fillInteriorCavities(again);
    fillInteriorCavities(again);
    expect(gridsEqual(g, again)).toBe(true);
  });

  it("is sparse: a 48^3-chunk grid of exterior air is traversed chunk-wise (no per-cell BFS)", () => {
    const n = 48;
    const cells: Array<number | Uint16Array> = new Array(n ** 3).fill(0);
    cells[0] = 1;
    const g: SparseGrid = { blocks: [n, n, n], cells };
    const t0 = performance.now();
    fillInteriorCavities(g);
    const ms = performance.now() - t0;
    expect(g.cells.filter((c) => c !== 0).length).toBe(1);
    expect(ms).toBeLessThan(3000);
  });

  it("is sparse: a hollow 48^3-chunk shell fills its 46^3 enclosed chunks as numbers", () => {
    const n = 48;
    const cells: Array<number | Uint16Array> = new Array(n ** 3);
    for (let z = 0; z < n; z++)
      for (let y = 0; y < n; y++)
        for (let x = 0; x < n; x++) cells[x + y * n + z * n * n] = x === 0 || y === 0 || z === 0 || x === n - 1 || y === n - 1 || z === n - 1 ? 1 : 0;
    const g: SparseGrid = { blocks: [n, n, n], cells };
    const t0 = performance.now();
    fillInteriorCavities(g);
    const ms = performance.now() - t0;
    expect(g.cells.every((c) => c === 1)).toBe(true);
    expect(ms).toBeLessThan(5000);
  });
});
