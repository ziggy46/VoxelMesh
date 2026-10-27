// Surface relief: carve texture-brightness detail into exposed full-cube faces.
import { describe, expect, it } from "vitest";
import { PayloadBuilder } from "../../samples/builder";
import { B } from "../../samples/blocks";
import { FLAT, reliefFrom } from "../../samples/relief";
import { DEFAULT_RESIN_OPTIONS, type MeshingOptions, type ReliefDepth } from "../../types/mesh";
import type { PaletteEntry } from "../../types/voxelPayload";
import { buildSparseGrid } from "../../worker/meshingKernel/grid";
import { applyRelief, reliefLevels } from "../../worker/meshingKernel/relief";
import { cellAt, countCells } from "../helpers";

const opts = (depth: ReliefDepth, invert = false): MeshingOptions => ({ ...DEFAULT_RESIN_OPTIONS, reliefDepth: depth, reliefInvert: invert });
const ident = (n: number) => Uint16Array.from({ length: n + 1 }, (_, i) => i);

/** A full cube whose face `face` has a single dark texel (a,b) on an otherwise bright map. */
const darkTexel = (face: number, a: number, b: number): PaletteEntry => ({
  id: `test:dark_${face}`, name: "Dark texel", color: "#808080", category: "solid", boxes: [[0, 0, 0, 16, 16, 16]],
  relief: reliefFrom((f, x, y) => (f === face && x === a && y === b ? 0 : 255)),
});

function carved(entry: PaletteEntry, depth: ReliefDepth = 1, invert = false) {
  const p = new PayloadBuilder("t", [1, 1, 1]).set(0, 0, 0, entry).build();
  const g = buildSparseGrid(p, opts(depth, invert), ident(1));
  const removed = applyRelief(g, p, ident(1), opts(depth, invert)).removed;
  return { g, removed, p };
}

describe("reliefLevels", () => {
  const face = (fn: (i: number) => number) => Uint8Array.from({ length: 256 }, (_, i) => fn(i));

  it("a flat texture never carves", () => {
    expect(reliefLevels(face(() => 128), 2, false).every((v) => v === 0)).toBe(true);
    expect(reliefLevels(face((i) => 128 + (i % 2)), 2, false).every((v) => v === 0)).toBe(true); // sigma < 3
  });

  it("carves only the dark outlier; depth 2 digs the extreme one two levels", () => {
    const f = face((i) => (i === 17 ? 0 : 255));
    const one = reliefLevels(f, 1, false);
    expect(one[17]).toBe(1);
    expect(one.reduce((s, v) => s + v, 0)).toBe(1);
    expect(reliefLevels(f, 2, false)[17]).toBe(2);
  });

  it("invert carves the light texels instead: dark is carved normally, light when inverted", () => {
    const f = face((i) => (i === 40 ? 255 : 0)); // one light texel on a dark face
    const normal = reliefLevels(f, 1, false);
    expect(normal[40]).toBe(0); // the light texel stays proud
    expect(normal.reduce((s, v) => s + v, 0)).toBe(255); // every dark texel is carved
    const inv = reliefLevels(f, 1, true);
    expect(inv[40]).toBe(1);
    expect(inv.reduce((s, v) => s + v, 0)).toBe(1);
  });

  it("depth scales continuously with darkness: a brightness ramp gives a monotone staircase of levels", () => {
    const ramp = face((i) => i); // 0 = darkest ... 255 = lightest
    const lv = reliefLevels(ramp, 3, false);
    for (let i = 1; i < 256; i++) expect(lv[i]!).toBeLessThanOrEqual(lv[i - 1]!); // lighter never carves deeper
    expect(new Set(lv)).toEqual(new Set([0, 1, 2, 3])); // every level is used
    expect(lv[0]).toBe(3);
    expect(lv[255]).toBe(0);
    const inv = reliefLevels(ramp, 3, true);
    for (let i = 1; i < 256; i++) expect(inv[i]!).toBeGreaterThanOrEqual(inv[i - 1]!);
  });

  it("a stray bright or dark pixel does not set the scale (percentile range), but a lone dark pixel still counts", () => {
    const base = (i: number) => 100 + (i % 10) * 4; // gentle texture, range 36
    const withOutlier = reliefLevels(face((i) => (i === 3 ? 0 : base(i))), 2, false);
    expect(withOutlier[3]).toBe(2); // the outlier is the deepest
    const plain = reliefLevels(face(base), 2, false);
    expect(plain.some((v) => v === 2)).toBe(true); // the texture itself still spans the full depth range
  });

  it("depth 0 is off, and the result is a pure function of the map", () => {
    const f = face((i) => i);
    expect(reliefLevels(f, 0, false).every((v) => v === 0)).toBe(true);
    expect(reliefLevels(f, 2, false)).toEqual(reliefLevels(f, 2, false));
    const lv = reliefLevels(f, 2, false);
    expect(lv[0]).toBe(2); // darkest
    expect(lv[255]).toBe(0); // lightest
  });
});

describe("applyRelief orientation (one block, one dark texel, depth 1)", () => {
  // Expected slicer cells: MC lattice (x,y,z) -> slicer (x, 15 - z, y).
  const cases: Array<[string, number, number, number, [number, number, number]]> = [
    ["UP", 1, 3, 5, [3, 10, 15]],
    ["DOWN", 0, 3, 5, [3, 10, 0]],
    ["NORTH (-z)", 2, 2, 7, [2, 15, 7]],
    ["SOUTH (+z)", 3, 2, 7, [2, 0, 7]],
    ["WEST (-x)", 4, 4, 9, [0, 11, 9]],
    ["EAST (+x)", 5, 4, 9, [15, 11, 9]],
  ];
  for (const [name, face, a, b, [x, y, z]] of cases) {
    it(`${name} face carves exactly the surface cell at slicer (${x},${y},${z})`, () => {
      const { g, removed } = carved(darkTexel(face, a, b));
      expect(removed).toBe(1);
      expect(countCells(g)).toBe(4096 - 1);
      expect(cellAt(g, x, y, z)).toBe(0);
    });
  }

  it("depth 2 digs two cells deep into the same column", () => {
    const { g, removed } = carved(darkTexel(1, 3, 5), 2);
    expect(removed).toBe(2);
    expect(cellAt(g, 3, 10, 15)).toBe(0);
    expect(cellAt(g, 3, 10, 14)).toBe(0);
    expect(cellAt(g, 3, 10, 13)).toBe(1);
  });

  it("invert carves the light texels", () => {
    const e: PaletteEntry = { ...darkTexel(1, 3, 5), relief: reliefFrom((f, x, y) => (f === 1 && x === 3 && y === 5 ? 255 : 0)) };
    expect(carved(e, 1, true).removed).toBe(1); // the single light texel
    expect(carved(e, 1, false).removed).toBe(255); // normal: the 255 dark texels of that face are carved, the light one is not
  });
});

describe("applyRelief rules", () => {
  it("depth 0, flat maps, missing relief and non-cube blocks carve nothing", () => {
    expect(carved(darkTexel(1, 3, 5), 0).removed).toBe(0);
    expect(carved({ ...darkTexel(1, 3, 5), relief: FLAT }).removed).toBe(0);
    expect(carved({ ...B.stone, relief: undefined }).removed).toBe(0);
    expect(carved({ ...B.stoneSlab, relief: darkTexel(1, 3, 5).relief }).removed).toBe(0);
  });

  it("leaves faces shared with another solid block intact", () => {
    // Every face has the same dark texel (3,5). Two blocks side by side along x share one face pair.
    const all: PaletteEntry = { ...darkTexel(0, 3, 5), relief: reliefFrom((_f, x, y) => (x === 3 && y === 5 ? 0 : 255)) };
    const p = new PayloadBuilder("t", [2, 1, 1]).set(0, 0, 0, all).set(1, 0, 0, all).build();
    const g = buildSparseGrid(p, opts(1), ident(1));
    // 2 blocks x 6 faces = 12 texels, minus the 2 faces they share
    expect(applyRelief(g, p, ident(1), opts(1)).removed).toBe(10);
  });

  it("only carves where the cell outside is air: a slab sitting on the top face protects that texel", () => {
    const full = darkTexel(1, 3, 5); // UP face only
    const map = Uint16Array.from([0, 1, 2]);
    const alone = new PayloadBuilder("t", [1, 2, 1]).set(0, 0, 0, full).build();
    expect(applyRelief(buildSparseGrid(alone, opts(1), ident(1)), alone, ident(1), opts(1)).removed).toBe(1); // control: exposed
    const covered = new PayloadBuilder("t", [1, 2, 1]).set(0, 0, 0, full).set(0, 1, 0, B.stoneSlab).build();
    const g = buildSparseGrid(covered, opts(1), map);
    expect(applyRelief(g, covered, map, opts(1)).removed).toBe(0);
    expect(countCells(g, 1)).toBe(4096);
  });

  it("is deterministic and independent of cell order", () => {
    const e = B.stone;
    const p = new PayloadBuilder("t", [3, 2, 3]).fill(0, 0, 0, 3, 2, 3, e).build();
    const run = () => {
      const g = buildSparseGrid(p, opts(2), ident(1));
      const n = applyRelief(g, p, ident(1), opts(2)).removed;
      return { n, cells: g.cells.map((c) => (typeof c === "number" ? c : Array.from(c))) };
    };
    const a = run(), b = run();
    expect(a.n).toBeGreaterThan(0);
    expect(b).toEqual(a);
  });

  it("skips relief entirely, changing nothing, when the carve budget would be exceeded", () => {
    const p = new PayloadBuilder("t", [2, 2, 2]).fill(0, 0, 0, 2, 2, 2, B.stone).build();
    const g = buildSparseGrid(p, opts(1), ident(1));
    const before = countCells(g);
    const removedAll = applyRelief(buildSparseGrid(p, opts(1), ident(1)), p, ident(1), opts(1)).removed;
    expect(removedAll).toBeGreaterThan(10);
    const r = applyRelief(g, p, ident(1), opts(1), removedAll - 1);
    expect(r.removed).toBe(0);
    // `wanted` counts requests, and an edge cell is requested by two faces, so it can exceed what is finally removed.
    expect(r.skipped!.limit).toBe(removedAll - 1);
    expect(r.skipped!.wanted).toBeGreaterThanOrEqual(removedAll);
    expect(countCells(g)).toBe(before); // nothing changed
    expect(applyRelief(g, p, ident(1), opts(1), r.skipped!.wanted).removed).toBe(removedAll); // exactly at the limit is allowed
  });

  it("steps down to a shallower depth when the requested one would exceed the carve budget", () => {
    const p = new PayloadBuilder("t", [2, 2, 2]).fill(0, 0, 0, 2, 2, 2, B.stone).build();
    const wanted = (d: 1 | 2 | 3) => {
      const g = buildSparseGrid(p, opts(d), ident(1));
      return applyRelief(g, p, ident(1), opts(d)).removed;
    };
    const [d1, d2, d3] = [wanted(1), wanted(2), wanted(3)];
    expect(d1).toBeLessThan(d2);
    expect(d2).toBeLessThan(d3);
    // A limit that fits depth 1 but not depth 3 must land on a depth below 3 and still carve.
    const g = buildSparseGrid(p, opts(3), ident(1));
    const r = applyRelief(g, p, ident(1), opts(3), d2 + 10);
    expect(r.skipped).toBeNull();
    expect(r.usedDepth).toBeLessThan(3);
    expect(r.usedDepth).toBeGreaterThanOrEqual(1);
    expect(r.removed).toBeGreaterThan(0);
    // With plenty of budget the requested depth is used as is.
    expect(applyRelief(buildSparseGrid(p, opts(3), ident(1)), p, ident(1), opts(3)).usedDepth).toBe(3);
  });

  it("brick sample: mortar lines are carved on the sides", () => {
    const p = new PayloadBuilder("t", [1, 1, 1]).set(0, 0, 0, B.stone).build();
    const g = buildSparseGrid(p, opts(1), ident(1));
    const n = applyRelief(g, p, ident(1), opts(1)).removed;
    expect(n).toBeGreaterThan(100);
    expect(n).toBeLessThan(4096);
  });
});
