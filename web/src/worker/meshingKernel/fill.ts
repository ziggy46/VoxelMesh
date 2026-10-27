// docs/03 §3: exterior flood-fill; enclosed air becomes the lowest touching bucket. Chunk-aware: a numeric-air chunk
// is one flood node, so cost is proportional to mixed chunks, not to total cells.
import type { SparseGrid } from "../../types/mesh";
import { CHUNK_CELLS } from "../../types/mesh";

const DIRS: ReadonlyArray<readonly [number, number, number]> = [
  [1, 0, 0], [-1, 0, 0], [0, 1, 0], [0, -1, 0], [0, 0, 1], [0, 0, -1],
];

/** Visited sets plus a work queue. Item (ci, li): li < 0 is a whole numeric-air chunk, else a cell in a mixed chunk. */
class Flood {
  readonly whole: Uint8Array;
  readonly cell: Array<Uint8Array | undefined>;
  readonly qc: number[] = [];
  readonly ql: number[] = [];
  head = 0;

  constructor(n: number) {
    this.whole = new Uint8Array(n);
    this.cell = new Array<Uint8Array | undefined>(n).fill(undefined);
  }

  seen(ci: number, li: number): boolean {
    if (li < 0) return this.whole[ci] === 1;
    const a = this.cell[ci];
    return a !== undefined && a[li] === 1;
  }

  push(ci: number, li: number): void {
    if (li < 0) this.whole[ci] = 1;
    else {
      let a = this.cell[ci];
      if (a === undefined) {
        a = new Uint8Array(CHUNK_CELLS);
        this.cell[ci] = a;
      }
      a[li] = 1;
    }
    this.qc.push(ci);
    this.ql.push(li);
  }
}

export function fillInteriorCavities(g: SparseGrid): void {
  const [Bx, By, Bz] = g.blocks;
  const n = Bx * By * Bz;
  const cells = g.cells;

  /** Look at one neighbour air-or-solid cell/chunk: flood into air, report solid buckets. */
  const visitCell = (f: Flood, nci: number, nli: number, onSolid: ((b: number) => void) | null): void => {
    const nc = cells[nci]!;
    const v = typeof nc === "number" ? nc : nc[nli]!;
    if (v !== 0) onSolid?.(v);
    else if (typeof nc === "number") {
      if (!f.seen(nci, -1)) f.push(nci, -1);
    } else if (!f.seen(nci, nli)) f.push(nci, nli);
  };

  const expand = (f: Flood, ci: number, li: number, onSolid: ((b: number) => void) | null): void => {
    const bx = ci % Bx, by = Math.floor(ci / Bx) % By, bz = Math.floor(ci / (Bx * By));
    for (const [dx, dy, dz] of DIRS) {
      if (li >= 0) {
        const lx = (li & 15) + dx, ly = ((li >> 4) & 15) + dy, lz = (li >> 8) + dz;
        if (lx >= 0 && lx < 16 && ly >= 0 && ly < 16 && lz >= 0 && lz < 16) {
          visitCell(f, ci, lx + ly * 16 + lz * 256, onSolid);
          continue;
        }
      }
      const nbx = bx + dx, nby = by + dy, nbz = bz + dz;
      if (nbx < 0 || nby < 0 || nbz < 0 || nbx >= Bx || nby >= By || nbz >= Bz) continue; // exterior padding
      const nci = nbx + nby * Bx + nbz * Bx * By;
      const nc = cells[nci]!;
      if (li < 0) {
        // Whole air chunk: touch the neighbour's face. Numeric neighbours are one node; mixed ones need their 256 face cells.
        if (typeof nc === "number") {
          visitCell(f, nci, 0, onSolid);
          continue;
        }
        for (let a = 0; a < 16; a++)
          for (let b = 0; b < 16; b++) {
            const lx = dx === 1 ? 0 : dx === -1 ? 15 : a;
            const ly = dy === 1 ? 0 : dy === -1 ? 15 : dx !== 0 ? a : b;
            const lz = dz === 1 ? 0 : dz === -1 ? 15 : b;
            visitCell(f, nci, lx + ly * 16 + lz * 256, onSolid);
          }
      } else {
        const lx = (li & 15) + dx, ly = ((li >> 4) & 15) + dy, lz = (li >> 8) + dz;
        visitCell(f, nci, (lx & 15) + (ly & 15) * 16 + (lz & 15) * 256, onSolid);
      }
    }
  };

  // Pass 1: flood exterior air from every face of the grid.
  const ext = new Flood(n);
  for (let bz = 0; bz < Bz; bz++)
    for (let by = 0; by < By; by++)
      for (let bx = 0; bx < Bx; bx++) {
        if (bx !== 0 && by !== 0 && bz !== 0 && bx !== Bx - 1 && by !== By - 1 && bz !== Bz - 1) continue;
        const ci = bx + by * Bx + bz * Bx * By;
        const c = cells[ci]!;
        if (typeof c === "number") {
          if (c === 0 && !ext.seen(ci, -1)) ext.push(ci, -1);
          continue;
        }
        for (let lz = 0; lz < 16; lz++)
          for (let ly = 0; ly < 16; ly++)
            for (let lx = 0; lx < 16; lx++) {
              const onFace = (bx === 0 && lx === 0) || (bx === Bx - 1 && lx === 15) ||
                (by === 0 && ly === 0) || (by === By - 1 && ly === 15) ||
                (bz === 0 && lz === 0) || (bz === Bz - 1 && lz === 15);
              const li = lx + ly * 16 + lz * 256;
              if (onFace && c[li] === 0 && !ext.seen(ci, li)) ext.push(ci, li);
            }
      }
  while (ext.head < ext.qc.length) {
    expand(ext, ext.qc[ext.head]!, ext.ql[ext.head]!, null);
    ext.head++;
  }

  // Pass 2: every remaining air cell is enclosed. Label components and fill each with its lowest touching bucket.
  const cav = new Flood(n);
  for (let ci = 0; ci < n; ci++) {
    const c = cells[ci]!;
    const starts: number[] = [];
    if (typeof c === "number") {
      if (c === 0 && !ext.seen(ci, -1) && !cav.seen(ci, -1)) starts.push(-1);
    } else {
      for (let li = 0; li < CHUNK_CELLS; li++) if (c[li] === 0 && !ext.seen(ci, li) && !cav.seen(ci, li)) starts.push(li);
    }
    for (const li0 of starts) {
      if (cav.seen(ci, li0)) continue; // reached by an earlier start in this chunk
      const first = cav.qc.length;
      cav.push(ci, li0);
      let lowest = Infinity;
      const onSolid = (b: number) => {
        if (b < lowest) lowest = b;
      };
      cav.head = first;
      while (cav.head < cav.qc.length) {
        expand(cav, cav.qc[cav.head]!, cav.ql[cav.head]!, onSolid);
        cav.head++;
      }
      if (lowest === Infinity) continue; // cannot happen: a cavity always touches solid
      for (let k = first; k < cav.qc.length; k++) {
        const mci = cav.qc[k]!, mli = cav.ql[k]!;
        if (mli < 0) cells[mci] = lowest;
        else (cells[mci] as Uint16Array)[mli] = lowest;
      }
    }
  }
}
