// Surface colours: a grass block is green on top and dirt on the sides, a log has rings on its ends and bark around them, and
// sand is speckled with lighter and darker grains.
//
// The mod stores a per-texel colour map for full-cube blocks (docs/01 `texture`: six 16x16 faces, one texel per sub-voxel) and,
// from older mods, six flat face colours (`faces`). Both are read as a `TexelSource`. Two steps use them:
//  1. Colour planning (`planFaceColors`): the block's core colour becomes its typical colour and every other distinct texel
//     colour joins the colour clustering as an extra point, so texels share filament slots with everything else.
//  2. Skinning (`applyFaceSkins`): after relief, the outer `skinDepth` cells under each exposed texel are recoloured to that
//     texel's slot. Only the colour of existing cells changes, never whether a cell is solid, so geometry, bed fit and
//     contacts between blocks are untouched and the usual repair and validation still apply.
import { base64ToBytes, decodeVoxels } from "../../payload/loader";
import { detailOf, type MeshingOptions, type SparseGrid } from "../../types/mesh";
import { TEXTURE_BYTES, type PaletteEntry, type VoxelPayload } from "../../types/voxelPayload";
import { faceCell, faceNeighbour, faceOutside } from "./faceFrame";
import { chunkSolidAt, getCell, setCell } from "./gridAccess";
import { isIncluded } from "./filters";
import { modelOf } from "./models";

/** Target skin thickness; colour layers thinner than a nozzle line blend into their neighbours when sliced. */
export const SKIN_MM = 0.8;
export const SKIN_MAX_CELLS = 6;
/**
 * Budget on recoloured cells. Every recoloured cell is written into a per-block chunk array, so past this the grid would
 * grow too large. The skins are then skipped entirely (never partial) and the caller says so.
 */
export const MAX_SKIN_CELLS = 4_000_000;

const TEXELS = 6 * 256;
/** Distinct colours one block type may bring to the clustering; rarer ones fold into their nearest. */
export const MAX_TEXEL_COLORS = 32;

/** Faces are applied in this order, so on a shared edge the later one wins: sides, then bottom, then top (grass keeps a green rim). */
const FACE_ORDER = [2, 3, 4, 5, 0, 1] as const;

const isFullCube = (e: PaletteEntry) =>
  e.boxes.some((b) => b[0] === 0 && b[1] === 0 && b[2] === 0 && b[3] === 16 && b[4] === 16 && b[5] === 16);

/** The six face colours when this entry has usable ones and is a full cube, else null. */
export function faceColorsOf(e: PaletteEntry): string[] | null {
  return e.faces && e.faces.length === 6 && isFullCube(e) ? e.faces.map((c) => c.toUpperCase()) : null;
}

/** A block's surface colours: `index[face * 256 + a + b * 16]` is the texel's position in `colors`. */
export interface TexelSource {
  colors: string[];
  index: Uint8Array;
  /** The block's own (interior) colour. */
  core: string;
  /** From a texel map (true) or from six flat face colours (false). */
  textured: boolean;
}

const hex2 = (v: number) => v.toString(16).padStart(2, "0");
const toHex = (r: number, g: number, b: number) => ("#" + hex2(r) + hex2(g) + hex2(b)).toUpperCase();

const sources = new WeakMap<PaletteEntry, TexelSource | null>();

/** The surface colours of a full-cube entry, or null when it has none (not a cube, or neither a texture nor faces). */
export function texelSourceOf(e: PaletteEntry): TexelSource | null {
  if (sources.has(e)) return sources.get(e)!;
  let out: TexelSource | null = null;
  if (isFullCube(e)) {
    if (e.texture) out = fromTexture(e.texture);
    else {
      const faces = faceColorsOf(e);
      if (faces) {
        const colors: string[] = [];
        const index = new Uint8Array(TEXELS);
        for (let f = 0; f < 6; f++) {
          let at = colors.indexOf(faces[f]!);
          if (at < 0) at = colors.push(faces[f]!) - 1;
          index.fill(at, f * 256, (f + 1) * 256);
        }
        out = { colors, index, core: coreColor(faces), textured: false };
      }
    }
  }
  sources.set(e, out);
  return out;
}

function fromTexture(b64: string): TexelSource | null {
  const bytes = base64ToBytes(b64);
  if (bytes.length !== TEXTURE_BYTES) return null;
  // Group texels by their colour at 4 bits a channel; each group's colour is the mean of what is in it.
  const keyOf = new Int32Array(TEXELS);
  const groups = new Map<number, { r: number; g: number; b: number; n: number }>();
  let tr = 0, tg = 0, tb = 0;
  for (let t = 0; t < TEXELS; t++) {
    const r = bytes[t * 3]!, g = bytes[t * 3 + 1]!, b = bytes[t * 3 + 2]!;
    tr += r; tg += g; tb += b;
    const key = (r >> 4) << 8 | (g >> 4) << 4 | (b >> 4);
    keyOf[t] = key;
    const grp = groups.get(key);
    if (grp) { grp.r += r; grp.g += g; grp.b += b; grp.n++; } else groups.set(key, { r, g, b, n: 1 });
  }
  const ranked = [...groups.entries()].sort((a, b) => b[1].n - a[1].n || a[0] - b[0]);
  const kept = ranked.slice(0, MAX_TEXEL_COLORS);
  const means = kept.map(([, g]) => [Math.round(g.r / g.n), Math.round(g.g / g.n), Math.round(g.b / g.n)] as const);
  const slot = new Map<number, number>(kept.map(([key], i) => [key, i]));
  for (const [key, g] of ranked.slice(MAX_TEXEL_COLORS)) {
    const r = g.r / g.n, gr = g.g / g.n, b = g.b / g.n;
    let best = 0, bestD = Infinity;
    means.forEach((m, i) => {
      const d = (m[0] - r) ** 2 + (m[1] - gr) ** 2 + (m[2] - b) ** 2;
      if (d < bestD) { bestD = d; best = i; }
    });
    slot.set(key, best);
  }
  const index = new Uint8Array(TEXELS);
  for (let t = 0; t < TEXELS; t++) index[t] = slot.get(keyOf[t]!)!;
  // Several folded groups can share a colour once rounded; keep the list distinct.
  const colors: string[] = [];
  const remap = means.map((m) => {
    const h = toHex(m[0], m[1], m[2]);
    const at = colors.indexOf(h);
    return at >= 0 ? at : colors.push(h) - 1;
  });
  for (let t = 0; t < TEXELS; t++) index[t] = remap[index[t]!]!;
  return { colors, index, core: toHex(Math.round(tr / TEXELS), Math.round(tg / TEXELS), Math.round(tb / TEXELS)), textured: true };
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

/** Skin thickness in cells: about SKIN_MM of material at this scale, at least one cell, at most SKIN_MAX_CELLS (per detail step). */
export function skinDepth(o: MeshingOptions): number {
  const R = detailOf(o);
  const cellMm = o.scaleMmPerBlock / (16 * R);
  return Math.min(SKIN_MAX_CELLS * R, Math.max(1, Math.round(SKIN_MM / cellMm)));
}

export interface FacePlan {
  /** The colours to quantize: `palette` with core colours substituted, followed by one extra entry per distinct skin colour. */
  colors: Array<{ color: string | null }>;
  /** Voxel counts for `colors` (an extra weighs as many as the cells of its block type that wear it). */
  counts: Uint32Array;
  /** Palette index -> for each of the 1536 texels an index into `colors` (0 where the texel just uses the block's own colour). */
  faceIndex: Map<number, Int32Array>;
  /** Extra index -> the palette index it belongs to. */
  owners: Map<number, number>;
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
  const faceIndex = new Map<number, Int32Array>();
  const owners = new Map<number, number>();
  if (o.faceColors !== false) {
    for (let i = 1; i < palette.length; i++) {
      const e = palette[i]!;
      if (!isIncluded(e, o) || modelOf(e, o) || (counts[i] ?? 0) === 0) continue;
      const src = texelSourceOf(e);
      if (!src) continue;
      const core = src.core;
      colors[i] = { color: core };
      const freq = new Array<number>(src.colors.length).fill(0);
      for (let t = 0; t < TEXELS; t++) freq[src.index[t]!]!++;
      const mine = new Map<string, number>();
      const local = src.colors.map((hex, k) => {
        if (hex === core) return 0;
        let at = mine.get(hex);
        if (at === undefined) {
          at = colors.length;
          colors.push({ color: hex });
          outCounts.push(src.textured ? Math.max(1, Math.round((counts[i]! * freq[k]!) / TEXELS)) : counts[i]!);
          mine.set(hex, at);
          owners.set(at, i);
        }
        return at;
      });
      const idx = new Int32Array(TEXELS);
      for (let t = 0; t < TEXELS; t++) idx[t] = local[src.index[t]!]!;
      if (idx.some((v) => v !== 0)) faceIndex.set(i, idx);
    }
  }
  return { colors, counts: Uint32Array.from(outCounts), faceIndex, owners, paletteLength: palette.length };
}

/**
 * Texel -> bucket for every block type that keeps a skin (1536 entries, face * 256 + a + b * 16). `bucketOf` is the
 * quantizer's map over `plan.colors`; `mainBucket` is the block's effective bucket (overrides included). A texel whose colour
 * ended up in the block's own slot needs no skin.
 */
export function faceBuckets(plan: FacePlan, bucketOf: Uint16Array, mainBucket: Uint16Array): Map<number, Uint16Array> {
  const out = new Map<number, Uint16Array>();
  for (const [i, idx] of plan.faceIndex) {
    const main = mainBucket[i] ?? 0;
    if (main === 0) continue;
    const fb = new Uint16Array(TEXELS);
    let any = false;
    for (let t = 0; t < TEXELS; t++) {
      const b = idx[t]! === 0 ? 0 : (bucketOf[idx[t]!] ?? 0);
      if (b !== 0 && b !== main) {
        fb[t] = b;
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
  const R = detailOf(o), N = 16 * R;
  const Y = sz * N;
  const slicer = (gx: number, gy: number, gz: number): [number, number, number] => [gx, Y - 1 - gz, gy];
  const thick = skinDepth(o);
  const maxSkip = o.reliefDepth ?? 0;

  // Two ints per planned cell: x | y << 12 and z | bucket << 12 (lattice coordinates are below 4096, buckets below 32).
  let plan = new Int32Array(1 << 16);
  let planned = 0;
  const push = (x: number, y: number, z: number, bucket: number) => {
    if (planned * 2 + 2 > plan.length) {
      const grown = new Int32Array(plan.length * 2);
      grown.set(plan);
      plan = grown;
    }
    plan[planned * 2] = x | (y << 12);
    plan[planned * 2 + 1] = z | (bucket << 12);
    planned++;
  };
  for (let by = 0; by < sy; by++)
    for (let bz = 0; bz < sz; bz++)
      for (let bx = 0; bx < sx; bx++) {
        const fb = buckets.get(voxels[bx + bz * sx + by * sx * sz]!);
        if (!fb) continue;
        for (const f of FACE_ORDER) {
          if (!fb.subarray(f * 256, (f + 1) * 256).some((v) => v !== 0)) continue;
          const [dx, dy, dz] = faceNeighbour(f);
          const nbx = bx + dx, nby = by + dy, nbz = bz + dz;
          if (nbx >= 0 && nby >= 0 && nbz >= 0 && nbx < sx && nby < sy && nbz < sz) {
            let covered = true; // uniform non-air chunks all along the neighbour's near layer cover this whole face
            for (let j = 0; covered && j < R; j++)
              for (let i = 0; covered && i < R; i++) {
                const [ox, oy, oz] = faceOutside(f, i * 16, j * 16, N);
                const [cx, cy, cz] = slicer(bx * N + ox, by * N + oy, bz * N + oz);
                covered = chunkSolidAt(grid, cx, cy, cz);
              }
            if (covered) continue;
          }
          for (let b = 0; b < N; b++)
            for (let a = 0; a < N; a++) {
              const bucket = fb[f * 256 + Math.floor(a / R) + Math.floor(b / R) * 16]!;
              if (bucket === 0) continue;
              const [ox, oy, oz] = faceOutside(f, a, b, N);
              const [ex, ey, ez] = slicer(bx * N + ox, by * N + oy, bz * N + oz);
              if (getCell(grid, ex, ey, ez) !== 0) continue; // covered by something solid
              let k = 0;
              const cellAt = (kk: number): [number, number, number] => {
                const [lx, ly, lz] = faceCell(f, a, b, kk, N);
                return slicer(bx * N + lx, by * N + ly, bz * N + lz);
              };
              // Skip the cells this face's own relief carved. Air deeper than that was carved by another face (a pit on the
              // neighbouring side), and the column is left alone rather than recolouring cells far from this surface.
              while (k <= maxSkip && getCell(grid, ...cellAt(k)) === 0) k++;
              if (k > maxSkip) continue;
              for (const end = Math.min(N, k + thick); k < end; k++) {
                const [cx, cy, cz] = cellAt(k);
                if (getCell(grid, cx, cy, cz) === 0) continue;
                push(cx, cy, cz, bucket);
                if (planned > limit) return { recolored: 0, skipped: { wanted: planned, limit } };
              }
            }
        }
      }

  for (let i = 0; i < planned; i++) {
    const a = plan[i * 2]!, b = plan[i * 2 + 1]!;
    setCell(grid, a & 4095, a >> 12, b & 4095, b >> 12);
  }
  return { recolored: planned, skipped: null };
}
