// docs/06 §2-§3: golden fixtures, property tests. Needs D1+D2+D4 kernels; fails with NOT_IMPLEMENTED until then.
import { describe, expect, it } from "vitest";
import { runMeshingPipeline } from "../../worker/meshingKernel";
import { validateAll } from "../../validate/manifold";
import { chiralL, fixtureBucketMap, goldenFixtures, randomSparseField, type Fixture } from "../../samples/fixtures";
import { DEFAULT_FDM_OPTIONS, DEFAULT_RESIN_OPTIONS, type MeshingOptions } from "../../types/mesh";
import { analyzeMesh, bytesOf, hasVertex } from "../helpers";

const MODES: Array<["fdm" | "resin", MeshingOptions]> = [["fdm", DEFAULT_FDM_OPTIONS], ["resin", DEFAULT_RESIN_OPTIONS]];

const run = (f: Fixture, o: MeshingOptions) => runMeshingPipeline(f.payload, o, fixtureBucketMap(f.payload, f.buckets));
const totalVolume = (ms: ReturnType<typeof run>) => ms.reduce((s, m) => s + analyzeMesh(m).volume, 0);

describe.each(goldenFixtures().map((f) => [f.name, f] as const))("golden fixture: %s", (_name, f) => {
  it.each(MODES)("validates clean in %s mode", (_m, o) => {
    const meshes = run(f, o);
    expect(meshes.length).toBeGreaterThan(0);
    for (const r of validateAll(meshes)) {
      expect(r, `bucket ${r.bucketId}`).toMatchObject({ openEdges: 0, nonManifoldEdges: 0, degenerateTriangles: 0, ok: true });
      expect(r.signedVolume).toBeGreaterThan(0);
    }
  });

  it.each(MODES)("has the expected solid volume in %s mode", (m, o) => {
    if (!f.volume) return;
    const [lo, hi] = f.volume[m];
    const v = totalVolume(run(f, o));
    expect(v).toBeGreaterThanOrEqual(lo);
    expect(v).toBeLessThanOrEqual(hi);
  });

  it.each(MODES)("is deterministic in %s mode", (_m, o) => {
    expect(run(f, o).map(bytesOf)).toEqual(run(f, o).map(bytesOf));
  });
});

describe("mode laws and geometry", () => {
  it("a single full block is one closed 12-triangle cube in both modes", () => {
    const f = goldenFixtures()[0]!;
    for (const [, o] of MODES) {
      const ms = run(f, o);
      expect(ms).toHaveLength(1);
      expect(analyzeMesh(ms[0]!)).toMatchObject({ triangles: 12, volume: 4096 });
    }
  });

  it("an isolated slab keeps its height: MC y maps to slicer z (max z = 8)", () => {
    const f = goldenFixtures().find((x) => x.name === "slab")!;
    const [m] = run(f, DEFAULT_RESIN_OPTIONS);
    let maxZ = 0;
    for (let i = 2; i < m!.positions.length; i += 3) maxZ = Math.max(maxZ, m!.positions[i]!);
    expect(maxZ).toBe(8);
  });

  it("the transform is a rotation: a chiral L keeps its handedness", () => {
    // MC blocks (0,0,0),(1,0,0),(0,0,1) -> slicer solid {x<32, 16<=y<32} U {x<16, y<16}.
    const [m] = run(chiralL(), DEFAULT_RESIN_OPTIONS);
    expect(hasVertex(m!, 32, 32, 0)).toBe(true);
    expect(hasVertex(m!, 32, 16, 0)).toBe(true);
    expect(hasVertex(m!, 16, 16, 0)).toBe(true);
    expect(hasVertex(m!, 32, 0, 0)).toBe(false); // would exist if mirrored
    expect(analyzeMesh(m!).volume).toBe(3 * 4096);
  });

  it("the castle differs between FDM (filled/dilated) and Resin (native)", () => {
    const castle = goldenFixtures().find((x) => x.name === "sample castle")!;
    const fdm = totalVolume(run(castle, DEFAULT_FDM_OPTIONS));
    const resin = totalVolume(run(castle, DEFAULT_RESIN_OPTIONS));
    expect(fdm).toBeGreaterThan(resin); // sealed tower rooms get filled; thin parts get dilated
  });

  it("resin never fills or dilates: single-colour sealed room volume is exactly the raw solid", () => {
    const f = goldenFixtures().find((x) => x.name === "sealed hollow room")!;
    expect(totalVolume(run(f, DEFAULT_RESIN_OPTIONS))).toBe(26 * 4096);
  });
});

describe("seeded random sparse fields (200 seeds)", () => {
  it.each(MODES)("all validate clean in %s mode", (_m, o) => {
    for (let seed = 1; seed <= 200; seed++) {
      const f = randomSparseField(seed);
      const reports = validateAll(run(f, o));
      for (const r of reports) {
        if (!r.ok) throw new Error(`seed ${seed} bucket ${r.bucketId}: ${JSON.stringify(r)}`);
      }
    }
  });
});
