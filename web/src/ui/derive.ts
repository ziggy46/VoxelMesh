// Pure UI helpers: option mapping, bed sizes, size/mass estimates, slot membership. No React, no DOM.
import type { FilamentSlotBucket } from "../types/color";
import { DEFAULT_FDM_OPTIONS, type ManifoldReport, type MeshingOptions, type ReliefDepth } from "../types/mesh";
import type { PaletteEntry, VoxelPayload } from "../types/voxelPayload";

export type PrinterMode = "fdm" | "resin";

export interface UiOptions {
  printerMode: PrinterMode;
  scaleMmPerBlock: number;
  includeFluids: boolean;
  includeFoliage: boolean;
  solidifyInteriors: boolean;
  fixNonManifold: boolean;
  /** Surface relief depth in sub-voxels (0 = off) and whether light texels are carved instead of dark. */
  reliefDepth: ReliefDepth;
  reliefInvert: boolean;
}

export const DEFAULT_UI_OPTIONS: UiOptions = {
  printerMode: "fdm",
  scaleMmPerBlock: 4.0,
  includeFluids: false,
  includeFoliage: false,
  solidifyInteriors: true,
  fixNonManifold: true,
  reliefDepth: 0,
  reliefInvert: false,
};

export const SCALE_MIN = 1.0;
export const SCALE_MAX = 15.0;
export const SLOT_COUNTS = [1, 4, 8, 16] as const;
export const PLA_G_PER_CM3 = 1.24;
export const NOZZLE_MM = 0.4;

/** Width and depth of one relief texel in mm (one sub-voxel). */
export const texelMm = (scaleMmPerBlock: number): number => scaleMmPerBlock / 16;

/** Does any palette entry carry relief data? Builds from an older mod do not. */
export const hasReliefData = (p: VoxelPayload | null): boolean => !!p && p.palette.some((e) => !!e.relief);

/** Resin never solidifies interiors and never dilates (CLAUDE.md invariant 3), whatever the toggle says. */
export function toMeshingOptions(u: UiOptions): MeshingOptions {
  const fdm = u.printerMode === "fdm";
  return {
    printerMode: u.printerMode,
    scaleMmPerBlock: u.scaleMmPerBlock,
    includeFluids: u.includeFluids,
    includeFoliage: u.includeFoliage,
    fillInteriorCavities: fdm && u.solidifyInteriors,
    fixNonManifold: u.fixNonManifold,
    minNozzleWallMm: fdm ? DEFAULT_FDM_OPTIONS.minNozzleWallMm : 0,
    reliefDepth: u.reliefDepth,
    reliefInvert: u.reliefInvert,
  };
}

/** Does changing from `a` to `b` change the lattice geometry (so the worker must re-run)? Scale only matters in FDM. */
export function needsRerun(a: UiOptions, b: UiOptions): boolean {
  const ma = toMeshingOptions(a), mb = toMeshingOptions(b);
  const scaleMatters = ma.minNozzleWallMm > 0 || mb.minNozzleWallMm > 0;
  return (
    ma.printerMode !== mb.printerMode ||
    ma.includeFluids !== mb.includeFluids ||
    ma.includeFoliage !== mb.includeFoliage ||
    ma.fillInteriorCavities !== mb.fillInteriorCavities ||
    ma.fixNonManifold !== mb.fixNonManifold ||
    ma.reliefDepth !== mb.reliefDepth ||
    (mb.reliefDepth !== 0 && ma.reliefInvert !== mb.reliefInvert) ||
    (scaleMatters && ma.scaleMmPerBlock !== mb.scaleMmPerBlock)
  );
}

export interface Bed { name: string; x: number; y: number }
export const BEDS: Record<PrinterMode, Bed> = {
  fdm: { name: "Bambu 256 × 256 mm", x: 256, y: 256 },
  resin: { name: "MSLA vat 220 × 120 mm", x: 220, y: 120 },
};

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

export interface SlotMember { paletteIndex: number; name: string; color: string; count: number }

/** Group palette entries by the bucket they currently map to (the effective map, overrides included). */
export function slotMembers(
  paletteToBucket: Uint16Array, palette: PaletteEntry[], counts: Uint32Array,
): Map<number, SlotMember[]> {
  const out = new Map<number, SlotMember[]>();
  for (let i = 1; i < palette.length; i++) {
    const b = paletteToBucket[i] ?? 0;
    if (b === 0) continue;
    const list = out.get(b) ?? [];
    list.push({ paletteIndex: i, name: palette[i]!.name, color: palette[i]!.color ?? "#808080", count: counts[i] ?? 0 });
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
