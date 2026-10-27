// Contract: docs/04_COLOR_AND_3MF_EXPORT.md §1-§2
import type { ColorBucketMesh } from "./mesh";

export interface PaletteColorInput {
  paletteIndex: number;
  hex: string;
} // air excluded by caller or by index 0

export interface FilamentSlotBucket {
  bucketId: number; // 1..K
  name: string; // "Slot 1 – Stone Gray (#7A797A)"
  hexColor: string; // weighted-mean centroid, converted back to sRGB
  paletteIndices: number[];
  voxelCount: number;
}

export interface QuantizationResult {
  buckets: FilamentSlotBucket[];
  paletteToBucketMap: Uint16Array; // index = paletteIndex; 0 for air / unmapped
}

export interface ExportBucket {
  bucketId: number;
  name: string;
  hexColor: string;
  mesh: ColorBucketMesh;
}
