// Pipeline orchestration (docs/00 §1, docs/05 §3): decode -> quantize -> grid -> fill -> repair -> mesh -> heal -> validate.
// Pure and synchronous so it runs in the worker, in Node tests and in perf measurements alike.
import { decodeVoxels } from "../payload/loader";
import type { QuantizationResult } from "../types/color";
import type { ColorBucketMesh, ManifoldReport, MeshingOptions } from "../types/mesh";
import type { VoxelPayload } from "../types/voxelPayload";
import { validateAll } from "../validate/manifold";
import { quantizePaletteToSlots } from "./colorQuantizer";
import { fillInteriorCavities } from "./meshingKernel/fill";
import { applyRelief } from "./meshingKernel/relief";
import { buildSparseGrid } from "./meshingKernel/grid";
import { extractMeshes } from "./meshingKernel/extract";
import { repairNonManifold } from "./meshingKernel/repair";
import { healTJunctions } from "./meshingKernel/tjunction";

export type Stage = "decode" | "quantize" | "grid" | "relief" | "fill" | "repair" | "mesh" | "heal" | "validate";
export const STAGES: readonly Stage[] = ["decode", "quantize", "grid", "relief", "fill", "repair", "mesh", "heal", "validate"];

export interface PipelineResult {
  quantization: QuantizationResult;
  /** Palette index -> bucket id actually used (the quantizer's map unless overridden). */
  paletteToBucket: Uint16Array;
  meshes: ColorBucketMesh[];
  reports: ManifoldReport[];
  repair: { bridgesAdded: number; recolored: number } | null;
  /** Cells carved by surface relief, or null when relief is off or was skipped. */
  reliefCarved: number | null;
  /** Set when relief was requested but the build is too large for the carve budget (docs: relief.ts). */
  reliefSkipped: { wanted: number; limit: number } | null;
  /** Wall-clock milliseconds per stage. */
  timings: Record<Stage, number>;
}

export interface PipelineOptions {
  /** Filament slots: 1 (mono), 4, 8 or 16. */
  maxSlots: number;
  /** Manual block -> slot reassignments (palette index -> bucket id), applied after quantization. */
  overrides?: ReadonlyMap<number, number>;
  onProgress?: (stage: Stage, fraction: number) => void;
}

export function runPipeline(p: VoxelPayload, o: MeshingOptions, opts: PipelineOptions): PipelineResult {
  const timings = Object.fromEntries(STAGES.map((s) => [s, 0])) as Record<Stage, number>;
  const step = <T>(stage: Stage, fn: () => T): T => {
    opts.onProgress?.(stage, 0);
    const t0 = performance.now();
    const out = fn();
    timings[stage] = performance.now() - t0;
    opts.onProgress?.(stage, 1);
    return out;
  };

  // Voxel counts weight the colour clustering; entries the filters drop must not claim a slot.
  const counts = step("decode", () => {
    const voxels = decodeVoxels(p.voxelsBase64);
    const c = new Uint32Array(p.palette.length);
    for (let i = 0; i < voxels.length; i++) c[voxels[i]!]!++;
    p.palette.forEach((e, i) => {
      if ((e.category === "fluid" && !o.includeFluids) || (e.category === "foliage" && !o.includeFoliage)) c[i] = 0;
    });
    return c;
  });

  const quantization = step("quantize", () => quantizePaletteToSlots(p.palette, counts, opts.maxSlots));
  const paletteToBucket = Uint16Array.from(quantization.paletteToBucketMap);
  for (const [paletteIndex, bucket] of opts.overrides ?? []) {
    if (paletteIndex > 0 && paletteIndex < paletteToBucket.length) paletteToBucket[paletteIndex] = bucket;
  }

  const grid = step("grid", () => buildSparseGrid(p, o, paletteToBucket));
  // Relief carves surface texels before fill and repair, so both still see (and guarantee) the final geometry.
  const relief = o.reliefDepth ? step("relief", () => applyRelief(grid, p, paletteToBucket, o)) : null;
  if (o.fillInteriorCavities) step("fill", () => fillInteriorCavities(grid));
  const repair = o.fixNonManifold ? step("repair", () => repairNonManifold(grid)) : null;
  const raw = step("mesh", () => extractMeshes(grid));
  const meshes = step("heal", () => raw.map(healTJunctions));
  const reports = step("validate", () => validateAll(meshes));
  return { quantization, paletteToBucket, meshes, reports, repair, reliefCarved: relief && !relief.skipped ? relief.removed : null, reliefSkipped: relief?.skipped ?? null, timings };
}
