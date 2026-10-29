// Shared cell accessors for SparseGrid (Lead-written; used by fill, repair, extract). docs/03 §0-§1.
import type { SparseGrid } from "../../types/mesh";
import { CHUNK_CELLS, SUB } from "../../types/mesh";

/** Grid extent in cells: blocks * 16 on each axis. */
export function gridCells(g: SparseGrid): [number, number, number] {
  return [g.blocks[0] * SUB, g.blocks[1] * SUB, g.blocks[2] * SUB];
}

/** Index into `cells` of block (bx,by,bz): bx + by*Bx + bz*Bx*By. */
export function chunkIndex(g: SparseGrid, bx: number, by: number, bz: number): number {
  return bx + by * g.blocks[0] + bz * g.blocks[0] * g.blocks[1];
}

/** Bucket id at cell (x,y,z); anything outside the grid is air (0). */
export function getCell(g: SparseGrid, x: number, y: number, z: number): number {
  const [Bx, By, Bz] = g.blocks;
  if (x < 0 || y < 0 || z < 0 || x >= Bx * SUB || y >= By * SUB || z >= Bz * SUB) return 0;
  const c = g.cells[(x >> 4) + (y >> 4) * Bx + (z >> 4) * Bx * By]!;
  return typeof c === "number" ? c : c[(x & 15) + (y & 15) * SUB + (z & 15) * 256]!;
}

/**
 * Write bucket id `v` at cell (x,y,z). A numeric chunk is promoted to a Uint16Array(4096) only when `v` differs from
 * its value. Chunks are never demoted here. Throws RangeError outside the grid.
 */
export function setCell(g: SparseGrid, x: number, y: number, z: number, v: number): void {
  const [Bx, By, Bz] = g.blocks;
  if (x < 0 || y < 0 || z < 0 || x >= Bx * SUB || y >= By * SUB || z >= Bz * SUB) {
    throw new RangeError(`cell (${x},${y},${z}) outside grid`);
  }
  const ci = (x >> 4) + (y >> 4) * Bx + (z >> 4) * Bx * By;
  let c = g.cells[ci]!;
  if (typeof c === "number") {
    if (c === v) return;
    c = new Uint16Array(CHUNK_CELLS).fill(c);
    g.cells[ci] = c;
  }
  c[(x & 15) + (y & 15) * SUB + (z & 15) * 256] = v;
}

/** Replace a chunk that is entirely one value by that number. Returns true if it was demoted. */
export function demoteIfUniform(g: SparseGrid, ci: number): boolean {
  const c = g.cells[ci]!;
  if (typeof c === "number") return false;
  const first = c[0]!;
  for (let i = 1; i < CHUNK_CELLS; i++) if (c[i] !== first) return false;
  g.cells[ci] = first;
  return true;
}

/** True when the cell's whole chunk is one non-air number (cheap "this is solid right here" test, no cell lookup). */
export function chunkSolidAt(g: SparseGrid, x: number, y: number, z: number): boolean {
  const [Bx, By, Bz] = g.blocks;
  const cx = x >> 4, cy = y >> 4, cz = z >> 4;
  if (cx < 0 || cy < 0 || cz < 0 || cx >= Bx || cy >= By || cz >= Bz) return false;
  const c = g.cells[cx + cy * Bx + cz * Bx * By];
  return typeof c === "number" && c !== 0;
}
