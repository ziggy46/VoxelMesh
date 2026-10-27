// Contract: docs/03_VOXEL_MESHING_ENGINE.md §0 and docs/06 §1
import type { SubVoxelBox, VoxelPayload } from "./voxelPayload";

export interface MeshingOptions {
  printerMode: "fdm" | "resin";
  scaleMmPerBlock: number; // default 4.0
  includeFluids: boolean; // default false
  includeFoliage: boolean; // default false
  fillInteriorCavities: boolean; // default: true for fdm, false for resin
  fixNonManifold: boolean; // default true
  minNozzleWallMm: number; // default 0.8 (fdm), 0 (resin)
}

/** Block-chunked sparse grid in SLICER space. Block index = bx + by*Bx + bz*Bx*By. */
export interface SparseGrid {
  blocks: [number, number, number]; // Bx, By, Bz (slicer-space block dims)
  cells: Array<number | Uint16Array>; // number = whole block is that bucket (0 = air)
  // Uint16Array(4096): idx = lx + ly*16 + lz*256
}

export interface ColorBucketMesh {
  bucketId: number;
  positions: Int32Array; // integer sub-voxel lattice coordinates, xyz triples
  indices: Uint32Array; // CCW outward triangles
}

export interface ManifoldReport {
  bucketId: number;
  triangles: number;
  openEdges: number; // directed edges with no opposite
  nonManifoldEdges: number; // directed edges used more than once / opposites used more than once
  degenerateTriangles: number; // zero area
  signedVolume: number; // lattice^3; must be > 0
  components: number;
  ok: boolean;
}

export const DEFAULT_FDM_OPTIONS: MeshingOptions = {
  printerMode: "fdm",
  scaleMmPerBlock: 4.0,
  includeFluids: false,
  includeFoliage: false,
  fillInteriorCavities: true,
  fixNonManifold: true,
  minNozzleWallMm: 0.8,
};

export const DEFAULT_RESIN_OPTIONS: MeshingOptions = {
  printerMode: "resin",
  scaleMmPerBlock: 4.0,
  includeFluids: false,
  includeFoliage: false,
  fillInteriorCavities: false,
  fixNonManifold: true,
  minNozzleWallMm: 0,
};

/** Cells per block edge and per block. */
export const SUB = 16;
export const CHUNK_CELLS = 4096;

export type { SubVoxelBox, VoxelPayload };
