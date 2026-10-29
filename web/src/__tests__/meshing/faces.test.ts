// Per-face colours: planning the colour clusters, skinning the grid, and the pipeline around them.
import { describe, expect, it } from "vitest";
import { PayloadBuilder } from "../../samples/builder";
import { B } from "../../samples/blocks";
import { reliefFrom } from "../../samples/relief";
import { DEFAULT_FDM_OPTIONS, type MeshingOptions } from "../../types/mesh";
import type { PaletteEntry } from "../../types/voxelPayload";
import { applyFaceSkins, coreColor, faceBuckets, faceColorsOf, planFaceColors, skinDepth, texelSourceOf } from "../../worker/meshingKernel/faces";
import { buildSparseGrid } from "../../worker/meshingKernel/grid";
import { runPipeline } from "../../worker/pipeline";
import { cellAt, countCells } from "../helpers";

const DIRT = "#866043", GREEN = "#5A8F3C";
const grass = (extra: Partial<PaletteEntry> = {}): PaletteEntry => ({
  id: "test:grass", name: "Grass Block", color: "#6E7A3F", category: "solid", boxes: [[0, 0, 0, 16, 16, 16]],
  faces: [DIRT, GREEN, DIRT, DIRT, DIRT, DIRT], ...extra,
});
/** Six per-face values spread over all 1536 texels. */
const six = (v: number[]) => Uint16Array.from({ length: 1536 }, (_, t) => v[t >> 8]!);
/** Texture bytes (base64) from a function of (face, a, b) giving 0xRRGGBB. */
const textureFrom = (fn: (f: number, a: number, b: number) => number): string => {
  const bytes = new Uint8Array(4608);
  for (let f = 0; f < 6; f++)
    for (let b = 0; b < 16; b++)
      for (let a = 0; a < 16; a++) {
        const c = fn(f, a, b), at = (f * 256 + a + b * 16) * 3;
        bytes[at] = c >> 16; bytes[at + 1] = (c >> 8) & 255; bytes[at + 2] = c & 255;
      }
  return btoa(String.fromCharCode(...bytes));
};
const opts: MeshingOptions = { ...DEFAULT_FDM_OPTIONS, scaleMmPerBlock: 4 };
const one = (e: PaletteEntry) => new PayloadBuilder("t", [1, 1, 1]).set(0, 0, 0, e).build();
const tower = (e: PaletteEntry) => new PayloadBuilder("t", [1, 2, 1]).set(0, 0, 0, e).set(0, 1, 0, e).build();

describe("coreColor and faceColorsOf", () => {
  it("the core is the typical face: grass -> dirt, log -> bark", () => {
    expect(coreColor([DIRT, GREEN, DIRT, DIRT, DIRT, DIRT])).toBe(DIRT);
    expect(coreColor(["#D8B070", "#D8B070", "#6B5230", "#6B5230", "#6B5230", "#6B5230"])).toBe("#6B5230");
  });
  it("only full cubes with six colours have faces", () => {
    expect(faceColorsOf(grass())).toEqual([DIRT, GREEN, DIRT, DIRT, DIRT, DIRT]);
    expect(faceColorsOf(grass({ boxes: [[0, 0, 0, 16, 8, 16]] }))).toBeNull();
    expect(faceColorsOf(grass({ faces: undefined }))).toBeNull();
    expect(faceColorsOf(grass({ faces: [DIRT] }))).toBeNull();
  });
  it("skin thickness is about 0.8 mm of material, between one cell and six", () => {
    expect(skinDepth({ ...opts, scaleMmPerBlock: 4 })).toBe(3);
    expect(skinDepth({ ...opts, scaleMmPerBlock: 15 })).toBe(1);
    expect(skinDepth({ ...opts, scaleMmPerBlock: 1 })).toBe(6);
  });
});

describe("planFaceColors", () => {
  const p = one(grass());
  const counts = Uint32Array.from([0, 7]);
  it("swaps the core colour in and adds one extra per distinct skin colour", () => {
    const plan = planFaceColors(p.palette, counts, opts);
    expect(plan.colors[1]!.color).toBe(DIRT);
    expect(plan.colors.length).toBe(3);
    expect(plan.colors[2]!.color).toBe(GREEN);
    expect(plan.counts[2]).toBe(7);
    expect([...plan.faceIndex.get(1)!]).toEqual([...six([0, 2, 0, 0, 0, 0])]);
    expect(plan.owners.get(2)).toBe(1);
  });
  it("does nothing when off, when the entry has no faces, or when the filters drop the block", () => {
    expect(planFaceColors(p.palette, counts, { ...opts, faceColors: false }).faceIndex.size).toBe(0);
    expect(planFaceColors(p.palette, counts, { ...opts, faceColors: false }).colors[1]!.color).toBe("#6E7A3F");
    const none = one(grass({ faces: undefined }));
    expect(planFaceColors(none.palette, counts, opts).colors.length).toBe(2);
    const leaves = one(grass({ tags: ["leaves"] }));
    expect(planFaceColors(leaves.palette, counts, { ...opts, includeLeaves: false }).faceIndex.size).toBe(0);
  });
  it("a face that clusters into the block's own slot needs no skin", () => {
    const plan = planFaceColors(p.palette, counts, opts);
    const map = Uint16Array.from([0, 1, 1]); // green merged into slot 1
    expect(faceBuckets(plan, map, Uint16Array.from([0, 1])).size).toBe(0);
    const split = faceBuckets(plan, Uint16Array.from([0, 1, 2]), Uint16Array.from([0, 1]));
    expect([...split.get(1)!]).toEqual([...six([0, 2, 0, 0, 0, 0])]);
  });
});

describe("applyFaceSkins", () => {
  const skins = new Map([[1, six([0, 2, 0, 0, 0, 0])]]); // top face in slot 2
  it("recolours the outer cells under the top face and nothing else", () => {
    const p = one(grass());
    const g = buildSparseGrid(p, opts, Uint16Array.from([0, 1]));
    const r = applyFaceSkins(g, p, skins, opts);
    expect(r).toEqual({ recolored: 16 * 16 * 3, skipped: null });
    expect(countCells(g, 2)).toBe(768);
    expect(countCells(g, 1)).toBe(4096 - 768);
    expect(cellAt(g, 8, 8, 15)).toBe(2); // MC up is slicer Z
    expect(cellAt(g, 8, 8, 13)).toBe(2);
    expect(cellAt(g, 8, 8, 12)).toBe(1);
    expect(cellAt(g, 0, 0, 0)).toBe(1);
  });
  it("leaves a face alone where another block covers it", () => {
    const p = tower(grass());
    const g = buildSparseGrid(p, opts, Uint16Array.from([0, 1]));
    applyFaceSkins(g, p, skins, opts);
    expect(cellAt(g, 8, 8, 31)).toBe(2); // top of the upper block
    expect(cellAt(g, 8, 8, 15)).toBe(1); // top of the lower block is buried
    expect(countCells(g, 2)).toBe(768);
  });
  it("applies sides before the top so the top keeps the shared rim", () => {
    const p = one(grass());
    const g = buildSparseGrid(p, opts, Uint16Array.from([0, 1]));
    applyFaceSkins(g, p, new Map([[1, six([0, 2, 3, 3, 3, 3])]]), opts);
    expect(cellAt(g, 0, 0, 15)).toBe(2); // corner on top and sides: top wins
    expect(cellAt(g, 0, 8, 5)).toBe(3); // plain side
  });
  it("follows relief pits: the skin starts under the carved cell", () => {
    const pit = grass({ relief: reliefFrom((f, x, y) => (f === 1 && x === 3 && y === 5 ? 0 : 255)) });
    const p = one(pit);
    const g = buildSparseGrid(p, opts, Uint16Array.from([0, 1]));
    // carve the pit by hand: MC (x=3, z=5) on top -> slicer (3, 15 - 5, 15)
    g.cells[0] = Uint16Array.from({ length: 4096 }, () => 1);
    (g.cells[0] as Uint16Array)[3 + 10 * 16 + 15 * 256] = 0;
    applyFaceSkins(g, p, skins, { ...opts, reliefDepth: 1 });
    expect(cellAt(g, 3, 10, 15)).toBe(0);
    expect(cellAt(g, 3, 10, 14)).toBe(2);
    expect(cellAt(g, 3, 10, 12)).toBe(2);
    expect(cellAt(g, 3, 10, 11)).toBe(1);
  });
  it("does not mistake a neighbouring face's pits for its own: a column hollowed deeper than the relief depth is left alone", () => {
    const p = one(grass());
    const g = buildSparseGrid(p, opts, Uint16Array.from([0, 1]));
    g.cells[0] = Uint16Array.from({ length: 4096 }, () => 1);
    for (let z = 10; z < 16; z++) (g.cells[0] as Uint16Array)[7 + 0 * 16 + z * 256] = 0; // a column of pits on the front face
    applyFaceSkins(g, p, skins, { ...opts, reliefDepth: 1 });
    expect(cellAt(g, 7, 0, 9)).toBe(1); // the top skin does not start six cells down
    expect(cellAt(g, 7, 1, 15)).toBe(2); // the neighbouring column is normal
  });
  it("skips everything, changing nothing, when over the budget", () => {
    const p = one(grass());
    const g = buildSparseGrid(p, opts, Uint16Array.from([0, 1]));
    const r = applyFaceSkins(g, p, skins, opts, 100);
    expect(r.recolored).toBe(0);
    expect(r.skipped).toMatchObject({ limit: 100 });
    expect(countCells(g, 2)).toBe(0);
  });
});

describe("texel textures", () => {
  const DARK = 0x6e5a3c, LIGHT = 0xd8c690;
  // top face: a checkerboard of two tans; every other face one flat colour
  const sand = (extra: Partial<PaletteEntry> = {}): PaletteEntry => ({
    id: "test:sand", name: "Sand", color: "#C8B67E", category: "solid", boxes: [[0, 0, 0, 16, 16, 16]],
    texture: textureFrom((f, a, b) => (f === 1 ? ((a + b) % 2 === 0 ? DARK : LIGHT) : 0xc8b67e)), ...extra,
  });
  it("reads a texture as distinct colours per texel, and prefers it over faces", () => {
    const src = texelSourceOf(sand({ faces: [DIRT, GREEN, DIRT, DIRT, DIRT, DIRT] }))!;
    expect(src.textured).toBe(true);
    expect(src.colors).toContain("#6E5A3C");
    expect(src.colors).toContain("#D8C690");
    expect(src.colors).toContain("#C8B67E");
    expect(src.colors[src.index[1 * 256 + 0]!]).toBe("#6E5A3C");
    expect(src.colors[src.index[1 * 256 + 1]!]).toBe("#D8C690");
    expect(src.colors[src.index[0]!]).toBe("#C8B67E");
    expect(src.core).toMatch(/^#[0-9A-F]{6}$/);
  });
  it("is null for a non-cube, and legacy faces still work", () => {
    expect(texelSourceOf(sand({ boxes: [[0, 0, 0, 16, 8, 16]] }))).toBeNull();
    const legacy = texelSourceOf(grass())!;
    expect(legacy.textured).toBe(false);
    expect(legacy.colors.length).toBe(2);
  });
  it("folds a noisy texture down to at most 32 colours", () => {
    const noisy = sand({ texture: textureFrom((f, a, b) => ((a * 16 + 3) << 16) | ((b * 16 + 5) << 8) | ((f * 40 + a) & 255)) });
    const src = texelSourceOf(noisy)!;
    expect(src.colors.length).toBeLessThanOrEqual(32);
    expect(new Set(src.colors).size).toBe(src.colors.length);
  });
  it("skins each exposed texel in its own slot", () => {
    const p = one(sand());
    const counts = Uint32Array.from([0, 1]);
    const plan = planFaceColors(p.palette, counts, opts);
    const idx = plan.faceIndex.get(1)!;
    const darkExtra = idx[1 * 256 + 0]!, lightExtra = idx[1 * 256 + 1]!;
    expect(darkExtra).not.toBe(lightExtra);
    const map = new Uint16Array(plan.colors.length);
    map[1] = 1; map[darkExtra] = 2; map[lightExtra] = 3;
    const fb = faceBuckets(plan, map, Uint16Array.from([0, 1]));
    expect(fb.get(1)![1 * 256 + 0]).toBe(2);
    expect(fb.get(1)![1 * 256 + 1]).toBe(3);
    const g = buildSparseGrid(p, opts, Uint16Array.from([0, 1]));
    applyFaceSkins(g, p, fb, opts);
    expect(cellAt(g, 0, 15, 15)).toBe(2); // MC x=0, z=0 on top -> slicer (0, 15, 15)
    expect(cellAt(g, 1, 15, 15)).toBe(3);
    expect(cellAt(g, 0, 15, 12)).toBe(1);
  });
  it("runs in the pipeline with a closed manifold in every colour", () => {
    const p = new PayloadBuilder("t", [2, 1, 2]).set(0, 0, 0, sand()).set(1, 0, 0, sand()).set(0, 0, 1, B.stone).build();
    const r = runPipeline(p, opts, { maxSlots: 8 });
    expect(r.faceCells).toBeGreaterThan(0);
    expect(r.reports.every((x) => x.ok)).toBe(true);
    for (const b of r.quantization.buckets) expect(b.paletteIndices.every((i) => i < p.palette.length)).toBe(true);
  });
});

describe("pipeline with face colours", () => {
  const castle = new PayloadBuilder("t", [2, 2, 2])
    .set(0, 0, 0, grass()).set(1, 0, 0, grass()).set(0, 1, 0, B.stone).set(1, 1, 1, grass()).build();

  it("gives the grass top its own slot and keeps every colour a closed manifold", () => {
    const r = runPipeline(castle, opts, { maxSlots: 4 });
    expect(r.quantization.buckets.length).toBe(3); // dirt, green, stone
    expect(r.faceBuckets.size).toBeGreaterThan(0);
    expect(r.faceCells).toBeGreaterThan(0);
    expect(r.facesSkipped).toBeNull();
    expect(r.reports.every((x) => x.ok)).toBe(true);
    expect(r.paletteToBucket.length).toBe(castle.palette.length);
    // the slot list names real palette entries only
    for (const b of r.quantization.buckets) expect(b.paletteIndices.every((i) => i < castle.palette.length)).toBe(true);
  });
  it("is off with the option, in mono, and for builds without faces", () => {
    const off = runPipeline(castle, { ...opts, faceColors: false }, { maxSlots: 4 });
    expect(off.faceBuckets.size).toBe(0);
    expect(off.faceCells).toBeNull();
    const mono = runPipeline(castle, opts, { maxSlots: 1 });
    expect(mono.faceBuckets.size).toBe(0);
    expect(mono.meshes.length).toBe(1);
    const plain = new PayloadBuilder("t", [1, 1, 1]).set(0, 0, 0, grass({ faces: undefined })).build();
    const r = runPipeline(plain, opts, { maxSlots: 4 });
    expect(r.faceBuckets.size).toBe(0);
    expect(r.quantization.buckets.length).toBe(1);
  });
  it("is deterministic", () => {
    const a = runPipeline(castle, opts, { maxSlots: 4 }), b = runPipeline(castle, opts, { maxSlots: 4 });
    expect(a.meshes.map((m) => Array.from(m.positions))).toEqual(b.meshes.map((m) => Array.from(m.positions)));
  });
  it("works together with relief", () => {
    const withRelief = new PayloadBuilder("t", [2, 1, 2])
      .set(0, 0, 0, grass({ relief: reliefFrom((_f, x, y) => (x * 16 + y) % 256) })).set(1, 0, 1, grass({ relief: reliefFrom((_f, x, y) => (x * 16 + y) % 256) })).build();
    const r = runPipeline(withRelief, { ...opts, reliefDepth: 1 }, { maxSlots: 4 });
    expect(r.reliefCarved).toBeGreaterThan(0);
    expect(r.faceCells).toBeGreaterThan(0);
    expect(r.reports.every((x) => x.ok)).toBe(true);
  });
});
