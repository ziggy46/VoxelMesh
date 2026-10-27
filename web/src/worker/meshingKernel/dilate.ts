// docs/03 §2: FDM minimum-feature dilation.
import type { MeshingOptions } from "../../types/mesh";
import type { SubVoxelBox } from "../../types/voxelPayload";

const BLOCK = 16;

/**
 * Widen [lo, hi] to at least `minSub` about its center (extra sub-voxel of an odd
 * deficit goes to the max side), clamped to [0, 16]; any clamped remainder is
 * shifted onto the opposite side. Always contains the original interval.
 */
function widenAxis(lo: number, hi: number, minSub: number): [number, number] {
  const width = hi - lo;
  if (width >= minSub) return [lo, hi];
  const deficit = minSub - width;
  let nlo = lo - Math.floor(deficit / 2);
  let nhi = hi + Math.ceil(deficit / 2);
  if (nlo < 0) {
    nhi += -nlo;
    nlo = 0;
  }
  if (nhi > BLOCK) {
    nlo -= nhi - BLOCK;
    nhi = BLOCK;
  }
  if (nlo < 0) nlo = 0;
  return [nlo, nhi];
}

export function dilateThinFeatures(boxes: SubVoxelBox[], o: MeshingOptions): SubVoxelBox[] {
  const copies = (): SubVoxelBox[] => boxes.map((b): SubVoxelBox => [b[0], b[1], b[2], b[3], b[4], b[5]]);

  if (!(o.minNozzleWallMm > 0) || !(o.scaleMmPerBlock > 0)) return copies();

  const raw = (o.minNozzleWallMm / o.scaleMmPerBlock) * BLOCK;
  const minSub = Math.min(BLOCK, Math.ceil(raw - 1e-9));
  if (minSub <= 0) return copies();

  return boxes.map((b): SubVoxelBox => {
    const [x0, x1] = widenAxis(b[0], b[3], minSub);
    const [z0, z1] = widenAxis(b[2], b[5], minSub);
    return [x0, b[1], z0, x1, b[4], z1];
  });
}
