// Exact block shapes: for blocks whose hitbox is not what you see (a fence's rails, a door's panels, an anvil), the mod sends
// the shape and colours the game actually draws as coloured boxes inside the block (docs/01 §3d). This replaces the hitbox:
//  1. Colour planning (`planModelColors`): the block's own colour becomes the colour covering most of its cells and every
//     other distinct colour joins the clustering as an extra point, so they share filament slots with everything else.
//  2. Templates (`buildModelTemplates`): each such block type gets a 16x16x16 chunk of slot numbers, thickened to the minimum
//     wall like any thin part, which `buildSparseGrid` copies per block instead of filling the hitbox.
import type { MeshingOptions } from "../../types/mesh";
import type { PaletteEntry } from "../../types/voxelPayload";
import { widen, minWallCells } from "./entities";
import { isIncluded } from "./filters";

const CELLS = 16 * 16 * 16;

/** The entry's model when it has one and exact shapes are on. */
export function modelOf(e: PaletteEntry, o: MeshingOptions) {
  return o.exactShapes !== false && e.model && e.model.boxes.length > 0 && isIncluded(e, o) ? e.model : null;
}

const volume = (b: readonly number[]) => (b[3]! - b[0]!) * (b[4]! - b[1]!) * (b[5]! - b[2]!);

export interface ModelPlan {
  colors: Array<{ color: string | null }>;
  counts: Uint32Array;
  /** Palette index -> per model colour: index into `colors` for an extra, 0 where it is the block's own (dominant) colour. */
  modelIndex: Map<number, number[]>;
  /** Palette index -> the dominant colour. */
  dominant: Map<number, string>;
}

/** Extend the clustering input with the model colours. A no-op when exact shapes are off or no entry has a model. */
export function planModelColors(palette: PaletteEntry[], colors: Array<{ color: string | null }>, counts: Uint32Array, o: MeshingOptions): ModelPlan {
  const outColors = colors.slice();
  const outCounts = Array.from(counts);
  const modelIndex = new Map<number, number[]>();
  const dominant = new Map<number, string>();
  for (let i = 1; i < palette.length; i++) {
    const m = modelOf(palette[i]!, o);
    if (!m || (counts[i] ?? 0) === 0) continue;
    const cells = new Array<number>(m.palette.length).fill(0);
    for (const b of m.boxes) cells[b[6]] = cells[b[6]]! + volume(b);
    let best = 0;
    for (let k = 1; k < cells.length; k++) if (cells[k]! > cells[best]!) best = k;
    const main = m.palette[best]!.toUpperCase();
    dominant.set(i, main);
    outColors[i] = { color: main };
    const mine = new Map<string, number>();
    const idx = m.palette.map((hex, k) => {
      const h = hex.toUpperCase();
      if (h === main || cells[k] === 0) return 0;
      let at = mine.get(h);
      if (at === undefined) {
        at = outColors.length;
        outColors.push({ color: h });
        outCounts.push(counts[i]! * Math.max(1, Math.round(cells[k]! / 256)));
        mine.set(h, at);
      }
      return at;
    });
    modelIndex.set(i, idx);
  }
  return { colors: outColors, counts: Uint32Array.from(outCounts), modelIndex, dominant };
}

/**
 * One 16x16x16 chunk of slot numbers (slicer-local layout, as the grid stores them) per block type with a model.
 * `bucketOfIndex` is the quantizer's map over the extended colours; `mainBucket` the block's effective slot (overrides included).
 */
export function buildModelTemplates(palette: PaletteEntry[], plan: ModelPlan, bucketOfIndex: Uint16Array, mainBucket: Uint16Array, o: MeshingOptions): Map<number, Uint16Array> {
  const out = new Map<number, Uint16Array>();
  const wall = minWallCells(o);
  for (const [i, idx] of plan.modelIndex) {
    const main = mainBucket[i] ?? 0;
    const m = palette[i]!.model;
    if (!m || main === 0) continue;
    const bucket = idx.map((at) => (at === 0 ? main : bucketOfIndex[at] || main));
    // MC-local layout x + 16*(y + 16*z): widening works along x and z, the horizontal axes, as for blocks
    const mc = new Uint16Array(CELLS);
    for (const b of m.boxes) {
      const v = bucket[b[6]]!;
      for (let z = b[2]; z < b[5]; z++)
        for (let y = b[1]; y < b[4]; y++) mc.fill(v, b[0] + 16 * (y + 16 * z), b[3] + 16 * (y + 16 * z));
    }
    if (wall > 1) {
      const never = () => true; // inside the block the array bounds are the only limit
      widen(mc, [0, 0, 0], [16, 16, 16], 0, wall, never);
      widen(mc, [0, 0, 0], [16, 16, 16], 2, wall, never);
    }
    const chunk = new Uint16Array(CELLS);
    for (let z = 0; z < 16; z++)
      for (let y = 0; y < 16; y++)
        for (let x = 0; x < 16; x++) chunk[x + (15 - z) * 16 + y * 256] = mc[x + 16 * (y + 16 * z)]!;
    out.set(i, chunk);
  }
  return out;
}

/** Slots (other than the block's own) that a model block's colours reach, with the colour in each, for the slot lists. */
export function modelBuckets(palette: PaletteEntry[], plan: ModelPlan, bucketOfIndex: Uint16Array, mainBucket: Uint16Array): Map<number, Array<[number, string]>> {
  const out = new Map<number, Array<[number, string]>>();
  for (const [i, idx] of plan.modelIndex) {
    const main = mainBucket[i] ?? 0;
    const seen = new Set<number>();
    const list: Array<[number, string]> = [];
    palette[i]!.model!.palette.forEach((hex, k) => {
      const b = idx[k]! === 0 ? 0 : bucketOfIndex[idx[k]!] || 0;
      if (b !== 0 && b !== main && !seen.has(b)) {
        seen.add(b);
        list.push([b, hex.toUpperCase()]);
      }
    });
    if (list.length > 0) out.set(i, list);
  }
  return out;
}
