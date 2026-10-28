// docs/03 §0-§2: sparse sub-voxel grid in slicer space.
import { decodeVoxels } from "../../payload/loader";
import type { MeshingOptions, SparseGrid } from "../../types/mesh";
import { CHUNK_CELLS, SUB } from "../../types/mesh";
import type { SubVoxelBox, VoxelPayload } from "../../types/voxelPayload";
import { dilateThinFeatures } from "./dilate";
import { isIncluded } from "./filters";

interface Prepared {
  bucket: number;
  /** Boxes already in slicer-local chunk coordinates, half-open [x0,x1) x [y0,y1) x [z0,z1). */
  boxes: SubVoxelBox[];
  /** True when one box covers the whole block, so the chunk is stored as a number. */
  full: boolean;
}

/**
 * Build the block-chunked grid. MC block (x,y,z) lands at slicer block (x, sizeZ-1-z, y); MC-local box
 * [minX,minY,minZ,maxX,maxY,maxZ) fills slicer-local x[minX,maxX) y[16-maxZ,16-minZ) z[minY,maxY) (docs/01 §1).
 */
export function buildSparseGrid(p: VoxelPayload, o: MeshingOptions, paletteToBucket: Uint16Array): SparseGrid {
  const [sx, sy, sz] = p.dimensions;
  const Bx = sx, By = sz, Bz = sy;
  const cells: Array<number | Uint16Array> = new Array<number | Uint16Array>(Bx * By * Bz).fill(0);

  const prepared: Array<Prepared | null> = p.palette.map((e, i) => {
    const bucket = paletteToBucket[i] ?? 0;
    if (i === 0 || bucket === 0 || e.category === "air" || e.boxes.length === 0) return null;
    if (!isIncluded(e, o)) return null;
    const boxes = dilateThinFeatures(e.boxes, o).map(
      (b): SubVoxelBox => [b[0], SUB - b[5], b[1], b[3], SUB - b[2], b[4]],
    );
    const full = boxes.some((b) => b[0] === 0 && b[1] === 0 && b[2] === 0 && b[3] === SUB && b[4] === SUB && b[5] === SUB);
    return { bucket, boxes, full };
  });

  const voxels = decodeVoxels(p.voxelsBase64);
  for (let y = 0; y < sy; y++)
    for (let z = 0; z < sz; z++)
      for (let x = 0; x < sx; x++) {
        const prep = prepared[voxels[x + z * sx + y * sx * sz]!];
        if (!prep) continue;
        const ci = x + (sz - 1 - z) * Bx + y * Bx * By;
        if (prep.full) {
          cells[ci] = prep.bucket;
          continue;
        }
        const chunk = new Uint16Array(CHUNK_CELLS);
        for (const [x0, y0, z0, x1, y1, z1] of prep.boxes)
          for (let lz = z0; lz < z1; lz++)
            for (let ly = y0; ly < y1; ly++) chunk.fill(prep.bucket, x0 + ly * SUB + lz * 256, x1 + ly * SUB + lz * 256);
        cells[ci] = chunk;
      }
  return { blocks: [Bx, By, Bz], cells };
}
