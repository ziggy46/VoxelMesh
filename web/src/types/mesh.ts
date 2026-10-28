// Contract: docs/03_VOXEL_MESHING_ENGINE.md §0 and docs/06 §1
import type { SubVoxelBox, VoxelPayload } from "./voxelPayload";

/** Surface relief depth in sub-voxels (texels). */
export type ReliefDepth = 0 | 1 | 2 | 3;

export interface MeshingOptions {
  printerMode: "fdm" | "resin";
  scaleMmPerBlock: number; // default 4.0
  includeFluids: boolean; // default false
  includeFoliage: boolean; // default false
  /** Include blocks tagged "glass" (windows). Default true; undefined counts as true. */
  includeGlass?: boolean;
  /** Include blocks tagged "leaves". Default true; undefined counts as true. */
  includeLeaves?: boolean;
  /** Use each block's drawn shape and colours (`model`) instead of its hitbox where the build has them. Default true; undefined counts as true. */
  exactShapes?: boolean;
  /** Include captured entities (armor stands, paintings, mobs). Default true; undefined counts as true. */
  includeEntities?: boolean;
  /** Colour each face of blocks that carry `faces` (grass top vs side) with a thin skin of its own slot. Default true; undefined counts as true. */
  faceColors?: boolean;
  fillInteriorCavities: boolean; // default: true for fdm, false for resin
  fixNonManifold: boolean; // default true
  minNozzleWallMm: number; // default 0.8 (fdm), 0 (resin)
  /** Surface relief: carve up to this many sub-voxels, scaled by texture darkness, into full-cube faces. 0 = off (default). */
  reliefDepth?: ReliefDepth;
  /** Carve the light texels instead of the dark ones. */
  reliefInvert?: boolean;
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
