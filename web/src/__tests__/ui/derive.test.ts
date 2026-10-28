import { describe, expect, it } from "vitest";
import { sampleCastlePayload } from "../../samples/sampleCastlePayload";
import {
  BED_PRESETS, DEFAULT_UI_OPTIONS, bedFor, bedLabel, clampBedMm, minSubVoxels, reliefTooFine, decodeFragmentData, estimate, fitsBed, fmtSize, modelSizeMm, needsRerun, safeFileName, slotHex, slotMembers, slotName,
  toMeshingOptions, totalIssues, texelMm, hasReliefData,
} from "../../ui/derive";
import { gzip, serializePayload } from "../../payload/loader";
import { cubeMesh } from "../helpers";
import type { ManifoldReport } from "../../types/mesh";

const report = (o: Partial<ManifoldReport> = {}): ManifoldReport => ({
  bucketId: 1, triangles: 12, openEdges: 0, nonManifoldEdges: 0, degenerateTriangles: 0, signedVolume: 4096, components: 1, ok: true, ...o,
});

describe("toMeshingOptions", () => {
  it("defaults are safe for any printer: 0.8 mm minimum wall and hollow interiors filled", () => {
    expect(toMeshingOptions(DEFAULT_UI_OPTIONS)).toMatchObject({ printerMode: "fdm", minNozzleWallMm: 0.8, fillInteriorCavities: true });
  });
  it("thickening and filling are independent options with no hidden coupling (invariant 3)", () => {
    const resinLike = toMeshingOptions({ ...DEFAULT_UI_OPTIONS, minWallMm: 0, solidifyInteriors: false });
    expect(resinLike).toMatchObject({ printerMode: "resin", minNozzleWallMm: 0, fillInteriorCavities: false });
    // thickening off but filling on, and the reverse, are both honoured exactly
    expect(toMeshingOptions({ ...DEFAULT_UI_OPTIONS, minWallMm: 0 })).toMatchObject({ minNozzleWallMm: 0, fillInteriorCavities: true });
    expect(toMeshingOptions({ ...DEFAULT_UI_OPTIONS, solidifyInteriors: false })).toMatchObject({ minNozzleWallMm: 0.8, fillInteriorCavities: false });
    expect(toMeshingOptions({ ...DEFAULT_UI_OPTIONS, minWallMm: 0.3 }).minNozzleWallMm).toBe(0.3);
  });
  it("shows how many sub-voxels the minimum wall means at a scale, mirroring the engine", () => {
    expect(minSubVoxels(0.8, 4)).toBe(4);
    expect(minSubVoxels(0.8, 8)).toBe(2);
    expect(minSubVoxels(0.8, 1)).toBe(13);
    expect(minSubVoxels(0.3, 4)).toBe(2);
    expect(minSubVoxels(0, 4)).toBe(0);
    expect(minSubVoxels(1.2, 0.5)).toBe(16); // capped at one block
  });
  it("warns that relief is below a 0.4 mm nozzle only when the wall setting says FDM-like", () => {
    expect(reliefTooFine(0.25, 0.8)).toBe(true);
    expect(reliefTooFine(0.25, 0.3)).toBe(false); // fine-resin settings: no warning
    expect(reliefTooFine(0.25, 0)).toBe(false);
    expect(reliefTooFine(0.5, 0.8)).toBe(false);
  });
});

describe("needsRerun", () => {
  const base = DEFAULT_UI_OPTIONS;
  const noWall = { ...DEFAULT_UI_OPTIONS, minWallMm: 0 };
  it("scale only re-meshes while thickening is on", () => {
    expect(needsRerun(base, { ...base, scaleMmPerBlock: 6 })).toBe(true);
    expect(needsRerun(noWall, { ...noWall, scaleMmPerBlock: 6 })).toBe(false);
  });
  it("minimum wall, filters and fill toggles re-mesh", () => {
    expect(needsRerun(base, { ...base, includeFluids: true })).toBe(true);
    expect(needsRerun(base, { ...base, minWallMm: 0.3 })).toBe(true);
    expect(needsRerun(base, noWall)).toBe(true);
    expect(needsRerun(base, { ...base, solidifyInteriors: false })).toBe(true);
    expect(needsRerun(base, { ...base })).toBe(false);
  });
});

describe("relief options", () => {
  it("maps to meshing options and triggers a re-run only when it matters", () => {
    const on = { ...DEFAULT_UI_OPTIONS, reliefDepth: 2 as const, reliefInvert: true };
    expect(toMeshingOptions(on)).toMatchObject({ reliefDepth: 2, reliefInvert: true });
    expect(toMeshingOptions(DEFAULT_UI_OPTIONS)).toMatchObject({ reliefDepth: 1, reliefInvert: false }); // on by default, depth fixed at 1
    const off = { ...DEFAULT_UI_OPTIONS, reliefDepth: 0 as const };
    expect(needsRerun(off, DEFAULT_UI_OPTIONS)).toBe(true);
    expect(needsRerun(DEFAULT_UI_OPTIONS, off)).toBe(true);
    expect(needsRerun(DEFAULT_UI_OPTIONS, { ...DEFAULT_UI_OPTIONS, reliefInvert: true })).toBe(true);
    expect(needsRerun(off, { ...off, reliefInvert: true })).toBe(false); // inert while relief is off
  });
  it("texel size is scale/16 and relief data is detected from the palette", () => {
    expect(texelMm(4)).toBe(0.25);
    expect(texelMm(16)).toBe(1);
    expect(hasReliefData(sampleCastlePayload)).toBe(true);
    expect(hasReliefData(null)).toBe(false);
    expect(hasReliefData({ ...sampleCastlePayload, palette: sampleCastlePayload.palette.map((e) => ({ ...e, relief: undefined })) })).toBe(false);
  });
});

describe("build plate", () => {
  it("offers six common sizes in one list, small to large, defaulting to 256 x 256", () => {
    expect(BED_PRESETS.map(bedLabel)).toEqual(["130 × 80 mm", "192 × 120 mm", "218 × 123 mm", "220 × 220 mm", "256 × 256 mm", "350 × 350 mm"]);
    expect(bedFor(DEFAULT_UI_OPTIONS)).toEqual({ x: 256, y: 256 });
    expect(bedFor({ ...DEFAULT_UI_OPTIONS, bedPreset: 0 })).toEqual({ x: 130, y: 80 });
    expect(bedFor({ ...DEFAULT_UI_OPTIONS, bedPreset: 99 })).toEqual({ x: 256, y: 256 }); // unknown index falls back to the default
  });
  it("uses and clamps a custom size", () => {
    const custom = { ...DEFAULT_UI_OPTIONS, bedPreset: "custom" as const };
    expect(bedFor({ ...custom, customBed: { x: 300, y: 180 } })).toEqual({ x: 300, y: 180 });
    expect(bedFor({ ...custom, customBed: { x: 5, y: 99999 } })).toEqual({ x: 20, y: 1000 });
    expect(bedFor({ ...custom, customBed: { x: 250.6, y: 250.4 } })).toEqual({ x: 251, y: 250 });
    expect(clampBedMm(Number.NaN)).toBe(20);
  });
  it("never triggers a re-mesh: the plate does not change the geometry", () => {
    expect(needsRerun(DEFAULT_UI_OPTIONS, { ...DEFAULT_UI_OPTIONS, bedPreset: 2 })).toBe(false);
    expect(needsRerun(DEFAULT_UI_OPTIONS, { ...DEFAULT_UI_OPTIONS, bedPreset: "custom", customBed: { x: 400, y: 400 } })).toBe(false);
  });
});

describe("size, bed and estimates", () => {
  it("maps dimensions to slicer axes (X, Z-depth, Y-height) and scales", () => {
    expect(modelSizeMm(sampleCastlePayload, 4)).toEqual([96, 96, 64]);
    expect(fmtSize([96, 96, 64])).toBe("96.0 × 96.0 × 64.0 mm");
  });
  it("compares against the bed footprint only", () => {
    const fdm = bedFor(DEFAULT_UI_OPTIONS); // 256 x 256 by default
    expect(fitsBed([250, 250, 300], fdm)).toBe(true);
    expect(fitsBed([257, 100, 10], fdm)).toBe(false);
    expect(fitsBed([221, 100, 10], bedFor({ ...DEFAULT_UI_OPTIONS, bedPreset: 2 }))).toBe(false); // 218 x 123
  });
  it("estimates volume and PLA mass: one 4 mm block is 0.064 cm3 = 0.079 g", () => {
    const e = estimate([report()], 4);
    expect(e.volumeCm3).toBeCloseTo(0.064, 6);
    expect(e.grams).toBeCloseTo(0.064 * 1.24, 6);
  });
  it("counts validation issues, treating non-positive volume as one", () => {
    expect(totalIssues([report(), report({ openEdges: 3, nonManifoldEdges: 2 })])).toBe(5);
    expect(totalIssues([report({ signedVolume: -1 })])).toBe(1);
  });
});

describe("slots", () => {
  it("groups palette entries by the effective map, biggest first, skipping unmapped", () => {
    const palette = sampleCastlePayload.palette;
    const map = new Uint16Array(palette.length);
    map[1] = 2; map[2] = 2; map[3] = 1;
    const counts = new Uint32Array(palette.length);
    counts[1] = 5; counts[2] = 50; counts[3] = 7;
    const m = slotMembers(map, palette, counts);
    expect([...m.keys()].sort()).toEqual([1, 2]);
    expect(m.get(2)!.map((x) => x.paletteIndex)).toEqual([2, 1]);
  });
  it("applies colour overrides to the hex and the exported name", () => {
    const b = { bucketId: 2, name: "Slot 2 – Stone Gray (#7A797A)", hexColor: "#7A797A", paletteIndices: [1], voxelCount: 1 };
    expect(slotHex(b, {})).toBe("#7A797A");
    expect(slotHex(b, { 2: "#ff0000" })).toBe("#FF0000");
    expect(slotName(b, "#ff0000")).toBe("Slot 2 – Stone Gray (#FF0000)");
  });
});

describe("misc", () => {
  it("sanitises file names", () => {
    expect(safeFileName("My Castle: v2/final?")).toBe("My_Castle_v2final");
    expect(safeFileName("///")).toBe("voxelmesh");
  });
  it("decodes the #data= fragment transport (base64url gzip)", async () => {
    const gz = await gzip(serializePayload(sampleCastlePayload));
    let bin = "";
    gz.forEach((b) => (bin += String.fromCharCode(b)));
    const frag = "#data=" + btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
    expect(Array.from(decodeFragmentData(frag)!)).toEqual(Array.from(gz));
    expect(decodeFragmentData("#other=1")).toBeNull();
    expect(decodeFragmentData("#data=***")).toBeNull();
    void cubeMesh;
  });
});
