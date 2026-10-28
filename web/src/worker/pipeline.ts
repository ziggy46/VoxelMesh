// Pipeline orchestration (docs/00 §1, docs/05 §3): decode -> quantize -> grid -> relief -> faces -> entities -> fill -> repair -> mesh -> heal -> validate.
// Pure and synchronous so it runs in the worker, in Node tests and in perf measurements alike.
import { decodeVoxels } from "../payload/loader";
import type { QuantizationResult } from "../types/color";
import type { ColorBucketMesh, ManifoldReport, MeshingOptions } from "../types/mesh";
import type { VoxelPayload } from "../types/voxelPayload";
import { validateAll } from "../validate/manifold";
import { quantizePaletteToSlots } from "./colorQuantizer";
import { fillInteriorCavities } from "./meshingKernel/fill";
import { applyEntities, planEntityColors } from "./meshingKernel/entities";
import { applyFaceSkins, faceBuckets as planFaceBuckets, planFaceColors } from "./meshingKernel/faces";
import { isIncluded } from "./meshingKernel/filters";
import { applyRelief } from "./meshingKernel/relief";
import { buildSparseGrid } from "./meshingKernel/grid";
import { extractMeshes } from "./meshingKernel/extract";
import { repairNonManifold } from "./meshingKernel/repair";
import { healTJunctions } from "./meshingKernel/tjunction";

export type Stage = "decode" | "quantize" | "grid" | "relief" | "faces" | "entities" | "fill" | "repair" | "mesh" | "heal" | "validate";
export const STAGES: readonly Stage[] = ["decode", "quantize", "grid", "relief", "faces", "entities", "fill", "repair", "mesh", "heal", "validate"];

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
  /** Depth actually applied (lower than requested when the budget forced it), or null when relief is off or skipped. */
  reliefUsedDepth: number | null;
  /** Palette index -> bucket for each face that keeps its own colour skin (0 = the block's own colour). Empty when face colours are off. */
  faceBuckets: Map<number, Uint16Array>;
  /** Cells recoloured by face skins, or null when there are none or they were skipped. */
  faceCells: number | null;
  /** Set when face skins were wanted but the build is too large for the recolour budget. */
  facesSkipped: { wanted: number; limit: number } | null;
  /** Cells per filament slot that captured entities were stamped into (empty when there are none or they were skipped). */
  entityBuckets: Map<number, number>;
  /** Cells stamped for entities, or null when there are none or they were skipped. */
  entityCells: number | null;
  /** Set when entities were wanted but exceed the stamping budget. */
  entitiesSkipped: { wanted: number; limit: number } | null;
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
      if (!isIncluded(e, o)) c[i] = 0;
    });
    return c;
  });

  // Face colours join the clustering as extra points; the map and buckets handed back cover the real palette only.
  const facePlan = planFaceColors(p.palette, counts, o);
  // Entity colours join as further extras after the face colours.
  const entityPlan = planEntityColors(facePlan.colors, facePlan.counts, p.entities, o);
  const raw0 = step("quantize", () => quantizePaletteToSlots(entityPlan.colors, entityPlan.counts, opts.maxSlots));
  const n = p.palette.length;
  const quantization: QuantizationResult = {
    buckets: raw0.buckets.map((b) => ({ ...b, paletteIndices: [...new Set(b.paletteIndices.map((i) => (i < n ? i : ownerOf(facePlan.faceIndex, i))))].filter((i) => i < n).sort((a, c) => a - c) })),
    paletteToBucketMap: raw0.paletteToBucketMap.slice(0, n),
  };
  const paletteToBucket = Uint16Array.from(quantization.paletteToBucketMap);
  for (const [paletteIndex, bucket] of opts.overrides ?? []) {
    if (paletteIndex > 0 && paletteIndex < paletteToBucket.length) paletteToBucket[paletteIndex] = bucket;
  }

  const grid = step("grid", () => buildSparseGrid(p, o, paletteToBucket));
  // Relief carves surface texels before fill and repair, so both still see (and guarantee) the final geometry.
  const relief = o.reliefDepth ? step("relief", () => applyRelief(grid, p, paletteToBucket, o)) : null;
  // Face skins recolour what is left of the surface after relief, and before fill and repair so both see the final colours.
  const buckets = planFaceBuckets(facePlan, raw0.paletteToBucketMap, paletteToBucket);
  const skins = buckets.size > 0 ? step("faces", () => applyFaceSkins(grid, p, buckets, o)) : null;
  // Entities go in last among the geometry steps, into air only, so relief pits and skins are decided on the blocks alone.
  const ents = entityPlan.indexOf.size > 0
    ? step("entities", () => applyEntities(grid, p, (hex) => raw0.paletteToBucketMap[entityPlan.indexOf.get(hex) ?? -1] ?? 0, o))
    : null;
  if (o.fillInteriorCavities) step("fill", () => fillInteriorCavities(grid));
  const repair = o.fixNonManifold ? step("repair", () => repairNonManifold(grid)) : null;
  const raw = step("mesh", () => extractMeshes(grid));
  const meshes = step("heal", () => raw.map(healTJunctions));
  const reports = step("validate", () => validateAll(meshes));
  return { quantization, paletteToBucket, meshes, reports, repair, reliefCarved: relief && !relief.skipped ? relief.removed : null, reliefSkipped: relief?.skipped ?? null,
    reliefUsedDepth: relief && !relief.skipped ? relief.usedDepth : null,
    faceBuckets: skins?.skipped ? new Map() : buckets, faceCells: skins && !skins.skipped ? skins.recolored : null, facesSkipped: skins?.skipped ?? null,
    entityBuckets: ents?.byBucket ?? new Map(), entityCells: ents && !ents.skipped ? ents.stamped : null, entitiesSkipped: ents?.skipped ?? null, timings };
}

/** The palette index a face-colour extra belongs to (extras are numbered after the real palette). */
function ownerOf(faceIndex: Map<number, number[]>, extra: number): number {
  for (const [owner, idx] of faceIndex) if (idx.includes(extra)) return owner;
  return extra;
}
