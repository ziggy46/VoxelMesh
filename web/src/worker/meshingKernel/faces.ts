// Per-face colours: a grass block is green on top and dirt on the sides, a log has rings on its ends and bark around them.
//
// The mod stores six face colours for full-cube blocks whose faces really differ (docs/01 `faces`). Two steps use them:
//  1. Colour planning (`planFaceColors`): the block's core colour becomes the most typical of its six faces and every other
//     distinct face colour joins the colour clustering as an extra point, so faces share filament slots with everything else.
//  2. Skinning (`applyFaceSkins`): after relief, the outer `skinDepth` cells under each exposed face are recoloured to that
//     face's slot. Only the colour of existing cells changes, never whether a cell is solid, so geometry, bed fit and
//     contacts between blocks are untouched and the usual repair and validation still apply.
import { decodeVoxels } from "../../payload/loader";
import type { MeshingOptions, SparseGrid } from "../../types/mesh";
import type { PaletteEntry, VoxelPayload } from "../../types/voxelPayload";
import { faceCell, faceNeighbour, faceOutside } from "./faceFrame";
import { getCell, setCell } from "./gridAccess";
import { isIncluded } from "./filters";
import { modelOf } from "./models";

/** Target skin thickness; colour layers thinner than a nozzle line blend into their neighbours when sliced. */
export const SKIN_MM = 0.8;
export const SKIN_MAX_CELLS = 6;
/**
 * Budget on recoloured cells. Every recoloured cell is written into a per-block chunk array, so past this the grid would
 * grow too large. The skins are then skipped entirely (never partial) and the caller says so.
 */
export const MAX_SKIN_CELLS = 2_000_000;

/** Faces are applied in this order, so on a shared edge the later one wins: sides, then bottom, then top (grass keeps a green rim). */
const FACE_ORDER = [2, 3, 4, 5, 0, 1] as const;

const isFullCube = (e: PaletteEntry) =>
  e.boxes.some((b) => b[0] === 0 && b[1] === 0 && b[2] === 0 && b[3] === 16 && b[4] === 16 && b[5] === 16);

/** The six face colours when this entry has usable ones and is a full cube, else null. */
export function faceColorsOf(e: PaletteEntry): string[] | null {
  return e.faces && e.faces.length === 6 && isFullCube(e) ? e.faces.map((c) => c.toUpperCase()) : null;
}

const rgb = (hex: string): [number, number, number] => {
  const v = parseInt(hex.slice(1), 16);
  return [(v >> 16) & 255, (v >> 8) & 255, v & 255];
};
const d2 = (a: string, b: string) => {
  const [r1, g1, b1] = rgb(a), [r2, g2, b2] = rgb(b);
  return (r1 - r2) ** 2 + (g1 - g2) ** 2 + (b1 - b2) ** 2;
};

/** The face colour closest to all the others (lowest face index on a tie): grass -> dirt, log -> bark. */
export function coreColor(faces: readonly string[]): string {
  let best = 0, bestSum = Infinity;
  for (let i = 0; i < faces.length; i++) {
    let sum = 0;
    for (let j = 0; j < faces.length; j++) sum += d2(faces[i]!, faces[j]!);
    if (sum < bestSum) {
      bestSum = sum;
      best = i;
    }
  }
  return faces[best]!;
}

/** Skin thickness in cells: about SKIN_MM of material at this scale, at least one cell, at most SKIN_MAX_CELLS. */
export function skinDepth(o: MeshingOptions): number {
  const cellMm = o.scaleMmPerBlock / 16;
  return Math.min(SKIN_MAX_CELLS, Math.max(1, Math.round(SKIN_MM / cellMm)));
}

export interface FacePlan {
  /** The colours to quantize: `palette` with core colours substituted, followed by one extra entry per distinct skin colour. */
  colors: Array<{ color: string | null }>;
  /** Voxel counts for `colors` (an extra weighs as many as the block type it belongs to). */
  counts: Uint32Array;
  /** Palette index -> six indices into `colors` (0 where the face just uses the block's own colour). */
  faceIndex: Map<number, number[]>;
  /** Length of the original palette; indices at or above it are extras. */
  paletteLength: number;
}

/**
 * Prepare the colour clustering input. With face colours off, or none in the payload, this is the palette unchanged and
 * `faceIndex` is empty, so the clustering is exactly what it was before face colours existed.
 */
export function planFaceColors(palette: PaletteEntry[], counts: Uint32Array, o: MeshingOptions): FacePlan {
  const colors: Array<{ color: string | null }> = palette.map((e) => ({ color: e.color }));
  const outCounts: number[] = Array.from(counts);
  const faceIndex = new Map<number, number[]>();
  if (o.faceColors !== false) {
    for (let i = 1; i < palette.length; i++) {
      const e = palette[i]!;
      const faces = faceColorsOf(e);
      if (!faces || !isIncluded(e, o) || modelOf(e, o) || (counts[i] ?? 0) === 0) continue;
      const core = coreColor(faces);
      colors[i] = { color: core };
      const mine = new Map<string, number>();
      const idx = faces.map((hex) => {
        if (hex === core) return 0;
        let at = mine.get(hex);
        if (at === undefined) {
          at = colors.length;
          colors.push({ color: hex });
          outCounts.push(counts[i]!);
          mine.set(hex, at);
        }
        return at;
      });
      if (idx.some((v) => v !== 0)) faceIndex.set(i, idx);
    }
  }
  return { colors, counts: Uint32Array.from(outCounts), faceIndex, paletteLength: palette.length };
}

/**
 * Face -> bucket for every block type that keeps a skin. `bucketOf` is the quantizer's map over `plan.colors`; `mainBucket` is
 * the block's effective bucket (overrides included). A face whose colour ended up in the block's own slot needs no skin.
 */
export function faceBuckets(plan: FacePlan, bucketOf: Uint16Array, mainBucket: Uint16Array): Map<number, Uint16Array> {
  const out = new Map<number, Uint16Array>();
  for (const [i, idx] of plan.faceIndex) {
    const main = mainBucket[i] ?? 0;
    if (main === 0) continue;
    const fb = new Uint16Array(6);
    let any = false;
    for (let f = 0; f < 6; f++) {
      const b = idx[f]! === 0 ? 0 : (bucketOf[idx[f]!] ?? 0);
      if (b !== 0 && b !== main) {
        fb[f] = b;
        any = true;
      }
    }
    if (any) out.set(i, fb);
  }
  return out;
}

export interface FaceSkinResult {
  /** Cells recoloured (0 when skipped). */
  recolored: number;
  /** Set when the skins would exceed the budget: how many cells they wanted. */
  skipped: { wanted: number; limit: number } | null;
}

/**
 * Recolour the outer cells under each exposed face of the blocks in `buckets` (palette index -> face buckets). A column is
 * exposed when the cell just outside it is air; the skin starts at the first solid cell going inward (at most `reliefDepth`
 * cells down, so it follows this face's own relief pits) and runs `skinDepth` cells. Decisions use the pre-skin grid, so the result does not depend on order.
 */
export function applyFaceSkins(grid: SparseGrid, p: VoxelPayload, buckets: Map<number, Uint16Array>, o: MeshingOptions, limit = MAX_SKIN_CELLS): FaceSkinResult {
  const none: FaceSkinResult = { recolored: 0, skipped: null };
  if (buckets.size === 0) return none;
  const [sx, sy, sz] = p.dimensions;
  const voxels = decodeVoxels(p.voxelsBase64);
  const Y = sz * 16;
  const slicer = (gx: number, gy: number, gz: number): [number, number, number] => [gx, Y - 1 - gz, gy];
  const thick = skinDepth(o);
  const maxSkip = o.reliefDepth ?? 0;

  const plan: number[] = []; // x, y, z, bucket
  for (let by = 0; by < sy; by++)
    for (let bz = 0; bz < sz; bz++)
      for (let bx = 0; bx < sx; bx++) {
        const fb = buckets.get(voxels[bx + bz * sx + by * sx * sz]!);
        if (!fb) continue;
        for (const f of FACE_ORDER) {
          const bucket = fb[f]!;
          if (bucket === 0) continue;
          const [dx, dy, dz] = faceNeighbour(f);
          const nbx = bx + dx, nby = by + dy, nbz = bz + dz;
          if (nbx >= 0 && nby >= 0 && nbz >= 0 && nbx < sx && nby < sy && nbz < sz) {
            const [cx, cy, cz] = slicer(nbx * 16, nby * 16, nbz * 16);
            const chunk = grid.cells[(cx >> 4) + (cy >> 4) * grid.blocks[0] + (cz >> 4) * grid.blocks[0] * grid.blocks[1]];
            if (typeof chunk === "number" && chunk !== 0) continue; // a solid neighbour block covers this whole face
          }
          for (let b = 0; b < 16; b++)
            for (let a = 0; a < 16; a++) {
              const [ox, oy, oz] = faceOutside(f, a, b);
              const [ex, ey, ez] = slicer(bx * 16 + ox, by * 16 + oy, bz * 16 + oz);
              if (getCell(grid, ex, ey, ez) !== 0) continue; // covered by something solid
              let k = 0;
              const cellAt = (kk: number): [number, number, number] => {
                const [lx, ly, lz] = faceCell(f, a, b, kk);
                return slicer(bx * 16 + lx, by * 16 + ly, bz * 16 + lz);
              };
              // Skip the cells this face's own relief carved. Air deeper than that was carved by another face (a pit on the
              // neighbouring side), and the column is left alone rather than recolouring cells far from this surface.
              while (k <= maxSkip && getCell(grid, ...cellAt(k)) === 0) k++;
              if (k > maxSkip) continue;
              for (const end = Math.min(16, k + thick); k < end; k++) {
                const [cx, cy, cz] = cellAt(k);
                if (getCell(grid, cx, cy, cz) === 0) continue;
                plan.push(cx, cy, cz, bucket);
                if (plan.length / 4 > limit) return { recolored: 0, skipped: { wanted: plan.length / 4, limit } };
              }
            }
        }
      }

  for (let i = 0; i < plan.length; i += 4) setCell(grid, plan[i]!, plan[i + 1]!, plan[i + 2]!, plan[i + 3]!);
  return { recolored: plan.length / 4, skipped: null };
}
