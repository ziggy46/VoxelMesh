// Surface relief: carve texture-brightness detail into the exposed faces of full-cube blocks (docs/01 §2 `relief`).
//
// One texel of a 16x16 face map is one sub-voxel, so a texel's depth is scale/16 mm. Carving only turns solid cells of a
// block into air, so dimensions, bed fit and block-to-block contacts never change. It runs after the grid is built and
// before cavity fill and repair, so the usual repair and validation still guarantee a watertight result.
import { base64ToBytes, decodeVoxels } from "../../payload/loader";
import type { MeshingOptions, SparseGrid } from "../../types/mesh";
import { RELIEF_BYTES, type PaletteEntry, type VoxelPayload } from "../../types/voxelPayload";
import { getCell, setCell } from "./gridAccess";

const FACE = 256;
/** A face whose brightness barely varies (flat colour, glass) has no relief to show. */
export const MIN_SIGMA = 3;
/** z-score thresholds: a texel this many standard deviations off the face mean is carved one level deeper. */
const T1 = 1.0;
const T2 = 1.5;
/**
 * Budget: every carved texel adds roughly 5 triangles, so past this many the mesh is too heavy to mesh, preview or slice
 * comfortably. Relief is then skipped (never partially applied) and the caller says so.
 */
export const MAX_CARVED_CELLS = 600_000;

/**
 * Carve depth (0..depth) per texel of one 256-texel face map. Normal: dark texels are pits. Invert: light texels are.
 * Thresholds are relative to the face's own mean and spread, so any texture contrast works.
 */
export function reliefLevels(face: Uint8Array, depth: 0 | 1 | 2, invert: boolean): Uint8Array {
  const out = new Uint8Array(FACE);
  if (depth === 0 || face.length !== FACE) return out;
  let sum = 0;
  for (let i = 0; i < FACE; i++) sum += face[i]!;
  const mean = sum / FACE;
  let v = 0;
  for (let i = 0; i < FACE; i++) v += (face[i]! - mean) ** 2;
  const sigma = Math.sqrt(v / FACE);
  if (sigma < MIN_SIGMA) return out;
  for (let i = 0; i < FACE; i++) {
    const z = ((invert ? 1 : -1) * (face[i]! - mean)) / sigma;
    out[i] = depth === 2 ? (z > T2 ? 2 : z > T1 ? 1 : 0) : z > T1 ? 1 : 0;
  }
  return out;
}

const isFullCube = (e: PaletteEntry) =>
  e.boxes.some((b) => b[0] === 0 && b[1] === 0 && b[2] === 0 && b[3] === 16 && b[4] === 16 && b[5] === 16);

export interface ReliefResult {
  /** Cells removed (0 when skipped). */
  removed: number;
  /** Set when the budget was exceeded: how many cells relief wanted to carve. */
  skipped: { wanted: number; limit: number } | null;
}

/**
 * Carve relief into `grid` (built from `payload`). Only texels whose outward neighbour cell is air are carved, so faces
 * shared with other solid blocks stay intact. Decisions use the pre-carve grid, so the result does not depend on order.
 *
 * @returns what was removed, or that the budget {@link MAX_CARVED_CELLS} was exceeded and nothing was changed
 */
export function applyRelief(grid: SparseGrid, p: VoxelPayload, paletteToBucket: Uint16Array, o: MeshingOptions, limit = MAX_CARVED_CELLS): ReliefResult {
  const none: ReliefResult = { removed: 0, skipped: null };
  const depth = o.reliefDepth ?? 0;
  if (depth === 0) return none;
  const invert = o.reliefInvert ?? false;

  // Per palette entry: carve levels for the 6 faces, or null when the entry takes no relief.
  const levels: Array<Uint8Array[] | null> = p.palette.map((e, i) => {
    if (i === 0 || !e.relief || (paletteToBucket[i] ?? 0) === 0 || e.category === "air" || !isFullCube(e)) return null;
    if ((e.category === "fluid" && !o.includeFluids) || (e.category === "foliage" && !o.includeFoliage)) return null;
    const bytes = base64ToBytes(e.relief);
    if (bytes.length !== RELIEF_BYTES) return null;
    const faces: Uint8Array[] = [];
    for (let f = 0; f < 6; f++) faces.push(reliefLevels(bytes.subarray(f * FACE, (f + 1) * FACE), depth, invert));
    return faces;
  });
  if (!levels.some((l) => l !== null)) return none;

  const [sx, sy, sz] = p.dimensions;
  const voxels = decodeVoxels(p.voxelsBase64);
  const Y = sz * 16; // slicer Y extent: MC z is flipped (docs/01 §1)
  const carve: number[] = [];

  /** MC global lattice coordinates -> slicer cell coordinates. */
  const slicer = (gx: number, gy: number, gz: number): [number, number, number] => [gx, Y - 1 - gz, gy];

  for (let by = 0; by < sy; by++)
    for (let bz = 0; bz < sz; bz++)
      for (let bx = 0; bx < sx; bx++) {
        const lv = levels[voxels[bx + bz * sx + by * sx * sz]!];
        if (!lv) continue;
        for (let f = 0; f < 6; f++) {
          const map = lv[f]!;
          // Cheap whole-face skip: a numeric (uniform) non-air neighbour block fully covers this face.
          const nbx = bx + (f === 5 ? 1 : f === 4 ? -1 : 0);
          const nby = by + (f === 1 ? 1 : f === 0 ? -1 : 0);
          const nbz = bz + (f === 3 ? 1 : f === 2 ? -1 : 0);
          if (nbx >= 0 && nby >= 0 && nbz >= 0 && nbx < sx && nby < sy && nbz < sz) {
            const [cx, cy, cz] = slicer(nbx * 16, nby * 16, nbz * 16);
            const chunk = grid.cells[(cx >> 4) + (cy >> 4) * grid.blocks[0] + (cz >> 4) * grid.blocks[0] * grid.blocks[1]];
            if (typeof chunk === "number" && chunk !== 0) continue;
          }
          for (let b = 0; b < 16; b++)
            for (let a = 0; a < 16; a++) {
              const depthHere = map[a + b * 16]!;
              if (depthHere === 0) continue;
              // Local MC lattice coords of the surface cell (k = 0) and the cell just outside it, per face frame.
              for (let k = 0; k < depthHere; k++) {
                const [lx, ly, lz, ox, oy, oz] =
                  f === 0 ? [a, k, b, a, -1, b]
                  : f === 1 ? [a, 15 - k, b, a, 16, b]
                  : f === 2 ? [a, b, k, a, b, -1]
                  : f === 3 ? [a, b, 15 - k, a, b, 16]
                  : f === 4 ? [k, b, a, -1, b, a]
                  : [15 - k, b, a, 16, b, a];
                if (k === 0) {
                  const [ex, ey, ez] = slicer(bx * 16 + ox, by * 16 + oy, bz * 16 + oz);
                  if (getCell(grid, ex, ey, ez) !== 0) break; // covered by a solid neighbour: this column stays whole
                }
                const [cx, cy, cz] = slicer(bx * 16 + lx, by * 16 + ly, bz * 16 + lz);
                carve.push(cx, cy, cz);
              }
            }
        }
      }

  const wanted = carve.length / 3;
  if (wanted > limit) return { removed: 0, skipped: { wanted, limit } };
  let removed = 0;
  for (let i = 0; i < carve.length; i += 3) {
    const x = carve[i]!, y = carve[i + 1]!, z = carve[i + 2]!;
    if (getCell(grid, x, y, z) !== 0) {
      setCell(grid, x, y, z, 0);
      removed++;
    }
  }
  return { removed, skipped: null };
}
