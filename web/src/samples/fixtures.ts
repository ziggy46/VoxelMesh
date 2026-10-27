// Golden fixtures (docs/06 §2). Each one runs in Resin and FDM and must validate clean.
import type { PaletteEntry, VoxelPayload } from "../types/voxelPayload";
import { B } from "./blocks";
import { PayloadBuilder } from "./builder";
import { buildSampleCastle } from "./sampleCastlePayload";

export interface Fixture {
  name: string;
  payload: VoxelPayload;
  /** Bucket count used with fixtureBucketMap (stand-in for the colour quantizer). */
  buckets: number;
  /** Allowed range for sum(signedVolume) over all bucket meshes, in lattice cells, per printer mode. */
  volume?: { fdm: [number, number]; resin: [number, number] };
}

export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Deterministic palette -> bucket map used by tests (independent of the quantizer kernel). */
export function fixtureBucketMap(p: VoxelPayload, k: number): Uint16Array {
  const m = new Uint16Array(p.palette.length);
  for (let i = 1; i < p.palette.length; i++) if (p.palette[i]!.color !== null) m[i] = ((i - 1) % k) + 1;
  return m;
}

const CELL = 4096; // one full block in lattice cells
const single = (entry: PaletteEntry) => new PayloadBuilder(entry.name, [1, 1, 1]).set(0, 0, 0, entry).build();
const same = (n: number): { fdm: [number, number]; resin: [number, number] } => ({ fdm: [n, n], resin: [n, n] });

/** A wall block with a 1x1 sub-voxel channel along X (the "1-sub-voxel leak"). */
const CHANNEL_WALL: PaletteEntry = {
  id: "test:channel_wall", name: "Channel Wall", color: "#7A797A", category: "partial",
  boxes: [[0, 0, 0, 16, 7, 16], [0, 8, 0, 16, 16, 16], [0, 7, 0, 16, 8, 7], [0, 7, 8, 16, 8, 16]],
};

function room(leak: boolean): VoxelPayload {
  const b = new PayloadBuilder(leak ? "Room with leak" : "Sealed room", [3, 3, 3]);
  b.fill(0, 0, 0, 3, 3, 3, B.stone).set(1, 1, 1, null);
  if (leak) b.set(0, 1, 1, CHANNEL_WALL);
  return b.build();
}

export function goldenFixtures(): Fixture[] {
  const out: Fixture[] = [];
  const add = (f: Fixture) => out.push(f);

  // 1. Single full block.
  add({ name: "single block", payload: single(B.stone), buckets: 1, volume: same(CELL) });

  // 2. Touching blocks: shared face, shared edge, shared corner.
  add({
    name: "two blocks sharing a face", buckets: 1, volume: same(2 * CELL),
    payload: new PayloadBuilder("face", [2, 1, 1]).set(0, 0, 0, B.stone).set(1, 0, 0, B.stone).build(),
  });
  add({
    name: "two blocks touching along an edge", buckets: 1,
    volume: { fdm: [2 * CELL, 2 * CELL + 16], resin: [2 * CELL, 2 * CELL + 16] },
    payload: new PayloadBuilder("edge", [2, 2, 1]).set(0, 0, 0, B.stone).set(1, 1, 0, B.stone).build(),
  });
  add({
    name: "two blocks touching at a corner", buckets: 1,
    volume: { fdm: [2 * CELL + 1, 2 * CELL + 8], resin: [2 * CELL + 1, 2 * CELL + 8] },
    payload: new PayloadBuilder("corner", [2, 2, 2]).set(0, 0, 0, B.stone).set(1, 1, 1, B.stone).build(),
  });

  // 3. Per-bucket diagonal: 2x2 checkerboard of two colours (recolours, never adds volume).
  add({
    name: "two-colour checkerboard", buckets: 2, volume: same(4 * CELL),
    payload: new PayloadBuilder("checker", [2, 1, 2])
      .set(0, 0, 0, B.stone).set(1, 0, 0, B.red).set(0, 0, 1, B.red).set(1, 0, 1, B.stone).build(),
  });

  // 4. Partial and thin shapes. Chain is thin (2 wide): dilated to 4 in FDM only.
  add({ name: "stair", payload: single(B.stairHiS), buckets: 1, volume: same(3072) });
  add({ name: "slab", payload: single(B.stoneSlab), buckets: 1, volume: same(2048) });
  add({ name: "fence", payload: single(B.fence), buckets: 1, volume: same(4 * 16 * 4) });
  add({ name: "chain", payload: single(B.chain), buckets: 1, volume: { fdm: [4 * 16 * 4, 4 * 16 * 4], resin: [2 * 16 * 2, 2 * 16 * 2] } });
  add({ name: "lantern", payload: single(B.lantern), buckets: 1, volume: same(6 * 7 * 6 + 4 * 2 * 4) });

  // 5. Hollow room: sealed (filled in FDM, kept in Resin) and with a 1-sub-voxel leak (never filled).
  add({
    name: "sealed hollow room", payload: room(false), buckets: 1,
    volume: { fdm: [27 * CELL, 27 * CELL], resin: [26 * CELL, 26 * CELL] },
  });
  add({ name: "hollow room with 1-sub-voxel leak", payload: room(true), buckets: 1, volume: same(26 * CELL - 16) });

  // 6. The sample castle.
  add({ name: "sample castle", payload: buildSampleCastle(), buckets: 4 });

  return out;
}

/** Chiral "L" of three blocks. MC (0,0,0),(1,0,0),(0,0,1); see the mirror test for the expected slicer-space outline. */
export function chiralL(): Fixture {
  return {
    name: "chiral L", buckets: 1, volume: same(3 * CELL),
    payload: new PayloadBuilder("L", [2, 1, 2]).set(0, 0, 0, B.stone).set(1, 0, 0, B.stone).set(0, 0, 1, B.stone).build(),
  };
}

const RANDOM_KINDS: PaletteEntry[] = [
  B.stone, B.red, B.blue, B.stoneSlab, B.stairHiS, B.fence, B.chain, B.lantern, B.cobble,
];

/** Seeded random sparse 8^3 field (docs/06 §2 fixture 7). */
export function randomSparseField(seed: number): Fixture {
  const rnd = mulberry32(seed);
  const b = new PayloadBuilder(`random ${seed}`, [8, 8, 8]);
  for (const k of RANDOM_KINDS) b.def(k); // fixed palette order across seeds
  for (let y = 0; y < 8; y++)
    for (let z = 0; z < 8; z++)
      for (let x = 0; x < 8; x++)
        if (rnd() < 0.3) b.set(x, y, z, RANDOM_KINDS[Math.floor(rnd() * RANDOM_KINDS.length)]!);
  return { name: `random sparse field ${seed}`, payload: b.build(), buckets: 4 };
}

/** Deterministic rolling terrain with sealed pockets, for performance budgets (docs/00 §4). */
export function generateTerrain(n: number): Fixture {
  const b = new PayloadBuilder(`terrain ${n}`, [n, n, n]);
  for (const k of [B.stone, B.grass, B.dirt, B.cobble, B.stoneSlab, B.stairHiS]) b.def(k);
  for (let z = 0; z < n; z++)
    for (let x = 0; x < n; x++) {
      const h = Math.max(2, Math.floor(2 + (n / 2) * (0.5 + 0.25 * Math.sin(x * 0.35) + 0.25 * Math.cos(z * 0.27 + x * 0.1))));
      for (let y = 0; y < h && y < n; y++) {
        const hash = (Math.imul(x, 73856093) ^ Math.imul(y, 19349663) ^ Math.imul(z, 83492791)) >>> 0;
        if (y > 0 && y < h - 2 && hash % 61 === 0) continue; // sealed air pocket
        b.set(x, y, z, y === h - 1 ? B.grass : y > h - 4 ? B.dirt : B.stone);
      }
      if (h < n && (x + z) % 7 === 0) b.set(x, h, z, B.stoneSlab);
      else if (h < n && (x * 3 + z) % 11 === 0) b.set(x, h, z, B.stairHiS);
    }
  return { name: `terrain ${n}`, payload: b.build(), buckets: 4 };
}
