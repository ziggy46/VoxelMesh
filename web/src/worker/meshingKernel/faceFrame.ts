// The six face frames of a block, shared by relief (carving) and face colours (skins). Face order is Minecraft's Direction ids:
// DOWN, UP, NORTH, SOUTH, WEST, EAST. A face is a 16x16 grid of columns (a, b) running inward from the surface: depth k = 0 is
// the outermost cell, k = 15 the opposite side. Frames: y faces a = x, b = z; z faces a = x, b = y; x faces a = z, b = y.

/** Block-local MC lattice coordinates of the cell at depth `k` in column (a, b) of `face`. */
export function faceCell(face: number, a: number, b: number, k: number): [number, number, number] {
  switch (face) {
    case 0: return [a, k, b];
    case 1: return [a, 15 - k, b];
    case 2: return [a, b, k];
    case 3: return [a, b, 15 - k];
    case 4: return [k, b, a];
    default: return [15 - k, b, a];
  }
}

/** The cell just outside the block in column (a, b) of `face` (one step beyond depth 0), in block-local MC coordinates. */
export function faceOutside(face: number, a: number, b: number): [number, number, number] {
  switch (face) {
    case 0: return [a, -1, b];
    case 1: return [a, 16, b];
    case 2: return [a, b, -1];
    case 3: return [a, b, 16];
    case 4: return [-1, b, a];
    default: return [16, b, a];
  }
}

/** Block offset of the neighbour that `face` looks at, in MC block coordinates. */
export function faceNeighbour(face: number): [number, number, number] {
  return [face === 5 ? 1 : face === 4 ? -1 : 0, face === 1 ? 1 : face === 0 ? -1 : 0, face === 3 ? 1 : face === 2 ? -1 : 0];
}
