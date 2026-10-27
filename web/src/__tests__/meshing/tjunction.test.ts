// docs/03 §6: healTJunctions (D2)
import { describe, expect, it } from "vitest";
import { healTJunctions } from "../../worker/meshingKernel/tjunction";
import { analyzeMesh, bytesOf, cubeMesh, tJunctionSlab } from "../helpers";

describe("healTJunctions", () => {
  it("closes the cracks in a slab whose bottom face is tiled 1+2 quads", () => {
    const input = tJunctionSlab();
    expect(analyzeMesh(input).openEdges).toBeGreaterThan(0);
    const out = healTJunctions(input);
    const s = analyzeMesh(out);
    expect(s.openEdges).toBe(0);
    expect(s.nonManifoldEdges).toBe(0);
    expect(s.degenerate).toBe(0);
    expect(s.duplicateVertices).toBe(0);
    expect(s.volume).toBe(4);
    expect(s.area).toBe(16);
    expect(s.triangles).toBeGreaterThan(analyzeMesh(input).triangles);
  });

  it("returns Int32Array/Uint32Array with valid indices and keeps the bucket id", () => {
    const out = healTJunctions(tJunctionSlab(7));
    expect(out.bucketId).toBe(7);
    expect(out.positions).toBeInstanceOf(Int32Array);
    expect(out.indices).toBeInstanceOf(Uint32Array);
    expect(Math.max(...out.indices)).toBeLessThan(out.positions.length / 3);
  });

  it("preserves outward winding on every triangle", () => {
    const out = healTJunctions(tJunctionSlab());
    const P = out.positions, I = out.indices;
    for (let t = 0; t < I.length; t += 3) {
      const g = (k: number) => [P[3 * I[t + k]!]!, P[3 * I[t + k]! + 1]!, P[3 * I[t + k]! + 2]!];
      const [a, b, c] = [g(0), g(1), g(2)] as [number[], number[], number[]];
      const e1 = [b[0]! - a[0]!, b[1]! - a[1]!, b[2]! - a[2]!], e2 = [c[0]! - a[0]!, c[1]! - a[1]!, c[2]! - a[2]!];
      const n = [e1[1]! * e2[2]! - e1[2]! * e2[1]!, e1[2]! * e2[0]! - e1[0]! * e2[2]!, e1[0]! * e2[1]! - e1[1]! * e2[0]!];
      const cen = [(a[0]! + b[0]! + c[0]!) / 3 - 1, (a[1]! + b[1]! + c[1]!) / 3 - 1, (a[2]! + b[2]! + c[2]!) / 3 - 0.5];
      expect(n[0]! * cen[0]! + n[1]! * cen[1]! + n[2]! * cen[2]!).toBeGreaterThan(0);
    }
  });

  it("leaves an already-watertight mesh unchanged in size and shape", () => {
    const cube = cubeMesh(1, 0, 0, 0, 4);
    const out = healTJunctions(cube);
    expect(analyzeMesh(out)).toMatchObject({ triangles: 12, vertices: 8, volume: 64, openEdges: 0 });
  });

  it("is idempotent, pure and deterministic", () => {
    const input = tJunctionSlab();
    const snapshot = bytesOf(input).slice();
    const once = healTJunctions(input);
    expect(bytesOf(input)).toEqual(snapshot);
    expect(bytesOf(healTJunctions(input))).toEqual(bytesOf(once));
    expect(analyzeMesh(healTJunctions(once)).triangles).toBe(analyzeMesh(once).triangles);
  });
});
