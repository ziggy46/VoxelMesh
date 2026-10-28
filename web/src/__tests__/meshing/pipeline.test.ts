// worker/pipeline.ts: stage order, slot limits, overrides, filters, determinism.
import { describe, expect, it } from "vitest";
import { sampleCastlePayload } from "../../samples/sampleCastlePayload";
import { DEFAULT_FDM_OPTIONS, DEFAULT_RESIN_OPTIONS } from "../../types/mesh";
import { STAGES, runPipeline, type Stage } from "../../worker/pipeline";
import { bytesOf } from "../helpers";

describe("runPipeline", () => {
  it("reports every stage in order and produces valid meshes within the slot limit", () => {
    const seen: Stage[] = [];
    const r = runPipeline(sampleCastlePayload, DEFAULT_FDM_OPTIONS, { maxSlots: 4, onProgress: (s, f) => f === 1 && seen.push(s) });
    expect(seen).toEqual(STAGES.filter((s) => s !== "relief" && s !== "faces" && s !== "entities")); // relief only runs when enabled, faces and entities only when a build has them
    expect(r.quantization.buckets.length).toBeLessThanOrEqual(4);
    expect(r.meshes.length).toBeGreaterThan(0);
    expect(r.reports.every((x) => x.ok)).toBe(true);
    expect(r.repair).not.toBeNull();
    expect(Object.values(r.timings).every((t) => t >= 0)).toBe(true);
  });

  it("runs the relief stage between grid and fill when enabled, and reports what it carved", () => {
    const seen: Stage[] = [];
    const r = runPipeline(sampleCastlePayload, { ...DEFAULT_FDM_OPTIONS, reliefDepth: 1 }, { maxSlots: 4, onProgress: (s, f) => f === 1 && seen.push(s) });
    expect(seen.indexOf("relief")).toBe(seen.indexOf("grid") + 1);
    expect(seen).toEqual(STAGES.filter((s) => s !== "faces" && s !== "entities"));
    expect(r.reliefCarved).toBeGreaterThan(0);
    expect(r.reliefSkipped).toBeNull();
    expect(r.reports.every((x) => x.ok)).toBe(true);
    expect(runPipeline(sampleCastlePayload, DEFAULT_FDM_OPTIONS, { maxSlots: 4 }).reliefCarved).toBeNull();
  });

  it("skips fill and repair when disabled", () => {
    const seen: Stage[] = [];
    const r = runPipeline(sampleCastlePayload, { ...DEFAULT_RESIN_OPTIONS, fixNonManifold: false }, { maxSlots: 4, onProgress: (s, f) => f === 1 && seen.push(s) });
    expect(seen).not.toContain("fill");
    expect(seen).not.toContain("repair");
    expect(r.repair).toBeNull();
  });

  it("maxSlots 1 gives a single mono bucket", () => {
    const r = runPipeline(sampleCastlePayload, DEFAULT_RESIN_OPTIONS, { maxSlots: 1 });
    expect(r.meshes.map((m) => m.bucketId)).toEqual([1]);
    expect(r.reports.every((x) => x.ok)).toBe(true);
  });

  it("filtered-out fluid and foliage do not claim slots; including them changes the result", () => {
    const off = runPipeline(sampleCastlePayload, DEFAULT_RESIN_OPTIONS, { maxSlots: 16 });
    const water = sampleCastlePayload.palette.findIndex((e) => e.category === "fluid");
    const poppy = sampleCastlePayload.palette.findIndex((e) => e.category === "foliage");
    expect(off.paletteToBucket[water]).toBe(0);
    expect(off.paletteToBucket[poppy]).toBe(0);
    const on = runPipeline(sampleCastlePayload, { ...DEFAULT_RESIN_OPTIONS, includeFluids: true, includeFoliage: true }, { maxSlots: 16 });
    expect(on.paletteToBucket[water]).toBeGreaterThan(0);
    expect(on.reports.every((x) => x.ok)).toBe(true);
  });

  it("applies manual slot overrides after quantization", () => {
    const base = runPipeline(sampleCastlePayload, DEFAULT_RESIN_OPTIONS, { maxSlots: 4 });
    const red = sampleCastlePayload.palette.findIndex((e) => e.id === "minecraft:red_wool");
    const target = base.paletteToBucket[red] === 1 ? 2 : 1;
    const moved = runPipeline(sampleCastlePayload, DEFAULT_RESIN_OPTIONS, { maxSlots: 4, overrides: new Map([[red, target]]) });
    expect(moved.paletteToBucket[red]).toBe(target);
    expect(moved.reports.every((x) => x.ok)).toBe(true);
  });

  it("is deterministic", () => {
    const a = runPipeline(sampleCastlePayload, DEFAULT_FDM_OPTIONS, { maxSlots: 8 });
    const b = runPipeline(sampleCastlePayload, DEFAULT_FDM_OPTIONS, { maxSlots: 8 });
    expect(a.meshes.map(bytesOf)).toEqual(b.meshes.map(bytesOf));
  });
});
