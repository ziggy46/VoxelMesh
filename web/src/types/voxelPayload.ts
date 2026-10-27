// Contract: docs/01_PAYLOAD_SPEC.md §2

export type SubVoxelBox = [
  minX: number, minY: number, minZ: number,
  maxX: number, maxY: number, maxZ: number,
]; // ints 0..16, max > min

export type BlockCategory = "solid" | "partial" | "thin" | "foliage" | "fluid" | "air";

export interface PaletteEntry {
  id: string; // "minecraft:oak_stairs[facing=north,half=bottom]"
  name: string; // "Oak Stairs"
  color: string | null; // "#RRGGBB", null for air
  category: BlockCategory;
  boxes: SubVoxelBox[]; // [] for air
}

export interface VoxelPayload {
  version: 1;
  metadata: {
    title: string;
    author?: string;
    mcVersion: string;
    exportedAt: string;
    origin: [number, number, number];
  };
  dimensions: [number, number, number]; // blocks [sizeX, sizeY, sizeZ]
  palette: PaletteEntry[]; // index 0 MUST be minecraft:air
  /** Little-endian Uint16Array, length sizeX*sizeY*sizeZ, index = x + z*sizeX + y*(sizeX*sizeZ) */
  voxelsBase64: string;
  /** Optional CRC32 (hex) of the decoded voxel bytes, verified on load if present */
  voxelsCrc32?: string;
}

/** Hard limits from docs/01 §3. */
export const MAX_PALETTE_ENTRIES = 65534;
export const WARN_BLOCKS = 64 * 64 * 64; // warn above 64^3 blocks
export const MAX_BLOCKS = 128 * 128 * 128; // hard-gate above 128^3 blocks
