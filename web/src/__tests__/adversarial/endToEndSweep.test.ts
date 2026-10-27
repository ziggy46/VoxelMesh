// Final sweep (BUILD_STATUS 5.3): random payloads with arbitrary box shapes, palettes, categories, dimensions, options and
// slot counts through the same runPipeline the worker runs. Every bucket mesh must validate, and runs must be repeatable.
import { describe, expect, it } from "vitest";
import { PayloadBuilder } from "../../samples/builder";
import { mulberry32 } from "../../samples/fixtures";
import { parsePayload } from "../../payload/loader";
import type { MeshingOptions } from "../../types/mesh";
import type { BlockCategory, PaletteEntry, SubVoxelBox } from "../../types/voxelPayload";
import { runPipeline } from "../../worker/pipeline";
import { bytesOf } from "../helpers";

const CATEGORIES: BlockCategory[] = ["solid", "partial", "thin", "foliage", "fluid"];

function randomBox(r: () => number): SubVoxelBox {
  const lo = () => Math.floor(r() * 16);
  const [x0, y0, z0] = [lo(), lo(), lo()];
  const w = (a: number) => Math.min(16, a + 1 + Math.floor(r() * (17 - a)));
  return [x0, y0, z0, w(x0), w(y0), w(z0)];
}

function randomPayload(seed: number) {
  const r = mulberry32(seed);
  const dims: [number, number, number] = [1 + Math.floor(r() * 6), 1 + Math.floor(r() * 5), 1 + Math.floor(r() * 6)];
  const b = new PayloadBuilder(`sweep ${seed}`, dims);
  const palette: PaletteEntry[] = [];
  const n = 3 + Math.floor(r() * 8);
  for (let i = 0; i < n; i++) {
    const category = CATEGORIES[Math.floor(r() * CATEGORIES.length)]!;
    const boxes: SubVoxelBox[] = category === "solid" ? [[0, 0, 0, 16, 16, 16]] : Array.from({ length: 1 + Math.floor(r() * 3) }, () => randomBox(r));
    const color = "#" + Math.floor(r() * 0xffffff).toString(16).padStart(6, "0");
    palette.push({ id: `test:${seed}_${i}`, name: `Block ${i}`, color, category, boxes });
  }
  for (const e of palette) b.def(e);
  const density = 0.15 + r() * 0.6;
  for (let y = 0; y < dims[1]; y++)
    for (let z = 0; z < dims[2]; z++)
      for (let x = 0; x < dims[0]; x++) if (r() < density) b.set(x, y, z, palette[Math.floor(r() * palette.length)]!);
  const options: MeshingOptions = {
    printerMode: r() < 0.5 ? "fdm" : "resin",
    scaleMmPerBlock: [1, 2.5, 4, 8, 15][Math.floor(r() * 5)]!,
    includeFluids: r() < 0.5,
    includeFoliage: r() < 0.5,
    fillInteriorCavities: false,
    fixNonManifold: true,
    minNozzleWallMm: 0,
  };
  if (options.printerMode === "fdm") {
    options.fillInteriorCavities = r() < 0.8;
    options.minNozzleWallMm = 0.8;
  }
  const maxSlots = ([1, 4, 8, 16] as const)[Math.floor(r() * 4)]!;
  return { payload: parsePayload(b.build()).payload, options, maxSlots };
}

describe("end-to-end random payload sweep", () => {
  it("120 random payloads: valid watertight buckets, slot limit respected, repeatable", () => {
    let meshesSeen = 0;
    for (let seed = 1; seed <= 120; seed++) {
      const { payload, options, maxSlots } = randomPayload(seed * 2654435761);
      const a = runPipeline(payload, options, { maxSlots });
      for (const rep of a.reports) expect(rep, `seed ${seed} bucket ${rep.bucketId} ${JSON.stringify(options)}`).toMatchObject({ ok: true });
      expect(a.quantization.buckets.length, `seed ${seed}`).toBeLessThanOrEqual(maxSlots);
      for (const m of a.meshes) expect(m.bucketId).toBeLessThanOrEqual(maxSlots);
      const c = runPipeline(payload, options, { maxSlots });
      expect(c.meshes.map(bytesOf), `seed ${seed} determinism`).toEqual(a.meshes.map(bytesOf));
      meshesSeen += a.meshes.length;
    }
    expect(meshesSeen).toBeGreaterThan(100); // the sweep must not be vacuous (all-empty payloads)
  });

  it("manual slot overrides on random payloads keep every bucket valid", () => {
    for (let seed = 1; seed <= 40; seed++) {
      const { payload, options } = randomPayload(seed * 40503);
      const base = runPipeline(payload, options, { maxSlots: 4 });
      const k = base.quantization.buckets.length;
      if (k < 2) continue;
      const overrides = new Map<number, number>();
      base.quantization.buckets.forEach((b, i) => overrides.set(b.paletteIndices[0]!, ((i + 1) % k) + 1));
      const moved = runPipeline(payload, options, { maxSlots: 4, overrides });
      for (const rep of moved.reports) expect(rep, `seed ${seed}`).toMatchObject({ ok: true });
    }
  });
});
