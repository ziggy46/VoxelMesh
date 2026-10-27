// docs/03 §5: extractMeshes (D2) -- hidden-face culling + greedy meshing.
// Contract decision: one mesh per bucket with at least one cell, sorted by ascending bucketId; vertices welded per bucket.
import { describe, expect, it } from "vitest";
import { extractMeshes } from "../../worker/meshingKernel/extract";
import type { SparseGrid } from "../../types/mesh";
import { analyzeMesh, bytesOf, exposedFaces, gridFromCells, isClosed, makeGrid, randomGrid, countCells } from "../helpers";

const cuboid = (x0: number, x1: number, y0: number, y1: number, z0: number, z1: number, id = 1) =>
  (x: number, y: number, z: number) => (x >= x0 && x < x1 && y >= y0 && y < y1 && z >= z0 && z < z1 ? id : 0);

describe("extractMeshes", () => {
  it("returns nothing for an empty grid", () => {
    expect(extractMeshes({ blocks: [2, 1, 1], cells: [0, 0] })).toEqual([]);
  });

  it("emits a closed cube for a single cell: 8 vertices, 12 triangles, volume 1", () => {
    const [m] = extractMeshes(gridFromCells([1, 1, 1], [[3, 3, 3, 1]]));
    expect(m!.bucketId).toBe(1);
    expect(m!.positions).toBeInstanceOf(Int32Array);
    expect(m!.indices).toBeInstanceOf(Uint32Array);
    expect(analyzeMesh(m!)).toMatchObject({ triangles: 12, vertices: 8, volume: 1, area: 6, openEdges: 0, nonManifoldEdges: 0 });
  });

  it("windings point outward for every triangle", () => {
    const [m] = extractMeshes(gridFromCells([1, 1, 1], [[3, 3, 3, 1]]));
    const P = m!.positions, I = m!.indices;
    for (let t = 0; t < I.length; t += 3) {
      const v = [0, 1, 2].map((k) => [P[3 * I[t + k]!]!, P[3 * I[t + k]! + 1]!, P[3 * I[t + k]! + 2]!]);
      const [a, b, c] = v as [number[], number[], number[]];
      const e1 = [b[0]! - a[0]!, b[1]! - a[1]!, b[2]! - a[2]!], e2 = [c[0]! - a[0]!, c[1]! - a[1]!, c[2]! - a[2]!];
      const n = [e1[1]! * e2[2]! - e1[2]! * e2[1]!, e1[2]! * e2[0]! - e1[0]! * e2[2]!, e1[0]! * e2[1]! - e1[1]! * e2[0]!];
      const cen = [(a[0]! + b[0]! + c[0]!) / 3 - 3.5, (a[1]! + b[1]! + c[1]!) / 3 - 3.5, (a[2]! + b[2]! + c[2]!) / 3 - 3.5];
      expect(n[0]! * cen[0]! + n[1]! * cen[1]! + n[2]! * cen[2]!).toBeGreaterThan(0);
    }
  });

  it("greedy-merges a full block into one quad per face (12 triangles) with 16-unit extents", () => {
    const [m] = extractMeshes({ blocks: [1, 1, 1], cells: [1] });
    expect(analyzeMesh(m!)).toMatchObject({ triangles: 12, vertices: 8, volume: 4096, openEdges: 0 });
    expect(Math.max(...m!.positions)).toBe(16);
    expect(Math.min(...m!.positions)).toBe(0);
  });

  it("skips interior uniform chunks and merges across chunk boundaries (3x3x3 solid = one 48-cube)", () => {
    const [m] = extractMeshes({ blocks: [3, 3, 3], cells: new Array(27).fill(1) });
    expect(analyzeMesh(m!)).toMatchObject({ triangles: 12, volume: 48 ** 3, openEdges: 0 });
  });

  it("merges a cuboid spanning two chunks into 12 triangles", () => {
    const g = makeGrid([2, 1, 1], cuboid(8, 24, 0, 16, 0, 16));
    const [m] = extractMeshes(g);
    expect(analyzeMesh(m!)).toMatchObject({ triangles: 12, volume: 16 * 16 * 16, openEdges: 0 });
  });

  it("both touching buckets emit the shared face so each mesh is closed", () => {
    const g = makeGrid([1, 1, 1], (x) => (x < 8 ? 1 : 2));
    const ms = extractMeshes(g);
    expect(ms.map((m) => m.bucketId)).toEqual([1, 2]);
    for (const m of ms) {
      expect(isClosed(m)).toBe(true);
      expect(analyzeMesh(m)).toMatchObject({ triangles: 12, volume: 8 * 16 * 16 });
    }
  });

  it("omits empty buckets and sorts by bucketId", () => {
    const g = gridFromCells([1, 1, 1], [[1, 1, 1, 5], [8, 8, 8, 2]]);
    expect(extractMeshes(g).map((m) => m.bucketId)).toEqual([2, 5]);
  });

  it("conserves volume and exposed area on arbitrary shapes, welds vertices, uses valid indices", () => {
    for (const seed of [1, 2, 3]) {
      const g = randomGrid(seed, [1, 1, 1], 0.3, 2);
      const ms = extractMeshes(g);
      for (const m of ms) {
        const s = analyzeMesh(m);
        expect(s.volume).toBe(countCells(g, m.bucketId));
        expect(s.area).toBe(exposedFaces(g, m.bucketId));
        expect(s.duplicateVertices).toBe(0);
        expect(Math.max(...m.indices)).toBeLessThan(m.positions.length / 3);
        expect(m.positions.length % 3).toBe(0);
      }
    }
  });

  it("stairs: volume and area are exact (greedy may leave T-junctions; that is healTJunctions' job)", () => {
    const g = makeGrid([1, 1, 1], (x, y, z) => (z < 8 || (z < 16 && y < 8) ? 1 : 0) * (x < 16 ? 1 : 0));
    const [m] = extractMeshes(g);
    const s = analyzeMesh(m!);
    expect(s.volume).toBe(countCells(g, 1));
    expect(s.area).toBe(exposedFaces(g, 1));
  });

  it("is deterministic", () => {
    const g = randomGrid(9, [1, 1, 1], 0.25, 3);
    const a = extractMeshes(g), b = extractMeshes(g);
    expect(a.map(bytesOf)).toEqual(b.map(bytesOf));
  });

  it("handles a 48^3-chunk solid grid fast (uniform interior chunks are skipped)", () => {
    const g: SparseGrid = { blocks: [48, 48, 48], cells: new Array(48 ** 3).fill(1) };
    const t0 = performance.now();
    const [m] = extractMeshes(g);
    const ms = performance.now() - t0;
    expect(analyzeMesh(m!).triangles).toBe(12);
    expect(ms).toBeLessThan(2000);
  });
});
