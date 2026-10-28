// Surface relief: carve texture-brightness detail into the exposed faces of full-cube blocks (docs/01 §2 `relief`).
//
// One texel of a 16x16 face map is one sub-voxel, so a texel's depth is scale/16 mm. Carving only turns solid cells of a
// block into air, so dimensions, bed fit and block-to-block contacts never change. It runs after the grid is built and
// before cavity fill and repair, so the usual repair and validation still guarantee a watertight result.
import { base64ToBytes, decodeVoxels } from "../../payload/loader";
import type { MeshingOptions, ReliefDepth, SparseGrid } from "../../types/mesh";
import { RELIEF_BYTES, type PaletteEntry, type VoxelPayload } from "../../types/voxelPayload";
import { isIncluded } from "./filters";
import { faceCell, faceNeighbour, faceOutside } from "./faceFrame";
import { getCell, setCell } from "./gridAccess";

const FACE = 256;
/** A face whose brightness range is narrower than this (flat colour) has no relief to show. */
export const MIN_RANGE = 32;
/** Brightness range is measured between these percentiles (of 256 texels), so one stray pixel does not set the scale. */
const LO_RANK = 26; // 10th percentile
const HI_RANK = 230; // 90th percentile
/**
 * Budget: every carved texel adds roughly 5 triangles, so past this many the mesh is too heavy to mesh, preview or slice
 * comfortably. Relief is then skipped (never partially applied) and the caller says so.
 */
export const MAX_CARVED_CELLS = 600_000;

/**
 * Depth map from one 256-texel brightness map: carve depth per texel, 0..depth, scaled continuously with brightness.
 * Normal: the darkest texels are carved deepest and the lightest not at all, so a dark crack or mortar line is a groove and
 * a bright bevel stays proud. Invert flips that. The scale runs between the face's 10th and 90th percentile (or its full
 * min..max when those are too close, so a single dark pixel still counts); a face narrower than MIN_RANGE is flat.
 */
export function reliefLevels(face: Uint8Array, depth: ReliefDepth, invert: boolean): Uint8Array {
  const out = new Uint8Array(FACE);
  if (depth === 0 || face.length !== FACE) return out;
  const sorted = Array.from(face).sort((a, b) => a - b);
  let lo = sorted[LO_RANK]!, hi = sorted[HI_RANK]!;
  if (hi - lo < MIN_RANGE) {
    lo = sorted[0]!;
    hi = sorted[FACE - 1]!;
  }
  if (hi - lo < MIN_RANGE) return out;
  for (let i = 0; i < FACE; i++) {
    const t = invert ? (face[i]! - lo) / (hi - lo) : (hi - face[i]!) / (hi - lo);
    out[i] = Math.round(Math.min(1, Math.max(0, t)) * depth);
  }
  return out;
}

const isFullCube = (e: PaletteEntry) =>
  e.boxes.some((b) => b[0] === 0 && b[1] === 0 && b[2] === 0 && b[3] === 16 && b[4] === 16 && b[5] === 16);

export interface ReliefResult {
  /** Cells removed (0 when skipped). */
  removed: number;
  /** The depth actually applied; lower than requested when the budget forced a shallower relief. 0 when skipped. */
  usedDepth: ReliefDepth;
  /** Set when even the shallowest relief (1) exceeded the budget: how many cells it wanted to carve. */
  skipped: { wanted: number; limit: number } | null;
}

/**
 * Carve relief into `grid` (built from `payload`). Only texels whose outward neighbour cell is air are carved, so faces
 * shared with other solid blocks stay intact. Decisions use the pre-carve grid, so the result does not depend on order.
 *
 * If the requested depth would carve more than `limit` cells (about 5 triangles each), it steps down to a shallower
 * depth until it fits. If even depth 1 does not fit, nothing is changed and `skipped` says why.
 */
export function applyRelief(grid: SparseGrid, p: VoxelPayload, paletteToBucket: Uint16Array, o: MeshingOptions, limit = MAX_CARVED_CELLS): ReliefResult {
  const requested = o.reliefDepth ?? 0;
  const none: ReliefResult = { removed: 0, usedDepth: 0, skipped: null };
  if (requested === 0) return none;
  const invert = o.reliefInvert ?? false;

  const decoded: Array<Uint8Array | null> = p.palette.map((e, i) => {
    if (i === 0 || !e.relief || (paletteToBucket[i] ?? 0) === 0 || e.category === "air" || !isFullCube(e)) return null;
    if (!isIncluded(e, o)) return null;
    const bytes = base64ToBytes(e.relief);
    return bytes.length === RELIEF_BYTES ? bytes : null;
  });
  if (!decoded.some((d) => d !== null)) return none;

  const [sx, sy, sz] = p.dimensions;
  const voxels = decodeVoxels(p.voxelsBase64);
  const Y = sz * 16; // slicer Y extent: MC z is flipped (docs/01 §1)

  /** MC global lattice coordinates -> slicer cell coordinates. */
  const slicer = (gx: number, gy: number, gz: number): [number, number, number] => [gx, Y - 1 - gz, gy];

  /** Every slicer cell relief would remove at `depth`, as flat x,y,z triples (a cell on a block edge may appear twice). */
  const plan = (depth: ReliefDepth): number[] => {
    const levels: Array<Uint8Array[] | null> = decoded.map((bytes) => {
      if (!bytes) return null;
      const faces: Uint8Array[] = [];
      for (let f = 0; f < 6; f++) faces.push(reliefLevels(bytes.subarray(f * FACE, (f + 1) * FACE), depth, invert));
      return faces;
    });
    const carve: number[] = [];
    for (let by = 0; by < sy; by++)
      for (let bz = 0; bz < sz; bz++)
        for (let bx = 0; bx < sx; bx++) {
          const lv = levels[voxels[bx + bz * sx + by * sx * sz]!];
          if (!lv) continue;
          for (let f = 0; f < 6; f++) {
            const map = lv[f]!;
            // Cheap whole-face skip: a numeric (uniform) non-air neighbour block fully covers this face.
            const [dx, dy, dz] = faceNeighbour(f);
            const nbx = bx + dx, nby = by + dy, nbz = bz + dz;
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
                  const [lx, ly, lz] = faceCell(f, a, b, k);
                  if (k === 0) {
                    const [ox, oy, oz] = faceOutside(f, a, b);
                    const [ex, ey, ez] = slicer(bx * 16 + ox, by * 16 + oy, bz * 16 + oz);
                    if (getCell(grid, ex, ey, ez) !== 0) break; // covered by a solid neighbour: this column stays whole
                  }
                  const [cx, cy, cz] = slicer(bx * 16 + lx, by * 16 + ly, bz * 16 + lz);
                  carve.push(cx, cy, cz);
                }
              }
          }
        }
    return carve;
  };

  let carve: number[] = [];
  let used: ReliefDepth = requested;
  let wanted = 0;
  for (; used >= 1; used = (used - 1) as ReliefDepth) {
    carve = plan(used);
    wanted = carve.length / 3;
    if (wanted <= limit) break;
  }
  if (used < 1) return { removed: 0, usedDepth: 0, skipped: { wanted, limit } };

  let removed = 0;
  for (let i = 0; i < carve.length; i += 3) {
    const x = carve[i]!, y = carve[i + 1]!, z = carve[i + 2]!;
    if (getCell(grid, x, y, z) !== 0) {
      setCell(grid, x, y, z, 0);
      removed++;
    }
  }
  return { removed, usedDepth: used, skipped: null };
}
