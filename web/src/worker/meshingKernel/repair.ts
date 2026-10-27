// docs/03 §4: per-bucket non-manifold repair (edge contacts, then vertex contacts), to fixpoint.
//
// Deviations from the spec text, both needed for random fields to converge:
//  * The pass cap is 128, not 4.
//  * Every write either turns air into solid or LOWERS a cell's bucket id, so (#air, sum of ids) strictly decreases and
//    the passes terminate. The spec's "recolor b to A" is exactly that whenever A < b; otherwise c or a is lowered.
//
// A window that reaches outside the grid never fires (it would hold two outside cells on different diagonals, or on the
// opposite-corner pair), so only fully interior windows are examined and every write stays in range.
import type { SparseGrid } from "../../types/mesh";
import { gridCells, setCell } from "./gridAccess";

const N = 17; // padded block: 16 cells plus one forward layer
const NN = N * N;
const MAX_PASSES = 128;

export function repairNonManifold(g: SparseGrid): { bridgesAdded: number; recolored: number } {
  const [Bx, By, Bz] = g.blocks;
  const [X, Y, Z] = gridCells(g);
  const buf = new Uint16Array(N * NN);
  let bridgesAdded = 0;
  let recolored = 0;
  // Chunks whose windows must be rescanned. A write at cell p changes windows whose origin is p or p-1 on each axis.
  let dirty = new Uint8Array(Bx * By * Bz).fill(1);
  let nextDirty = new Uint8Array(Bx * By * Bz);
  let ox = 0, oy = 0, oz = 0; // origin of the chunk being scanned

  const readCell = (x: number, y: number, z: number): number => {
    const c = g.cells[(x >> 4) + (y >> 4) * Bx + (z >> 4) * Bx * By]!;
    return typeof c === "number" ? c : c[(x & 15) + (y & 15) * 16 + (z & 15) * 256]!;
  };

  const chunkValue = (bx: number, by: number, bz: number): number => {
    if (bx >= Bx || by >= By || bz >= Bz) return -1; // outside: ignored
    const c = g.cells[bx + by * Bx + bz * Bx * By]!;
    return typeof c === "number" ? c : -2; // -2: mixed
  };

  /** Can no window starting in this chunk fire? True for a uniform chunk whose forward neighbours are the same number. */
  const skippable = (bx: number, by: number, bz: number): boolean => {
    const v = chunkValue(bx, by, bz);
    if (v < 0) return false;
    for (let k = 1; k < 8; k++) {
      const nv = chunkValue(bx + (k & 1), by + ((k >> 1) & 1), bz + ((k >> 2) & 1));
      if (nv !== -1 && nv !== v) return false;
    }
    return true;
  };

  /** Fill the padded 17^3 buffer: the chunk's own cells by direct copy, then the forward layers through readCell. */
  const gather = (bx: number, by: number, bz: number): void => {
    const c = g.cells[bx + by * Bx + bz * Bx * By]!;
    for (let k = 0; k < 16; k++)
      for (let j = 0; j < 16; j++) {
        const row = j * N + k * NN;
        if (typeof c === "number") buf.fill(c, row, row + 16);
        else for (let i = 0; i < 16; i++) buf[row + i] = c[i + j * 16 + k * 256]!;
      }
    for (let k = 0; k < N; k++)
      for (let j = 0; j < N; j++)
        for (let i = 0; i < N; i++) {
          if (i < 16 && j < 16 && k < 16) continue;
          const x = ox + i, y = oy + j, z = oz + k;
          buf[i + j * N + k * NN] = x < X && y < Y && z < Z ? readCell(x, y, z) : 0;
        }
  };

  /** Write bucket `v` at padded-buffer index `bi` and into the grid; mark the chunks whose windows it touches. */
  const put = (bi: number, v: number): void => {
    buf[bi] = v;
    const x = ox + (bi % N), y = oy + (Math.floor(bi / N) % N), z = oz + Math.floor(bi / NN);
    setCell(g, x, y, z, v);
    for (let q = 0; q < 8; q++) {
      const cx = (x - (q & 1)) >> 4, cy = (y - ((q >> 1) & 1)) >> 4, cz = (z - ((q >> 2) & 1)) >> 4;
      if (cx >= 0 && cy >= 0 && cz >= 0) nextDirty[cx + cy * Bx + cz * Bx * By] = 1;
    }
  };

  /** One 2x2 window a,b,c,d (buffer indices): a,d on one diagonal, b,c on the other. */
  const edgeWindow = (a: number, b: number, c: number, d: number): void => {
    const A = buf[a]!, B = buf[b]!, C = buf[c]!, D = buf[d]!;
    if (A === 0 && B === 0) return; // both rules need a non-air a or b
    if (A > 0 && A === D && B !== A && C !== A) {
      if (B === 0) { put(b, A); bridgesAdded++; }
      else if (C === 0) { put(c, A); bridgesAdded++; }
      else {
        // Both others solid: spec recolours b to A (this branch when A < b); otherwise lower c, or a itself.
        if (A < B) put(b, A);
        else if (A < C) put(c, A);
        else put(a, B);
        recolored++;
      }
    }
    const B2 = buf[b]!;
    if (B2 > 0 && B2 === buf[c] && buf[a] !== B2 && buf[d] !== B2) {
      const a2 = buf[a]!, d2 = buf[d]!;
      if (a2 === 0) { put(a, B2); bridgesAdded++; }
      else if (d2 === 0) { put(d, B2); bridgesAdded++; }
      else {
        if (B2 < a2) put(a, B2);
        else if (B2 < d2) put(d, B2);
        else put(b, a2);
        recolored++;
      }
    }
  };

  const edgeScan = (): void => {
    // Origin limits keeping all four cells inside the grid: `full` for the axis a window does not span, `plane` for the two it spans.
    const fx = Math.min(15, X - ox - 1), fy = Math.min(15, Y - oy - 1), fz = Math.min(15, Z - oz - 1);
    const px = Math.min(15, X - ox - 2), py = Math.min(15, Y - oy - 2), pz = Math.min(15, Z - oz - 2);
    for (let k = 0; k <= fz; k++)
      for (let j = 0; j <= fy; j++)
        for (let i = 0; i <= fx; i++) {
          const p = i + j * N + k * NN;
          if (j <= py && k <= pz) edgeWindow(p, p + N, p + NN, p + N + NN); // axis x: plane (y,z)
          if (i <= px && k <= pz) edgeWindow(p, p + 1, p + NN, p + 1 + NN); // axis y: plane (x,z)
          if (i <= px && j <= py) edgeWindow(p, p + 1, p + N, p + 1 + N); // axis z: plane (x,y)
        }
  };

  const vertexScan = (): void => {
    const px = Math.min(15, X - ox - 2), py = Math.min(15, Y - oy - 2), pz = Math.min(15, Z - oz - 2);
    for (let k = 0; k <= pz; k++)
      for (let j = 0; j <= py; j++)
        for (let i = 0; i <= px; i++) {
          const base = i + j * N + k * NN;
          // Opposite corner pairs (c, 7-c): corner bit0=x, bit1=y, bit2=z. c < 4 is always the lower-z corner.
          for (let c = 0; c < 4; c++) {
            const lo = base + (c & 1) + ((c >> 1) & 1) * N;
            const A = buf[lo]!;
            if (A === 0) continue;
            const o = 7 - c;
            if (buf[base + (o & 1) + ((o >> 1) & 1) * N + NN] !== A) continue;
            let count = 0;
            for (let q = 0; q < 8; q++) if (buf[base + (q & 1) + ((q >> 1) & 1) * N + ((q >> 2) & 1) * NN] === A) count++;
            if (count !== 2) continue;
            // Connecting cells next to the lower corner, +Z first (the spec's choice). Prefer an air cell, then a solid
            // cell above A (recoloured down to A), else lower the corner itself to its smaller neighbouring bucket.
            const cand = [lo + NN, lo + 1 - 2 * (c & 1), lo + N - 2 * N * ((c >> 1) & 1)];
            const air = cand.find((q) => buf[q] === 0);
            const above = cand.find((q) => buf[q]! > A);
            if (air !== undefined) {
              put(air, A);
              bridgesAdded++;
            } else if (above !== undefined) {
              put(above, A);
              recolored++;
            } else {
              put(lo, buf[cand[0]!]!);
              recolored++;
            }
          }
        }
  };

  const scan = (mode: "edge" | "vertex"): void => {
    for (let bz = 0; bz < Bz; bz++)
      for (let by = 0; by < By; by++)
        for (let bx = 0; bx < Bx; bx++) {
          if (!dirty[bx + by * Bx + bz * Bx * By] || skippable(bx, by, bz)) continue;
          ox = bx * 16; oy = by * 16; oz = bz * 16;
          gather(bx, by, bz);
          if (mode === "edge") edgeScan();
          else vertexScan();
        }
  };

  for (let pass = 0; pass < MAX_PASSES; pass++) {
    scan("edge");
    scan("vertex");
    if (!nextDirty.some((d) => d === 1)) break;
    const t = dirty;
    dirty = nextDirty;
    nextDirty = t;
    nextDirty.fill(0);
  }
  return { bridgesAdded, recolored };
}
