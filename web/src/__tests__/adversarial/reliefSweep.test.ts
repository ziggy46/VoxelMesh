// Adversarial: random relief maps on random blocks through the full pipeline. Carving must never break watertightness,
// determinism, the slot limit, or the budget contract.
import { describe, expect, it } from "vitest";
import { PayloadBuilder } from "../../samples/builder";
import { generateTerrain, mulberry32 } from "../../samples/fixtures";
import { sampleCastlePayload } from "../../samples/sampleCastlePayload";
import { reliefFrom } from "../../samples/relief";
import { DEFAULT_FDM_OPTIONS, DEFAULT_RESIN_OPTIONS, type MeshingOptions } from "../../types/mesh";
import type { PaletteEntry } from "../../types/voxelPayload";
import { runPipeline } from "../../worker/pipeline";
import { bytesOf } from "../helpers";

function randomReliefPayload(seed: number) {
  const r = mulberry32(seed);
  const dims: [number, number, number] = [1 + Math.floor(r() * 4), 1 + Math.floor(r() * 4), 1 + Math.floor(r() * 4)];
  const b = new PayloadBuilder(`relief ${seed}`, dims);
  const kinds: PaletteEntry[] = [];
  for (let i = 0; i < 4; i++) {
    const lo = Math.floor(r() * 120), span = 20 + Math.floor(r() * 200);
    const h = Math.floor(r() * 1e9);
    kinds.push({
      id: `test:r${seed}_${i}`, name: `R${i}`, color: "#" + Math.floor(r() * 0xffffff).toString(16).padStart(6, "0"),
      category: "solid", boxes: [[0, 0, 0, 16, 16, 16]],
      relief: reliefFrom((f, x, y) => lo + (((Math.imul(f * 256 + x * 16 + y + 1, 2654435761) ^ h) >>> 0) % 1000) / 1000 * span),
    });
  }
  const slab: PaletteEntry = { id: "test:slab", name: "slab", color: "#999999", category: "partial", boxes: [[0, 0, 0, 16, 8, 16]] };
  for (const k of kinds) b.def(k);
  b.def(slab);
  const density = 0.3 + r() * 0.6;
  for (let y = 0; y < dims[1]; y++)
    for (let z = 0; z < dims[2]; z++)
      for (let x = 0; x < dims[0]; x++) if (r() < density) b.set(x, y, z, r() < 0.15 ? slab : kinds[Math.floor(r() * kinds.length)]!);
  const fdm = r() < 0.5;
  const options: MeshingOptions = {
    ...(fdm ? DEFAULT_FDM_OPTIONS : DEFAULT_RESIN_OPTIONS),
    scaleMmPerBlock: [4, 8, 16][Math.floor(r() * 3)]!,
    reliefDepth: r() < 0.5 ? 1 : 2,
    reliefInvert: r() < 0.5,
  };
  return { payload: b.build(), options, maxSlots: ([1, 4, 16] as const)[Math.floor(r() * 3)]! };
}

describe("relief sweep", () => {
  it("80 random relief payloads: every bucket stays a valid closed manifold; runs are repeatable", () => {
    let carvedTotal = 0;
    for (let seed = 1; seed <= 80; seed++) {
      const { payload, options, maxSlots } = randomReliefPayload(seed * 7727);
      const a = runPipeline(payload, options, { maxSlots });
      for (const rep of a.reports) expect(rep, `seed ${seed} bucket ${rep.bucketId} ${JSON.stringify(options)}`).toMatchObject({ ok: true });
      expect(a.reliefSkipped).toBeNull();
      carvedTotal += a.reliefCarved ?? 0;
      const c = runPipeline(payload, options, { maxSlots });
      expect(c.meshes.map(bytesOf), `seed ${seed} determinism`).toEqual(a.meshes.map(bytesOf));
    }
    expect(carvedTotal).toBeGreaterThan(1000); // not vacuous
  });

  it("relief only removes material: solid volume with relief <= volume without it", () => {
    const vol = (o: MeshingOptions) => runPipeline(sampleCastlePayload, o, { maxSlots: 4 }).reports.reduce((s, r) => s + r.signedVolume, 0);
    const base = vol({ ...DEFAULT_RESIN_OPTIONS, fixNonManifold: false });
    const carved = vol({ ...DEFAULT_RESIN_OPTIONS, fixNonManifold: false, reliefDepth: 1 });
    expect(carved).toBeLessThan(base);
    expect(base - carved).toBeGreaterThan(100_000);
  });

  it("the castle with relief meets the heavy-mesh budget (valid, under 15 s) and a large build is skipped, not frozen", () => {
    const t0 = performance.now();
    const r = runPipeline(sampleCastlePayload, { ...DEFAULT_FDM_OPTIONS, reliefDepth: 1 }, { maxSlots: 4 });
    if (!process.env.CI) expect(performance.now() - t0).toBeLessThan(15_000); // wall-clock budget: local only
    expect(r.reports.every((x) => x.ok)).toBe(true);
    expect(r.reliefSkipped).toBeNull();

    const t1 = performance.now();
    const big = runPipeline(generateTerrain(48).payload, { ...DEFAULT_RESIN_OPTIONS, reliefDepth: 1 }, { maxSlots: 4 });
    expect(big.reliefSkipped).not.toBeNull();
    expect(big.reliefCarved).toBeNull();
    expect(big.reports.every((x) => x.ok)).toBe(true);
    if (!process.env.CI) expect(performance.now() - t1).toBeLessThan(12_000 + 3_000); // same budget as without relief, plus the check
  }, 240_000);
});
