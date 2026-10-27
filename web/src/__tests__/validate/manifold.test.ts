// docs/06 §1: validateMesh / validateAll (D4)
import { describe, expect, it } from "vitest";
import { validateAll, validateMesh } from "../../validate/manifold";
import type { ColorBucketMesh } from "../../types/mesh";
import { cubeMesh, mergeMeshes, meshFromTris, boxTris } from "../helpers";

const withIndices = (m: ColorBucketMesh, idx: number[]): ColorBucketMesh => ({ ...m, indices: Uint32Array.from(idx) });

describe("validateMesh", () => {
  it("accepts a watertight cube", () => {
    expect(validateMesh(cubeMesh(3, 0, 0, 0, 2))).toEqual({
      bucketId: 3, triangles: 12, openEdges: 0, nonManifoldEdges: 0, degenerateTriangles: 0, signedVolume: 8, components: 1, ok: true,
    });
  });

  it("reports the 3 open edges left by a missing triangle", () => {
    const c = cubeMesh(1, 0, 0, 0, 2);
    const r = validateMesh(withIndices(c, Array.from(c.indices).slice(3)));
    expect(r.triangles).toBe(11);
    expect(r.openEdges).toBe(3);
    expect(r.ok).toBe(false);
  });

  it("rejects inverted winding via negative signed volume (edges still pair up)", () => {
    const c = cubeMesh(1, 0, 0, 0, 2);
    const flipped = Array.from(c.indices);
    for (let i = 0; i < flipped.length; i += 3) [flipped[i + 1], flipped[i + 2]] = [flipped[i + 2]!, flipped[i + 1]!];
    const r = validateMesh(withIndices(c, flipped));
    expect(r.openEdges).toBe(0);
    expect(r.nonManifoldEdges).toBe(0);
    expect(r.signedVolume).toBe(-8);
    expect(r.ok).toBe(false);
  });

  it("flags zero-area triangles", () => {
    const m = meshFromTris(1, [...boxTris(0, 0, 0, 2, 2, 2), [[0, 0, 0], [1, 0, 0], [2, 0, 0]]]);
    const r = validateMesh(m);
    expect(r.degenerateTriangles).toBe(1);
    expect(r.ok).toBe(false);
  });

  it("counts disjoint shells as separate components and sums their volume", () => {
    const r = validateMesh(mergeMeshes(1, [cubeMesh(1, 0, 0, 0, 2), cubeMesh(1, 10, 0, 0, 2)]));
    expect(r).toMatchObject({ components: 2, signedVolume: 16, triangles: 24, ok: true });
  });

  it("flags two cubes touching along an edge as non-manifold", () => {
    const r = validateMesh(mergeMeshes(1, [cubeMesh(1, 0, 0, 0, 2), cubeMesh(1, 2, 2, 0, 2)]));
    expect(r.nonManifoldEdges).toBeGreaterThan(0);
    expect(r.ok).toBe(false);
  });

  it("flags a duplicated triangle (edge used twice in the same direction)", () => {
    const c = cubeMesh(1, 0, 0, 0, 2);
    const r = validateMesh(withIndices(c, [...c.indices, c.indices[0]!, c.indices[1]!, c.indices[2]!]));
    expect(r.nonManifoldEdges).toBeGreaterThan(0);
    expect(r.ok).toBe(false);
  });

  it("rejects an empty mesh (volume is not positive)", () => {
    const r = validateMesh({ bucketId: 2, positions: new Int32Array(0), indices: new Uint32Array(0) });
    expect(r.triangles).toBe(0);
    expect(r.ok).toBe(false);
  });

  it("validateAll returns one report per mesh in order", () => {
    const rs = validateAll([cubeMesh(4, 0, 0, 0, 1), cubeMesh(9, 5, 5, 5, 3)]);
    expect(rs.map((r) => r.bucketId)).toEqual([4, 9]);
    expect(rs.map((r) => r.signedVolume)).toEqual([1, 27]);
    expect(validateAll([])).toEqual([]);
  });

  it("handles a large mesh in reasonable time", () => {
    const tris = boxTris(0, 0, 0, 1000, 1000, 1000);
    const m = meshFromTris(1, tris);
    const t0 = performance.now();
    expect(validateMesh(m).ok).toBe(true);
    expect(performance.now() - t0).toBeLessThan(1000);
  });
});
