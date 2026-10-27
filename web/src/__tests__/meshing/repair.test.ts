// docs/03 §4: repairNonManifold (D1). Rule is PER BUCKET.
import { describe, expect, it } from "vitest";
import { repairNonManifold } from "../../worker/meshingKernel/repair";
import { cellAt, countCells, countContacts, gridFromCells, gridsEqual, makeGrid } from "../helpers";

const clean = (g: Parameters<typeof countContacts>[0]) => countContacts(g);

describe("repairNonManifold", () => {
  it("bridges a solid/air diagonal edge contact by converting b (air) to the bucket", () => {
    const g = gridFromCells([1, 1, 1], [[4, 4, 4, 1], [5, 5, 4, 1]]); // a=(4,4) d=(5,5) in the x/y plane
    expect(repairNonManifold(g)).toEqual({ bridgesAdded: 1, recolored: 0 });
    expect(cellAt(g, 5, 4, 4)).toBe(1); // b first
    expect(cellAt(g, 4, 5, 4)).toBe(0);
    expect(clean(g)).toEqual({ edge: 0, vertex: 0 });
  });

  it("resolves edge contacts along every axis", () => {
    const cases: Array<Array<[number, number, number, number]>> = [
      [[4, 4, 4, 1], [4, 5, 5, 1]], // axis x
      [[4, 4, 4, 1], [5, 4, 5, 1]], // axis y
      [[4, 4, 4, 1], [5, 5, 4, 1]], // axis z
      [[5, 4, 4, 1], [4, 5, 4, 1]], // symmetric (b == c)
    ];
    for (const cells of cases) {
      const g = gridFromCells([1, 1, 1], cells);
      const r = repairNonManifold(g);
      expect(r.bridgesAdded).toBe(1);
      expect(r.recolored).toBe(0);
      expect(countCells(g)).toBe(3);
      expect(clean(g)).toEqual({ edge: 0, vertex: 0 });
    }
  });

  it("per-bucket rule: a checkerboard of two solid colours is fixed by recolouring b to A", () => {
    const g = gridFromCells([1, 1, 1], [[4, 4, 4, 1], [5, 5, 4, 1], [5, 4, 4, 2], [4, 5, 4, 2]]);
    expect(repairNonManifold(g)).toEqual({ bridgesAdded: 0, recolored: 1 });
    expect(cellAt(g, 5, 4, 4)).toBe(1);
    expect(cellAt(g, 4, 5, 4)).toBe(2);
    expect(clean(g)).toEqual({ edge: 0, vertex: 0 });
  });

  it("fixes a bucket's diagonal contact even when the separating cells are another bucket", () => {
    // bucket 1 diagonal, bucket 2 occupies both 'other' cells: the old solid-vs-air rule would miss it.
    const g = gridFromCells([1, 1, 1], [[4, 4, 4, 1], [5, 5, 4, 1], [5, 4, 4, 2], [4, 5, 4, 2], [6, 4, 4, 2]]);
    repairNonManifold(g);
    expect(clean(g)).toEqual({ edge: 0, vertex: 0 });
  });

  it("resolves a vertex contact (opposite corners of a 2x2x2) without recolouring", () => {
    const g = gridFromCells([1, 1, 1], [[4, 4, 4, 1], [5, 5, 5, 1]]);
    const r = repairNonManifold(g);
    expect(r.bridgesAdded).toBeGreaterThanOrEqual(1);
    expect(r.recolored).toBe(0);
    expect(cellAt(g, 4, 4, 4)).toBe(1);
    expect(cellAt(g, 5, 5, 5)).toBe(1);
    expect(countCells(g)).toBe(2 + r.bridgesAdded);
    expect(clean(g)).toEqual({ edge: 0, vertex: 0 });
  });

  it("works across a chunk boundary", () => {
    const g = gridFromCells([2, 1, 1], [[15, 4, 4, 1], [16, 5, 4, 1]]);
    expect(repairNonManifold(g)).toEqual({ bridgesAdded: 1, recolored: 0 });
    expect(cellAt(g, 16, 4, 4)).toBe(1);
    expect(clean(g)).toEqual({ edge: 0, vertex: 0 });
  });

  it("handles contacts on the grid boundary without reading out of range", () => {
    const g = gridFromCells([1, 1, 1], [[0, 0, 0, 1], [1, 1, 0, 1], [15, 15, 15, 1], [14, 14, 15, 1]]);
    expect(() => repairNonManifold(g)).not.toThrow();
    expect(clean(g)).toEqual({ edge: 0, vertex: 0 });
  });

  it("is a no-op on clean geometry and idempotent", () => {
    const cube = makeGrid([1, 1, 1], (x, y, z) => (x >= 4 && x < 12 && y >= 4 && y < 12 && z >= 4 && z < 12 ? 1 : 0));
    const before = makeGrid([1, 1, 1], (x, y, z) => (x >= 4 && x < 12 && y >= 4 && y < 12 && z >= 4 && z < 12 ? 1 : 0));
    expect(repairNonManifold(cube)).toEqual({ bridgesAdded: 0, recolored: 0 });
    expect(gridsEqual(cube, before)).toBe(true);

    const g = gridFromCells([1, 1, 1], [[4, 4, 4, 1], [5, 5, 4, 1]]);
    repairNonManifold(g);
    expect(repairNonManifold(g)).toEqual({ bridgesAdded: 0, recolored: 0 });
  });

  it("is deterministic", () => {
    const mk = () => gridFromCells([1, 1, 1], [[4, 4, 4, 1], [5, 5, 4, 1], [8, 8, 8, 2], [9, 9, 9, 2]]);
    const a = mk(), b = mk();
    expect(repairNonManifold(a)).toEqual(repairNonManifold(b));
    expect(gridsEqual(a, b)).toBe(true);
  });
});
