import { describe, expect, it } from "vitest";
import { sampleCastlePayload } from "../../samples/sampleCastlePayload";
import {
  BED_PRESETS, DEFAULT_UI_OPTIONS, bedFor, bedLabel, clampBedMm, decodeFragmentData, estimate, fitsBed, fmtSize, modelSizeMm, needsRerun, safeFileName, slotHex, slotMembers, slotName,
  toMeshingOptions, totalIssues, texelMm, hasReliefData,
} from "../../ui/derive";
import { gzip, serializePayload } from "../../payload/loader";
import { cubeMesh } from "../helpers";
import type { ManifoldReport } from "../../types/mesh";

const report = (o: Partial<ManifoldReport> = {}): ManifoldReport => ({
  bucketId: 1, triangles: 12, openEdges: 0, nonManifoldEdges: 0, degenerateTriangles: 0, signedVolume: 4096, components: 1, ok: true, ...o,
});

describe("toMeshingOptions", () => {
  it("FDM: 0.8 mm wall and cavity fill follow the toggle", () => {
    expect(toMeshingOptions(DEFAULT_UI_OPTIONS)).toMatchObject({ printerMode: "fdm", minNozzleWallMm: 0.8, fillInteriorCavities: true });
    expect(toMeshingOptions({ ...DEFAULT_UI_OPTIONS, solidifyInteriors: false }).fillInteriorCavities).toBe(false);
  });
  it("Resin never fills or dilates, whatever the toggle says (invariant 3)", () => {
    const o = toMeshingOptions({ ...DEFAULT_UI_OPTIONS, printerMode: "resin", solidifyInteriors: true });
    expect(o).toMatchObject({ printerMode: "resin", minNozzleWallMm: 0, fillInteriorCavities: false });
  });
});

describe("needsRerun", () => {
  const fdm = DEFAULT_UI_OPTIONS;
  const resin = { ...DEFAULT_UI_OPTIONS, printerMode: "resin" as const };
  it("scale only re-meshes in FDM", () => {
    expect(needsRerun(fdm, { ...fdm, scaleMmPerBlock: 6 })).toBe(true);
    expect(needsRerun(resin, { ...resin, scaleMmPerBlock: 6 })).toBe(false);
  });
  it("filters, mode and fill toggles re-mesh; the solidify toggle is inert in Resin", () => {
    expect(needsRerun(fdm, { ...fdm, includeFluids: true })).toBe(true);
    expect(needsRerun(fdm, resin)).toBe(true);
    expect(needsRerun(fdm, { ...fdm, solidifyInteriors: false })).toBe(true);
    expect(needsRerun(resin, { ...resin, solidifyInteriors: false })).toBe(false);
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
  it("offers three presets per printer type, defaulting to the middle one", () => {
    expect(BED_PRESETS.fdm.map(bedLabel)).toEqual(["220 × 220 mm", "256 × 256 mm", "350 × 350 mm"]);
    expect(BED_PRESETS.resin.map(bedLabel)).toEqual(["130 × 80 mm", "192 × 120 mm", "218 × 123 mm"]);
    expect(bedFor(DEFAULT_UI_OPTIONS)).toEqual({ x: 256, y: 256 });
    expect(bedFor({ ...DEFAULT_UI_OPTIONS, printerMode: "resin" })).toEqual({ x: 192, y: 120 });
    expect(bedFor({ ...DEFAULT_UI_OPTIONS, bedPreset: 0 })).toEqual({ x: 220, y: 220 });
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
    expect(fitsBed([221, 100, 10], bedFor({ ...DEFAULT_UI_OPTIONS, printerMode: "resin", bedPreset: 2 }))).toBe(false); // 218 x 123
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
