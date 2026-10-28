// Captured entities (armor stands, item frames, paintings, mobs...): the mod renders each one off-screen and sends the cells
// it drew as coloured boxes (docs/01 §3c). Two steps use them, both after the block grid exists:
//  1. Colour planning (`planEntityColors`): every distinct entity colour joins the colour clustering, so entities share
//     filament slots with the blocks.
//  2. Stamping (`applyEntities`): each entity's cells are written into the grid, but only into air, so a real block always
//     wins and the block geometry is never disturbed. Entities are first given the minimum wall (see `widen`).
import type { MeshingOptions, SparseGrid } from "../../types/mesh";
import type { PayloadEntity, VoxelPayload } from "../../types/voxelPayload";
import { getCell, setCell } from "./gridAccess";

/**
 * Budget on stamped cells. Past this the grid would grow too large; entities are then skipped entirely (never partially)
 * and the caller says so.
 */
export const MAX_ENTITY_CELLS = 2_000_000;

const volume = (b: readonly number[]) => (b[3]! - b[0]!) * (b[4]! - b[1]!) * (b[5]! - b[2]!);

/** How much an entity colour counts in the clustering: roughly the faces it shows, in blocks, never less than one. */
export const entityWeight = (cells: number): number => Math.max(1, Math.round(cells / 256));

export interface EntityColorPlan {
  /** The palette colours followed by one extra per distinct entity colour. */
  colors: Array<{ color: string | null }>;
  counts: Uint32Array;
  /** Entity colour ("#RRGGBB", upper case) -> index into `colors`. */
  indexOf: Map<string, number>;
}

/** Append the entity colours to the clustering input. A no-op when entities are off or absent. */
export function planEntityColors(colors: Array<{ color: string | null }>, counts: Uint32Array, entities: PayloadEntity[] | undefined, o: MeshingOptions): EntityColorPlan {
  const outColors = colors.slice();
  const outCounts = Array.from(counts);
  const indexOf = new Map<string, number>();
  if (o.includeEntities !== false && entities) {
    const cells = new Map<string, number>(); // insertion order = first use, so the result is deterministic
    for (const e of entities)
      for (const b of e.boxes) {
        const hex = e.palette[b[6]]!.toUpperCase();
        cells.set(hex, (cells.get(hex) ?? 0) + volume(b));
      }
    for (const [hex, n] of cells) {
      indexOf.set(hex, outColors.length);
      outColors.push({ color: hex });
      outCounts.push(entityWeight(n));
    }
  }
  return { colors: outColors, counts: Uint32Array.from(outCounts), indexOf };
}

export interface EntityResult {
  /** Cells written into the grid (0 when skipped). */
  stamped: number;
  /** Cells per bucket, for the slot list. */
  byBucket: Map<number, number>;
  /** Set when the entities would exceed the budget: how many cells they wanted. */
  skipped: { wanted: number; limit: number } | null;
}

/** Minimum wall in cells for these options: the same rule the block dilation uses (docs/03 §2). 0 = no thickening. */
export function minWallCells(o: MeshingOptions): number {
  if (!(o.minNozzleWallMm > 0) || !(o.scaleMmPerBlock > 0)) return 0;
  return Math.min(16, Math.ceil((o.minNozzleWallMm / o.scaleMmPerBlock) * 16 - 1e-9));
}

/**
 * Stamp the entities into `grid`. `bucketOf` maps an entity colour to its filament slot (0 = leave it out).
 * Thin parts are widened to the minimum wall along the two horizontal axes (MC x and z, as for blocks), growing into free
 * air first so a painting hung on a wall thickens outward instead of into the wall.
 */
export function applyEntities(grid: SparseGrid, p: VoxelPayload, bucketOf: (hex: string) => number, o: MeshingOptions, limit = MAX_ENTITY_CELLS): EntityResult {
  const none: EntityResult = { stamped: 0, byBucket: new Map(), skipped: null };
  const entities = p.entities;
  if (!entities || entities.length === 0 || o.includeEntities === false) return none;
  let wanted = 0;
  for (const e of entities) for (const b of e.boxes) wanted += volume(b);
  if (wanted > limit) return { stamped: 0, byBucket: new Map(), skipped: { wanted, limit } };

  const [, , sz] = p.dimensions;
  const Y = sz * 16;
  const [Bx, By, Bz] = grid.blocks;
  const gx = Bx * 16, gy = By * 16, gz = Bz * 16;
  /** MC global lattice -> slicer cell, as for blocks (docs/01 §1). */
  const toSlicer = (x: number, y: number, z: number): [number, number, number] => [x, Y - 1 - z, y];
  const inGrid = (x: number, y: number, z: number) => { const [a, b, c] = toSlicer(x, y, z); return a >= 0 && b >= 0 && c >= 0 && a < gx && b < gy && c < gz; };
  const free = (x: number, y: number, z: number) => { if (!inGrid(x, y, z)) return false; const [a, b, c] = toSlicer(x, y, z); return getCell(grid, a, b, c) === 0; };
  const wall = minWallCells(o);

  const byBucket = new Map<number, number>();
  let stamped = 0;
  for (const e of entities) {
    const buckets = e.palette.map((hex) => bucketOf(hex.toUpperCase()));
    let x0 = Infinity, y0 = Infinity, z0 = Infinity, x1 = -Infinity, y1 = -Infinity, z1 = -Infinity;
    for (const b of e.boxes) {
      x0 = Math.min(x0, b[0]); y0 = Math.min(y0, b[1]); z0 = Math.min(z0, b[2]);
      x1 = Math.max(x1, b[3]); y1 = Math.max(y1, b[4]); z1 = Math.max(z1, b[5]);
    }
    if (!isFinite(x0)) continue;
    const pad = wall > 1 ? wall : 0;
    const rx = x0 - pad, ry = y0, rz = z0 - pad;
    const W = x1 - x0 + 2 * pad, H = y1 - y0, D = z1 - z0 + 2 * pad;
    const cells = new Uint16Array(W * H * D);
    const at = (x: number, y: number, z: number) => (x - rx) + W * ((y - ry) + H * (z - rz));
    for (const b of e.boxes) {
      const bucket = buckets[b[6]]!;
      if (bucket === 0) continue;
      for (let z = b[2]; z < b[5]; z++)
        for (let y = b[1]; y < b[4]; y++) cells.fill(bucket, at(b[0], y, z), at(b[3], y, z));
    }
    if (wall > 1) {
      widen(cells, [rx, ry, rz], [W, H, D], 0, wall, free);
      widen(cells, [rx, ry, rz], [W, H, D], 2, wall, free);
    }
    for (let z = rz; z < rz + D; z++)
      for (let y = ry; y < ry + H; y++)
        for (let x = rx; x < rx + W; x++) {
          const bucket = cells[at(x, y, z)]!;
          if (bucket === 0 || !free(x, y, z)) continue;
          const [a, b, c] = toSlicer(x, y, z);
          setCell(grid, a, b, c, bucket);
          byBucket.set(bucket, (byBucket.get(bucket) ?? 0) + 1);
          stamped++;
        }
  }
  return { stamped, byBucket, skipped: null };
}

/**
 * Widen every run of cells along `axis` (0 = x, 2 = z) shorter than `min` to `min`, in place. New cells take the colour of the
 * run end they grow from. Each run grows half to each side; a side that is blocked (a wall, the edge of the grid, another part)
 * hands its share to the other side. `origin` and `dims` locate the local array in MC lattice coordinates.
 */
export function widen(cells: Uint16Array, origin: [number, number, number], dims: [number, number, number], axis: 0 | 2, min: number, free: (x: number, y: number, z: number) => boolean): void {
  const [W, H, D] = dims;
  const [rx, ry, rz] = origin;
  const len = axis === 0 ? W : D;
  const at = (i: number, y: number, o: number) => (axis === 0 ? i + W * (y + H * o) : o + W * (y + H * i));
  const world = (i: number, y: number, o: number): [number, number, number] => (axis === 0 ? [rx + i, ry + y, rz + o] : [rx + o, ry + y, rz + i]);
  const outer = axis === 0 ? D : W;
  const ok = (i: number, y: number, o: number) => i >= 0 && i < len && cells[at(i, y, o)] === 0 && free(...world(i, y, o));

  for (let o = 0; o < outer; o++)
    for (let y = 0; y < H; y++) {
      const runs: Array<[number, number]> = [];
      for (let i = 0; i < len; ) {
        if (cells[at(i, y, o)] === 0) { i++; continue; }
        let j = i;
        while (j < len && cells[at(j, y, o)] !== 0) j++;
        if (j - i < min) runs.push([i, j]);
        i = j;
      }
      for (const [a, b] of runs) {
        const need = min - (b - a);
        let lo = Math.floor(need / 2), hi = need - lo;
        let gotLo = 0, gotHi = 0;
        while (gotLo < lo && ok(a - 1 - gotLo, y, o)) { cells[at(a - 1 - gotLo, y, o)] = cells[at(a, y, o)]!; gotLo++; }
        hi += lo - gotLo; // a blocked side hands its share over
        while (gotHi < hi && ok(b + gotHi, y, o)) { cells[at(b + gotHi, y, o)] = cells[at(b - 1, y, o)]!; gotHi++; }
        lo = need - gotLo - gotHi; // and the other way round when the second side is blocked too
        while (lo > 0 && ok(a - 1 - gotLo, y, o)) { cells[at(a - 1 - gotLo, y, o)] = cells[at(a, y, o)]!; gotLo++; lo--; }
      }
    }
}
