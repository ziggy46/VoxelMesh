// Pure UI helpers: option mapping, bed sizes, size/mass estimates, slot membership. No React, no DOM.
import type { FilamentSlotBucket } from "../types/color";
import type { ManifoldReport, MeshingOptions, ReliefDepth } from "../types/mesh";
import type { PaletteEntry, VoxelPayload } from "../types/voxelPayload";
import { texelSourceOf } from "../worker/meshingKernel/faces";

export interface UiOptions {
  scaleMmPerBlock: number;
  /** Parts thinner than this are thickened to it (X and Z only). 0 keeps every detail exactly as built. */
  minWallMm: number;
  includeFluids: boolean;
  includeFoliage: boolean;
  includeGlass: boolean;
  includeLeaves: boolean;
  /** Use each block's drawn shape and colours instead of its hitbox. */
  exactShapes: boolean;
  /** Include captured entities (armor stands, paintings, mobs). */
  includeEntities: boolean;
  /** Colour each face of blocks like grass and logs with its own filament slot. */
  faceColors: boolean;
  /** Fill sealed hollow cavities solid. */
  solidifyInteriors: boolean;
  fixNonManifold: boolean;
  /** Surface relief depth in sub-voxels (0 = off) and whether light texels are carved instead of dark. */
  reliefDepth: ReliefDepth;
  reliefInvert: boolean;
  /** Cells per block edge as a multiple of 16 (1, 2 or 4): finer detail makes texture relief a fraction of a texel deep. Lowered automatically for big builds. */
  detail: 1 | 2 | 4;
  /** Build plate: an index into BED_PRESETS, or a custom size. */
  bedPreset: BedPreset;
  customBed: Bed;
}

/** 256 x 256 mm, the middle of the common FDM sizes. */
export const DEFAULT_BED_PRESET: BedPreset = 4;

/**
 * Safe for any printer: features thinner than a 0.4 mm nozzle are silently dropped by FDM slicers, which is the worse
 * failure. Fine-detail resin printing lowers this (about 0.2 to 0.3 mm) or sets it to 0.
 */
export const DEFAULT_MIN_WALL_MM = 0.8;
export const MIN_WALL_MAX_MM = 1.2;

/** The one relief depth the UI offers (in sub-voxels / texels). Deeper depths exist in the kernel but are not exposed. */
export const RELIEF_DEPTH: ReliefDepth = 1;

export const DEFAULT_UI_OPTIONS: UiOptions = {
  scaleMmPerBlock: 4.0,
  minWallMm: DEFAULT_MIN_WALL_MM,
  includeFluids: false,
  includeFoliage: false,
  includeGlass: true,
  includeLeaves: true,
  exactShapes: true,
  includeEntities: true,
  faceColors: true,
  solidifyInteriors: true,
  fixNonManifold: true,
  reliefDepth: RELIEF_DEPTH, // on by default; the depth is fixed, only on/off and invert are user choices
  reliefInvert: false,
  detail: 4,
  bedPreset: DEFAULT_BED_PRESET,
  customBed: { x: 250, y: 250 },
};

/** The detail steps the UI offers, with their labels. */
export const DETAIL_STEPS = [
  { value: 1, label: "Standard" },
  { value: 2, label: "Fine" },
  { value: 4, label: "Ultra" },
] as const;

export const SCALE_MIN = 1.0;
export const SCALE_MAX = 15.0;
export const SLOT_COUNTS = [1, 4, 8, 16] as const;
export const PLA_G_PER_CM3 = 1.24;
export const NOZZLE_MM = 0.4;

/** Width and depth of one relief texel in mm (one sub-voxel). */
export const texelMm = (scaleMmPerBlock: number): number => scaleMmPerBlock / 16;

/** Does any palette entry carry this tag ("glass" or "leaves")? Builds from an older mod have none. */
export const hasTag = (p: VoxelPayload | null, tag: string): boolean => !!p && p.palette.some((e) => e.tags?.includes(tag));

/** Does any palette entry carry its drawn shape (`model`)? Builds from an older mod do not. */
export const hasModelData = (p: VoxelPayload | null): boolean => !!p && p.palette.some((e) => !!e.model);

/** Does the build carry captured entities? Builds from an older mod do not. */
export const hasEntities = (p: VoxelPayload | null): boolean => !!p && (p.entities?.length ?? 0) > 0;

/** Does any palette entry carry face colours (grass top vs side)? Builds from an older mod do not. */
export const hasFaceData = (p: VoxelPayload | null): boolean => !!p && p.palette.some((e) => !!e.texture || (!!e.faces && e.faces.length === 6));

/** Does any palette entry carry relief data? Builds from an older mod do not. */
export const hasReliefData = (p: VoxelPayload | null): boolean => !!p && p.palette.some((e) => !!e.relief);

/**
 * Thickening and cavity filling are independent options (CLAUDE.md invariant 3): a minimum wall of 0 keeps native detail, and
 * filling only happens when asked. `printerMode` is only a label the engine carries, derived from whether thickening is on.
 */
export function toMeshingOptions(u: UiOptions): MeshingOptions {
  return {
    printerMode: u.minWallMm > 0 ? "fdm" : "resin",
    scaleMmPerBlock: u.scaleMmPerBlock,
    includeFluids: u.includeFluids,
    includeFoliage: u.includeFoliage,
    includeGlass: u.includeGlass,
    includeLeaves: u.includeLeaves,
    exactShapes: u.exactShapes,
    includeEntities: u.includeEntities,
    faceColors: u.faceColors,
    fillInteriorCavities: u.solidifyInteriors,
    fixNonManifold: u.fixNonManifold,
    minNozzleWallMm: u.minWallMm,
    reliefDepth: u.reliefDepth,
    reliefInvert: u.reliefInvert,
    detail: u.detail,
  };
}

/** Does changing from `a` to `b` change the lattice geometry (so the worker must re-run)? Scale only matters while thickening is on. */
export function needsRerun(a: UiOptions, b: UiOptions): boolean {
  const ma = toMeshingOptions(a), mb = toMeshingOptions(b);
  // Scale sets the dilation and the face-skin thickness (about 0.8 mm of material), so it matters while either is on.
  const scaleMatters = ma.minNozzleWallMm > 0 || mb.minNozzleWallMm > 0 || ma.faceColors !== false || mb.faceColors !== false;
  return (
    ma.minNozzleWallMm !== mb.minNozzleWallMm ||
    ma.includeFluids !== mb.includeFluids ||
    ma.includeFoliage !== mb.includeFoliage ||
    ma.includeGlass !== mb.includeGlass ||
    ma.includeLeaves !== mb.includeLeaves ||
    ma.faceColors !== mb.faceColors ||
    ma.includeEntities !== mb.includeEntities ||
    ma.exactShapes !== mb.exactShapes ||
    ma.fillInteriorCavities !== mb.fillInteriorCavities ||
    ma.fixNonManifold !== mb.fixNonManifold ||
    ma.reliefDepth !== mb.reliefDepth ||
    ma.detail !== mb.detail ||
    (mb.reliefDepth !== 0 && ma.reliefInvert !== mb.reliefInvert) ||
    (scaleMatters && ma.scaleMmPerBlock !== mb.scaleMmPerBlock)
  );
}

/** Colours the game-look preview may use: enough that every texture keeps its own shades. */
export const GAME_LOOK_SLOTS = 256;

/**
 * Options for the game-look preview: what the player saw, not what a printer needs. No relief pits (the game's textures are
 * flat), no minimum-wall thickening, exact shapes and texel colours always on; the filters (glass, leaves, fluids, foliage,
 * entities) are the user's.
 */
export function toGameLookOptions(u: UiOptions): MeshingOptions {
  return { ...toMeshingOptions(u), exactShapes: true, faceColors: true, reliefDepth: 0, minNozzleWallMm: 0, printerMode: "resin", fillInteriorCavities: false, detail: 1 };
}

/** Build plate footprint in mm. */
export interface Bed { x: number; y: number }
export type BedPreset = number | "custom";

/** Common plate sizes, small to large: resin vats first, then FDM beds. Anything else is a custom size. */
export const BED_PRESETS: readonly Bed[] = [
  { x: 130, y: 80 }, { x: 192, y: 120 }, { x: 218, y: 123 },
  { x: 220, y: 220 }, { x: 256, y: 256 }, { x: 350, y: 350 },
];
export const BED_MIN_MM = 20;
export const BED_MAX_MM = 1000;

/** Round to whole millimetres inside the allowed range; non-numbers fall back to the minimum. */
export const clampBedMm = (v: number): number => (Number.isFinite(v) ? Math.min(BED_MAX_MM, Math.max(BED_MIN_MM, Math.round(v))) : BED_MIN_MM);

export function bedFor(o: Pick<UiOptions, "bedPreset" | "customBed">): Bed {
  if (o.bedPreset === "custom") return { x: clampBedMm(o.customBed.x), y: clampBedMm(o.customBed.y) };
  return BED_PRESETS[o.bedPreset] ?? BED_PRESETS[DEFAULT_BED_PRESET as number]!;
}

/** Thin parts are thickened to this many sub-voxels (one sub-voxel is scale/16 mm); mirrors the engine's rule. */
export function minSubVoxels(minWallMm: number, scaleMmPerBlock: number): number {
  if (!(minWallMm > 0) || !(scaleMmPerBlock > 0)) return 0;
  return Math.min(16, Math.ceil((minWallMm / scaleMmPerBlock) * 16 - 1e-9));
}

/** Relief texels finer than a 0.4 mm nozzle barely show; only worth saying when thickening says "FDM-like" (>= 0.6 mm wall). */
export const reliefTooFine = (texel: number, minWallMm: number): boolean => minWallMm >= 0.6 && texel < NOZZLE_MM;

export const bedLabel = (b: Bed): string => `${b.x} × ${b.y} mm`;

/** Slicer-space bounding box in mm: X = sizeX, Y = sizeZ, Z = sizeY (docs/01 §1). */
export function modelSizeMm(p: VoxelPayload, scaleMmPerBlock: number): [number, number, number] {
  const [sx, sy, sz] = p.dimensions;
  return [sx * scaleMmPerBlock, sz * scaleMmPerBlock, sy * scaleMmPerBlock];
}

export const fitsBed = (size: [number, number, number], bed: Bed) => size[0] <= bed.x && size[1] <= bed.y;

export const fmtSize = (s: [number, number, number]) => s.map((v) => v.toFixed(1)).join(" × ") + " mm";

export function totalIssues(reports: ManifoldReport[]): number {
  return reports.reduce(
    (n, r) => n + r.openEdges + r.nonManifoldEdges + r.degenerateTriangles + (r.signedVolume > 0 ? 0 : 1),
    0,
  );
}

/** Solid-volume estimate. Lattice volume is in sub-voxel^3; one sub-voxel is scale/16 mm. */
export function estimate(reports: ManifoldReport[], scaleMmPerBlock: number): { volumeCm3: number; grams: number } {
  const lattice = reports.reduce((s, r) => s + Math.max(0, r.signedVolume), 0);
  const volumeCm3 = (lattice * (scaleMmPerBlock / 16) ** 3) / 1000;
  return { volumeCm3, grams: volumeCm3 * PLA_G_PER_CM3 };
}

export interface SlotMember {
  paletteIndex: number; name: string; color: string; count: number;
  /** True for a block type that only reaches this slot through some of its faces (grass tops); it cannot be moved on its own. */
  skin?: boolean;
}

/** Group palette entries by the bucket they currently map to (the effective map, overrides included). */
export function slotMembers(
  paletteToBucket: Uint16Array, palette: PaletteEntry[], counts: Uint32Array, faceBuckets?: ReadonlyMap<number, Uint16Array>, entityBuckets?: ReadonlyMap<number, number>, modelBuckets?: ReadonlyMap<number, ReadonlyArray<readonly [number, string]>>,
): Map<number, SlotMember[]> {
  const out = new Map<number, SlotMember[]>();
  for (let i = 1; i < palette.length; i++) {
    const b = paletteToBucket[i] ?? 0;
    if (b === 0) continue;
    const list = out.get(b) ?? [];
    list.push({ paletteIndex: i, name: palette[i]!.name, color: palette[i]!.color ?? "#808080", count: counts[i] ?? 0 });
    out.set(b, list);
  }
  // Blocks whose faces carry other colours also appear in those slots, once per slot.
  for (const [i, fb] of faceBuckets ?? []) {
    const src = palette[i] ? texelSourceOf(palette[i]!) : null;
    if (!src) continue;
    const seen = new Set<number>();
    for (let t = 0; t < fb.length; t++) {
      const b = fb[t] ?? 0;
      const hex = src.colors[src.index[t] ?? 0];
      if (b === 0 || seen.has(b) || !hex) continue;
      seen.add(b);
      const list = out.get(b) ?? [];
      list.push({ paletteIndex: i, name: `${palette[i]!.name} (surface)`, color: hex, count: counts[i] ?? 0, skin: true });
      out.set(b, list);
    }
  }
  // Blocks drawn in several colours also appear in each other slot their colours reach.
  for (const [i, list] of modelBuckets ?? [])
    for (const [b, hex] of list) {
      const l = out.get(b) ?? [];
      l.push({ paletteIndex: i, name: `${palette[i]!.name} (colours)`, color: hex, count: counts[i] ?? 0, skin: true });
      out.set(b, l);
    }
  // Captured entities appear as one pseudo block type in each slot they use.
  for (const [b, cells] of entityBuckets ?? []) {
    const list = out.get(b) ?? [];
    list.push({ paletteIndex: -1, name: "Entities", color: "#9AA3AF", count: Math.max(1, Math.round(cells / 256)), skin: true });
    out.set(b, list);
  }
  for (const l of out.values()) l.sort((a, b) => b.count - a.count || a.paletteIndex - b.paletteIndex);
  return out;
}

/** The bucket's colour: a user override if set, else the quantizer's. */
export const slotHex = (b: FilamentSlotBucket, overrides: Readonly<Record<number, string>>): string =>
  (overrides[b.bucketId] ?? b.hexColor).toUpperCase();

/** Rename "Slot 2 – Stone Gray (#7A797A)" so the trailing hex matches the colour actually exported. */
export const slotName = (b: FilamentSlotBucket, hex: string): string => b.name.replace(/\(#[0-9A-Fa-f]{6}\)\s*$/, `(${hex.toUpperCase()})`);

export const safeFileName = (title: string): string => {
  const s = title.replace(/[^A-Za-z0-9._ -]+/g, "").trim().replace(/\s+/g, "_");
  return s.length > 0 ? s.slice(0, 80) : "voxelmesh";
};

/** Decode the `#data=<base64url gzip>` URL-fragment transport (docs/00 §3, tiny builds). */
export function decodeFragmentData(hash: string): Uint8Array | null {
  const m = /^#data=([A-Za-z0-9_-]+)$/.exec(hash);
  if (!m) return null;
  const b64 = m[1]!.replace(/-/g, "+").replace(/_/g, "/");
  try {
    const bin = atob(b64 + "=".repeat((4 - (b64.length % 4)) % 4));
    return Uint8Array.from(bin, (c) => c.charCodeAt(0));
  } catch {
    return null;
  }
}
