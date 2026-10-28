// One shared rule decides what is part of the print: fluids, foliage, glass and leaves.
import { describe, expect, it } from "vitest";
import { PayloadBuilder } from "../../samples/builder";
import { B } from "../../samples/blocks";
import { DEFAULT_RESIN_OPTIONS, type MeshingOptions } from "../../types/mesh";
import type { PaletteEntry } from "../../types/voxelPayload";
import { buildSparseGrid } from "../../worker/meshingKernel/grid";
import { isIncluded } from "../../worker/meshingKernel/filters";
import { runPipeline } from "../../worker/pipeline";
import { countCells } from "../helpers";

const full = [[0, 0, 0, 16, 16, 16]] as PaletteEntry["boxes"];
const GLASS: PaletteEntry = { id: "minecraft:glass", name: "Glass", color: "#B0D6DB", category: "solid", boxes: full, tags: ["glass"] };
const LEAVES: PaletteEntry = { id: "minecraft:oak_leaves", name: "Oak Leaves", color: "#3F7A2B", category: "solid", boxes: full, tags: ["leaves"] };
const opts = (o: Partial<MeshingOptions> = {}): MeshingOptions => ({ ...DEFAULT_RESIN_OPTIONS, ...o });

describe("isIncluded", () => {
  it("keeps ordinary blocks and drops air", () => {
    expect(isIncluded(B.stone, opts())).toBe(true);
    expect(isIncluded({ ...B.stone, category: "air" }, opts())).toBe(false);
  });
  it("fluids and foliage follow their switches", () => {
    expect(isIncluded(B.water, opts())).toBe(false);
    expect(isIncluded(B.water, opts({ includeFluids: true }))).toBe(true);
    expect(isIncluded(B.poppy, opts())).toBe(false);
    expect(isIncluded(B.poppy, opts({ includeFoliage: true }))).toBe(true);
  });
  it("glass and leaves are included unless switched off; undefined means included", () => {
    expect(isIncluded(GLASS, opts())).toBe(true);
    expect(isIncluded(GLASS, opts({ includeGlass: true }))).toBe(true);
    expect(isIncluded(GLASS, opts({ includeGlass: false }))).toBe(false);
    expect(isIncluded(LEAVES, opts({ includeLeaves: false }))).toBe(false);
    expect(isIncluded(LEAVES, opts({ includeGlass: false }))).toBe(true); // independent switches
    expect(isIncluded(B.stone, opts({ includeGlass: false, includeLeaves: false }))).toBe(true); // untagged blocks unaffected
  });
});

describe("glass and leaves in the pipeline", () => {
  const row = () => new PayloadBuilder("t", [3, 1, 1]).set(0, 0, 0, B.stone).set(1, 0, 0, GLASS).set(2, 0, 0, B.stone).build();

  it("grid: a switched-off glass block leaves an opening", () => {
    const p = row();
    const map = Uint16Array.from([0, 1, 2]);
    expect(countCells(buildSparseGrid(p, opts(), map))).toBe(3 * 4096);
    expect(countCells(buildSparseGrid(p, opts({ includeGlass: false }), map))).toBe(2 * 4096);
  });

  it("pipeline: glass off removes its volume, its filament slot, and keeps every bucket watertight", () => {
    const withGlass = runPipeline(row(), opts({ fixNonManifold: true }), { maxSlots: 4 });
    expect(withGlass.quantization.buckets).toHaveLength(2);
    expect(withGlass.meshes.reduce((s, m) => s + m.indices.length, 0)).toBeGreaterThan(0);
    const without = runPipeline(row(), opts({ includeGlass: false }), { maxSlots: 4 });
    expect(without.quantization.buckets).toHaveLength(1); // the glass colour does not claim a slot
    expect(without.reports.every((r) => r.ok)).toBe(true);
    const volume = (r: ReturnType<typeof runPipeline>) => r.reports.reduce((s, x) => s + x.signedVolume, 0);
    expect(volume(withGlass)).toBe(3 * 4096);
    expect(volume(without)).toBe(2 * 4096);
  });

  it("leaves off removes a canopy the same way", () => {
    const p = new PayloadBuilder("t", [2, 1, 1]).set(0, 0, 0, B.stone).set(1, 0, 0, LEAVES).build();
    const off = runPipeline(p, opts({ includeLeaves: false }), { maxSlots: 4 });
    expect(off.reports.reduce((s, x) => s + x.signedVolume, 0)).toBe(4096);
    expect(off.quantization.buckets).toHaveLength(1);
  });
});
