// Sanity checks for the test oracles themselves (these must pass at G1).
import { describe, expect, it } from "vitest";
import { analyzeMesh, countContacts, cubeMesh, gridFromCells, tJunctionSlab, mergeMeshes, makeGrid, cellAt, countCells } from "./helpers";

describe("test oracles", () => {
  it("a welded CCW cube is closed with volume s^3 and area 6 s^2", () => {
    const s = analyzeMesh(cubeMesh(1, 0, 0, 0, 3));
    expect(s).toMatchObject({ triangles: 12, vertices: 8, openEdges: 0, nonManifoldEdges: 0, degenerate: 0, volume: 27, area: 54, duplicateVertices: 0 });
  });

  it("the T-junction slab has open edges but correct volume and area", () => {
    const s = analyzeMesh(tJunctionSlab());
    expect(s.openEdges).toBeGreaterThan(0);
    expect(s.volume).toBe(4);
    expect(s.area).toBe(16);
  });

  it("edge-touching cubes show non-manifold edges", () => {
    const m = mergeMeshes(1, [cubeMesh(1, 0, 0, 0, 2), cubeMesh(1, 2, 2, 0, 2)]);
    expect(analyzeMesh(m).nonManifoldEdges).toBeGreaterThan(0);
  });

  it("contact oracle finds edge, symmetric edge and vertex contacts, and nothing in solid shapes", () => {
    expect(countContacts(gridFromCells([1, 1, 1], [[4, 4, 4, 1], [5, 5, 4, 1]]))).toEqual({ edge: 1, vertex: 0 });
    expect(countContacts(gridFromCells([1, 1, 1], [[5, 4, 4, 1], [4, 5, 4, 1]]))).toEqual({ edge: 1, vertex: 0 });
    expect(countContacts(gridFromCells([1, 1, 1], [[4, 4, 4, 1], [5, 5, 5, 1]]))).toEqual({ edge: 0, vertex: 1 });
    expect(countContacts(makeGrid([1, 1, 1], (x, y, z) => (x >= 4 && x < 8 && y >= 4 && y < 8 && z >= 4 && z < 8 ? 1 : 0)))).toEqual({ edge: 0, vertex: 0 });
  });

  it("grid helpers read back what makeGrid wrote, across chunks", () => {
    const g = makeGrid([2, 1, 1], (x) => (x === 16 ? 7 : 0));
    expect(cellAt(g, 16, 3, 3)).toBe(7);
    expect(cellAt(g, 15, 3, 3)).toBe(0);
    expect(cellAt(g, -1, 0, 0)).toBe(0);
    expect(countCells(g, 7)).toBe(256);
  });
});
