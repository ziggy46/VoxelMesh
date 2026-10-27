// Pipeline composition (docs/03 §0). Lead-written glue: the kernels it calls are the D1/D2 modules.
import type { ColorBucketMesh, MeshingOptions } from "../../types/mesh";
import type { VoxelPayload } from "../../types/voxelPayload";
import { buildSparseGrid } from "./grid";
import { fillInteriorCavities } from "./fill";
import { repairNonManifold } from "./repair";
import { extractMeshes } from "./extract";
import { healTJunctions } from "./tjunction";

export { buildSparseGrid } from "./grid";
export { dilateThinFeatures } from "./dilate";
export { fillInteriorCavities } from "./fill";
export { repairNonManifold } from "./repair";
export { extractMeshes } from "./extract";
export { healTJunctions } from "./tjunction";

export function runMeshingPipeline(
  p: VoxelPayload,
  o: MeshingOptions,
  paletteToBucket: Uint16Array,
): ColorBucketMesh[] {
  const grid = buildSparseGrid(p, o, paletteToBucket);
  if (o.fillInteriorCavities) fillInteriorCavities(grid);
  if (o.fixNonManifold) repairNonManifold(grid);
  return extractMeshes(grid).map(healTJunctions);
}
