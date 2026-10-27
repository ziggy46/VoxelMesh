// Adversarial: cell-level random grids (not block-aligned boxes) through fill -> repair -> extract -> heal -> validate,
// plus real pipeline output through both exporters.
import JSZip from "jszip";
import { describe, expect, it } from "vitest";
import { generateBinarySTL, generateMultiColor3MF } from "../../exporters/slicerExporters";
import { fixtureBucketMap, goldenFixtures } from "../../samples/fixtures";
import { validateAll } from "../../validate/manifold";
import { extractMeshes } from "../../worker/meshingKernel/extract";
import { fillInteriorCavities } from "../../worker/meshingKernel/fill";
import { runMeshingPipeline } from "../../worker/meshingKernel";
import { healTJunctions } from "../../worker/meshingKernel/tjunction";
import { repairNonManifold } from "../../worker/meshingKernel/repair";
import { DEFAULT_FDM_OPTIONS, DEFAULT_RESIN_OPTIONS } from "../../types/mesh";
import { analyzeMesh, countCells, countContacts, randomGrid } from "../helpers";

describe("cell-level fuzz", () => {
  for (const [blocks, density, buckets] of [
    [[1, 1, 1], 0.15, 2], [[1, 1, 1], 0.5, 3], [[2, 2, 1], 0.2, 3], [[2, 1, 2], 0.35, 4], [[3, 1, 1], 0.1, 1],
  ] as const) {
    it(`blocks ${blocks.join("x")} density ${density} buckets ${buckets}: repaired + healed meshes are watertight`, () => {
      for (let seed = 1; seed <= 12; seed++) {
        const g = randomGrid(seed * 7919, [...blocks] as [number, number, number], density, buckets);
        repairNonManifold(g);
        expect(countContacts(g), `seed ${seed}`).toEqual({ edge: 0, vertex: 0 });
        const meshes = extractMeshes(g).map(healTJunctions);
        for (const r of validateAll(meshes)) expect(r, `seed ${seed} bucket ${r.bucketId}`).toMatchObject({ ok: true, openEdges: 0, nonManifoldEdges: 0 });
        for (const m of meshes) expect(analyzeMesh(m).volume, `seed ${seed}`).toBe(countCells(g, m.bucketId));
      }
    });
  }

  it("fill then repair keeps every bucket mesh watertight", () => {
    for (let seed = 1; seed <= 12; seed++) {
      const g = randomGrid(seed * 104729, [2, 2, 2], 0.55, 2);
      fillInteriorCavities(g);
      repairNonManifold(g);
      for (const r of validateAll(extractMeshes(g).map(healTJunctions))) expect(r.ok, `seed ${seed}`).toBe(true);
    }
  });

  it("repair never removes solid cells and never creates cells beyond bridges + recolours", () => {
    for (let seed = 1; seed <= 10; seed++) {
      const g = randomGrid(seed * 31, [2, 1, 1], 0.3, 3);
      const before = countCells(g);
      const r = repairNonManifold(g);
      expect(countCells(g)).toBe(before + r.bridgesAdded);
    }
  });
});

describe("real pipeline output through the exporters", () => {
  const castle = goldenFixtures().find((f) => f.name === "sample castle")!;
  for (const [mode, o] of [["fdm", DEFAULT_FDM_OPTIONS], ["resin", DEFAULT_RESIN_OPTIONS]] as const) {
    it(`castle ${mode}: 3MF and STL are produced and consistent`, async () => {
      const meshes = runMeshingPipeline(castle.payload, o, fixtureBucketMap(castle.payload, castle.buckets));
      const buckets = meshes.map((m) => ({ bucketId: m.bucketId, name: `Slot ${m.bucketId}`, hexColor: "#808080", mesh: m }));
      const zip = await JSZip.loadAsync(await (await generateMultiColor3MF(buckets, "Castle", o.scaleMmPerBlock)).arrayBuffer());
      const model = await zip.file("3D/3dmodel.model")!.async("string");
      expect((model.match(/<item /g) ?? []).length).toBe(1);
      expect((model.match(/<component /g) ?? []).length).toBe(meshes.length);
      const tris = meshes.reduce((s, m) => s + m.indices.length / 3, 0);
      expect(generateBinarySTL(buckets, o.scaleMmPerBlock).byteLength).toBe(84 + 50 * tris);
    });
  }
});
