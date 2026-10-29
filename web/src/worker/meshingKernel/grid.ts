// docs/03 §0-§2: sparse sub-voxel grid in slicer space.
import { decodeVoxels } from "../../payload/loader";
import { detailOf, type MeshingOptions, type SparseGrid } from "../../types/mesh";
import { CHUNK_CELLS, SUB } from "../../types/mesh";
import type { SubVoxelBox, VoxelPayload } from "../../types/voxelPayload";
import { dilateThinFeatures } from "./dilate";
import { isIncluded } from "./filters";

interface Prepared {
  bucket: number;
  /** Boxes already in slicer-local block coordinates (cells at this detail), half-open [x0,x1) x [y0,y1) x [z0,z1). */
  boxes: SubVoxelBox[];
  /** True when one box covers the whole block, so its chunks are stored as numbers. */
  full: boolean;
  /** Exact-shape block of slot numbers (n^3 cells, n = 16 * detail); replaces the boxes when present. */
  template?: Uint16Array;
}

/**
 * Build the block-chunked grid. MC block (x,y,z) lands at slicer block (x, sizeZ-1-z, y); MC-local box
 * [minX,minY,minZ,maxX,maxY,maxZ) fills slicer-local x[minX,maxX) y[n-maxZ,n-minZ) z[minY,maxY) (docs/01 §1), with boxes scaled
 * to n = 16 * detail cells. At detail > 1 a block is detail^3 chunks of 16^3 cells and the grid's block dimensions count chunks.
 */
export function buildSparseGrid(p: VoxelPayload, o: MeshingOptions, paletteToBucket: Uint16Array, templates?: ReadonlyMap<number, Uint16Array>): SparseGrid {
  const [sx, sy, sz] = p.dimensions;
  const R = detailOf(o), N = SUB * R;
  const Bx = sx * R, By = sz * R, Bz = sy * R;
  const cells: Array<number | Uint16Array> = new Array<number | Uint16Array>(Bx * By * Bz).fill(0);

  const prepared: Array<Prepared | null> = p.palette.map((e, i) => {
    const bucket = paletteToBucket[i] ?? 0;
    if (i === 0 || bucket === 0 || e.category === "air" || e.boxes.length === 0) return null;
    if (!isIncluded(e, o)) return null;
    const template = templates?.get(i);
    if (template) return { bucket, boxes: [], full: false, template };
    const scaled = e.boxes.map((b): SubVoxelBox => [b[0] * R, b[1] * R, b[2] * R, b[3] * R, b[4] * R, b[5] * R]);
    const boxes = dilateThinFeatures(scaled, o).map(
      (b): SubVoxelBox => [b[0], N - b[5], b[1], b[3], N - b[2], b[4]],
    );
    const full = boxes.some((b) => b[0] === 0 && b[1] === 0 && b[2] === 0 && b[3] === N && b[4] === N && b[5] === N);
    return { bucket, boxes, full };
  });

  const voxels = decodeVoxels(p.voxelsBase64);
  for (let y = 0; y < sy; y++)
    for (let z = 0; z < sz; z++)
      for (let x = 0; x < sx; x++) {
        const prep = prepared[voxels[x + z * sx + y * sx * sz]!];
        if (!prep) continue;
        const cx0 = x * R, cy0 = (sz - 1 - z) * R, cz0 = y * R; // the block's first chunk
        const at = (i: number, j: number, k: number) => cx0 + i + (cy0 + j) * Bx + (cz0 + k) * Bx * By;
        if (prep.full) {
          for (let k = 0; k < R; k++) for (let j = 0; j < R; j++) for (let i = 0; i < R; i++) cells[at(i, j, k)] = prep.bucket;
          continue;
        }
        if (prep.template) {
          if (R === 1) {
            cells[at(0, 0, 0)] = prep.template.slice();
            continue;
          }
          for (let k = 0; k < R; k++)
            for (let j = 0; j < R; j++)
              for (let i = 0; i < R; i++) {
                const chunk = new Uint16Array(CHUNK_CELLS);
                for (let lz = 0; lz < SUB; lz++)
                  for (let ly = 0; ly < SUB; ly++) {
                    const from = i * SUB + (j * SUB + ly) * N + (k * SUB + lz) * N * N;
                    chunk.set(prep.template.subarray(from, from + SUB), ly * SUB + lz * 256);
                  }
                cells[at(i, j, k)] = uniform(chunk);
              }
          continue;
        }
        const mine = new Map<number, number | Uint16Array>();
        for (const b of prep.boxes) fillBox(mine, R, prep.bucket, b);
        for (const [key, c] of mine) cells[at(key % R, Math.floor(key / R) % R, Math.floor(key / (R * R)))] = c;
      }
  return { blocks: [Bx, By, Bz], cells };
}

/** The chunk as a plain number when every cell is the same, else the chunk itself. */
function uniform(chunk: Uint16Array): number | Uint16Array {
  const first = chunk[0]!;
  for (let i = 1; i < CHUNK_CELLS; i++) if (chunk[i] !== first) return chunk;
  return first;
}

/** Fill one block-local box into that block's chunks (key = i + j*R + k*R*R), keeping chunks the box covers whole as numbers. */
function fillBox(mine: Map<number, number | Uint16Array>, R: number, bucket: number, [x0, y0, z0, x1, y1, z1]: SubVoxelBox): void {
  for (let ck = z0 >> 4; ck <= (z1 - 1) >> 4; ck++)
    for (let cj = y0 >> 4; cj <= (y1 - 1) >> 4; cj++)
      for (let ci = x0 >> 4; ci <= (x1 - 1) >> 4; ci++) {
        const ox = ci * SUB, oy = cj * SUB, oz = ck * SUB;
        const lx0 = Math.max(x0, ox) - ox, lx1 = Math.min(x1, ox + SUB) - ox;
        const ly0 = Math.max(y0, oy) - oy, ly1 = Math.min(y1, oy + SUB) - oy;
        const lz0 = Math.max(z0, oz) - oz, lz1 = Math.min(z1, oz + SUB) - oz;
        const key = ci + cj * R + ck * R * R;
        let c = mine.get(key);
        if (lx1 - lx0 === SUB && ly1 - ly0 === SUB && lz1 - lz0 === SUB && (c === undefined || typeof c === "number")) {
          mine.set(key, bucket);
          continue;
        }
        if (c === undefined || typeof c === "number") {
          c = new Uint16Array(CHUNK_CELLS).fill(c ?? 0);
          mine.set(key, c);
        }
        for (let lz = lz0; lz < lz1; lz++)
          for (let ly = ly0; ly < ly1; ly++) c.fill(bucket, lx0 + ly * SUB + lz * 256, lx1 + ly * SUB + lz * 256);
      }
}
