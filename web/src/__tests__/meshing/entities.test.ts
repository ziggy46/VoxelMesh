// Captured entities: colour planning, stamping into air only, minimum-wall widening, and the pipeline around them.
import { describe, expect, it } from "vitest";
import { PayloadBuilder } from "../../samples/builder";
import { B } from "../../samples/blocks";
import { parsePayload } from "../../payload/loader";
import { DEFAULT_FDM_OPTIONS, type MeshingOptions } from "../../types/mesh";
import type { PayloadEntity, VoxelPayload } from "../../types/voxelPayload";
import { applyEntities, entityWeight, planEntityColors } from "../../worker/meshingKernel/entities";
import { buildSparseGrid } from "../../worker/meshingKernel/grid";
import { runPipeline } from "../../worker/pipeline";
import { cellAt, countCells } from "../helpers";

const RED = "#FF0000", BLUE = "#0000FF";
const noWall: MeshingOptions = { ...DEFAULT_FDM_OPTIONS, minNozzleWallMm: 0 };
const withWall: MeshingOptions = { ...DEFAULT_FDM_OPTIONS, scaleMmPerBlock: 4, minNozzleWallMm: 0.8 }; // 4 cells

const stand = (box: [number, number, number, number, number, number], color = RED): PayloadEntity => ({
  kind: "minecraft:armor_stand", palette: [color], boxes: [[...box, 0]],
});

/** A 2x2x2 block selection with entities and an optional stone block at MC (1,0,0). */
function scene(entities: PayloadEntity[], stone = false): VoxelPayload {
  const b = new PayloadBuilder("t", [2, 2, 2]);
  if (stone) b.set(1, 0, 0, B.stone);
  return { ...b.build(), entities };
}
const ident = (n: number) => Uint16Array.from({ length: n + 1 }, (_, i) => i);
const stamp = (p: VoxelPayload, o: MeshingOptions, map: (hex: string) => number = () => 1) => {
  const g = buildSparseGrid(p, o, ident(p.palette.length));
  return { g, r: applyEntities(g, p, map, o) };
};

describe("planEntityColors", () => {
  const p = scene([stand([0, 0, 0, 2, 2, 2]), { kind: "x", palette: [BLUE, RED], boxes: [[4, 0, 0, 6, 2, 2, 0], [8, 0, 0, 10, 2, 2, 1]] }]);
  const colors = [{ color: null }, { color: "#111111" }];
  const counts = Uint32Array.from([0, 3]);
  it("adds each distinct colour once, weighted by its cells, in first-use order", () => {
    const plan = planEntityColors(colors, counts, p.entities, DEFAULT_FDM_OPTIONS);
    expect(plan.colors.map((c) => c.color)).toEqual([null, "#111111", RED, BLUE]);
    expect(plan.indexOf.get(RED)).toBe(2);
    expect(plan.indexOf.get(BLUE)).toBe(3);
    expect(plan.counts[1]).toBe(3);
    expect(plan.counts[2]).toBe(entityWeight(8 + 8));
  });
  it("does nothing when off or when there are none", () => {
    expect(planEntityColors(colors, counts, p.entities, { ...DEFAULT_FDM_OPTIONS, includeEntities: false }).indexOf.size).toBe(0);
    expect(planEntityColors(colors, counts, undefined, DEFAULT_FDM_OPTIONS).colors.length).toBe(2);
  });
  it("an entity always counts for at least one block", () => {
    expect(entityWeight(1)).toBe(1);
    expect(entityWeight(2560)).toBe(10);
  });
});

describe("applyEntities", () => {
  it("stamps an entity's cells into empty space, converting MC axes to slicer axes", () => {
    const p = scene([stand([4, 5, 6, 8, 9, 10])]);
    const { g, r } = stamp(p, noWall);
    expect(r).toMatchObject({ stamped: 4 * 4 * 4, skipped: null });
    expect(countCells(g, 1)).toBe(64);
    // MC (x, y, z) = (4, 5, 6) lands at slicer (x, Y-1-z, y) with Y = 2 blocks * 16
    expect(cellAt(g, 4, 31 - 6, 5)).toBe(1);
    expect(cellAt(g, 7, 31 - 9, 8)).toBe(1);
    expect(cellAt(g, 8, 31 - 9, 8)).toBe(0);
  });
  it("never replaces a block", () => {
    // stone at MC block (1,0,0) covers MC cells x 16..31, y 0..15, z 0..15; the entity straddles its edge
    const p = scene([stand([12, 2, 2, 20, 6, 6])], true);
    const { g, r } = stamp(p, noWall, () => 2);
    expect(r.stamped).toBe(4 * 4 * 4); // only the x 12..15 half is free
    expect(countCells(g, 2)).toBe(64);
    expect(cellAt(g, 16, 31 - 3, 3)).toBe(1); // still stone
  });
  it("leaves out colours with no slot and entities when off", () => {
    expect(stamp(scene([stand([0, 0, 0, 4, 4, 4])]), noWall, () => 0).r.stamped).toBe(0);
    const g = buildSparseGrid(scene([stand([0, 0, 0, 4, 4, 4])]), noWall, ident(1));
    expect(applyEntities(g, scene([stand([0, 0, 0, 4, 4, 4])]), () => 1, { ...noWall, includeEntities: false }).stamped).toBe(0);
  });
  it("skips everything, changing nothing, over the budget", () => {
    const p = scene([stand([0, 0, 0, 10, 10, 10])]);
    const g = buildSparseGrid(p, noWall, ident(1));
    const r = applyEntities(g, p, () => 1, noWall, 500);
    expect(r).toMatchObject({ stamped: 0, skipped: { wanted: 1000, limit: 500 } });
    expect(countCells(g, 1)).toBe(0);
  });
  it("counts cells per slot", () => {
    const p = scene([{ kind: "x", palette: [RED, BLUE], boxes: [[0, 0, 0, 2, 2, 2, 0], [4, 0, 0, 5, 2, 2, 1]] }]);
    const { r } = stamp(p, noWall, (hex) => (hex === RED ? 1 : 2));
    expect([...r.byBucket]).toEqual([[1, 8], [2, 4]]);
  });
});

describe("minimum wall for entities", () => {
  // a painting: 8 x 8 cells, one cell thick in z, hung on the north face of the selection (z 0..1)
  const painting = stand([4, 4, 8, 12, 12, 9]);
  it("thin parts grow to the wall along x and z but never along y", () => {
    const { g, r } = stamp(scene([painting]), withWall);
    expect(r.stamped).toBe(8 * 8 * 4); // z grows from 1 to 4 cells; x is already 8 long
    const zCells = [0, 1, 2, 3].map((i) => cellAt(g, 8, 31 - (7 + i), 8));
    expect(zCells.filter((v) => v === 1).length).toBe(4);
    expect(cellAt(g, 8, 31 - 8, 3)).toBe(0); // y neither grows below...
    expect(cellAt(g, 8, 31 - 8, 12)).toBe(0); // ...nor above
  });
  it("grows into free air first, so a part against a block thickens away from it", () => {
    // stone at MC block (1,0,0) occupies x 16..31; a sheet at x 14..15 would grow toward x 16 if symmetric
    const sheet = stand([15, 4, 4, 16, 12, 12]); // one cell thick in x, touching the stone's face
    const { g, r } = stamp(scene([sheet], true), withWall);
    expect(r.stamped).toBe(4 * 8 * 8); // still 4 cells thick, all of it on the free side
    expect(cellAt(g, 12, 31 - 8, 8)).toBe(1);
    expect(cellAt(g, 15, 31 - 8, 8)).toBe(1);
    expect(cellAt(g, 16, 31 - 8, 8)).toBe(1); // stone, untouched
  });
  it("does nothing to parts already thick enough", () => {
    expect(stamp(scene([stand([2, 2, 2, 10, 10, 10])]), withWall).r.stamped).toBe(512);
  });
});

describe("pipeline with entities", () => {
  const house = scene([stand([20, 0, 20, 28, 12, 28], RED)], true);
  it("gives the entity a slot, keeps every colour a closed manifold, and reports its cells", () => {
    const r = runPipeline(house, noWall, { maxSlots: 4 });
    expect(r.entityCells).toBe(8 * 12 * 8);
    expect(r.entitiesSkipped).toBeNull();
    expect(r.quantization.buckets.length).toBe(2); // stone and the entity colour
    expect([...r.entityBuckets.values()]).toEqual([8 * 12 * 8]);
    expect(r.reports.every((x) => x.ok)).toBe(true);
    for (const b of r.quantization.buckets) expect(b.paletteIndices.every((i) => i < house.palette.length)).toBe(true);
  });
  it("is off with the option, in mono, and for builds without entities", () => {
    const off = runPipeline(house, { ...noWall, includeEntities: false }, { maxSlots: 4 });
    expect(off.entityCells).toBeNull();
    expect(off.quantization.buckets.length).toBe(1);
    expect(runPipeline(house, noWall, { maxSlots: 1 }).meshes.length).toBe(1);
    expect(runPipeline({ ...house, entities: undefined }, noWall, { maxSlots: 4 }).entityCells).toBeNull();
  });
  it("is deterministic and survives fill, repair and wall thickening together", () => {
    const o = { ...DEFAULT_FDM_OPTIONS, scaleMmPerBlock: 4 };
    const a = runPipeline(house, o, { maxSlots: 4 }), b = runPipeline(house, o, { maxSlots: 4 });
    expect(a.meshes.map((m) => Array.from(m.positions))).toEqual(b.meshes.map((m) => Array.from(m.positions)));
    expect(a.reports.every((x) => x.ok)).toBe(true);
  });
});

describe("loader", () => {
  const base = () => JSON.parse(JSON.stringify({ ...scene([stand([0, 0, 0, 4, 4, 4])]), voxelsBase64: new PayloadBuilder("t", [2, 2, 2]).build().voxelsBase64 }));
  it("accepts a well-formed entity list and keeps it", () => {
    expect(parsePayload(base()).payload.entities).toHaveLength(1);
  });
  it("accepts payloads without entities", () => {
    const p = base();
    delete p.entities;
    expect(parsePayload(p).payload.entities).toBeUndefined();
  });
  it("rejects malformed entities", () => {
    const bad = (mut: (p: any) => void) => { const p = base(); mut(p); expect(() => parsePayload(p)).toThrow(/entities/); };
    bad((p) => { p.entities = "x"; });
    bad((p) => { p.entities[0].palette = ["red"]; });
    bad((p) => { p.entities[0].boxes[0] = [0, 0, 0, 4, 4]; });
    bad((p) => { p.entities[0].boxes[0] = [0, 0, 0, 40, 4, 4, 0]; }); // outside the 32-cell selection
    bad((p) => { p.entities[0].boxes[0] = [2, 0, 0, 2, 4, 4, 0]; }); // empty
    bad((p) => { p.entities[0].boxes[0] = [0, 0, 0, 4, 4, 4, 3]; }); // colour index out of range
  });
});
