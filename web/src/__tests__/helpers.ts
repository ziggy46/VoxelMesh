// Test oracles. Deliberately independent of every kernel module so they stay valid while kernels are rewritten.
import type { ColorBucketMesh, SparseGrid } from "../types/mesh";
import { CHUNK_CELLS } from "../types/mesh";
import { mulberry32 } from "../samples/fixtures";

export type Pt = [number, number, number];

// ---------------------------------------------------------------- grids

/** Build a SparseGrid from a per-cell function over global slicer-space cell coordinates. Uniform chunks collapse to numbers. */
export function makeGrid(blocks: [number, number, number], f: (x: number, y: number, z: number) => number): SparseGrid {
  const [Bx, By, Bz] = blocks;
  const cells: Array<number | Uint16Array> = [];
  for (let bz = 0; bz < Bz; bz++)
    for (let by = 0; by < By; by++)
      for (let bx = 0; bx < Bx; bx++) {
        const chunk = new Uint16Array(CHUNK_CELLS);
        for (let lz = 0; lz < 16; lz++)
          for (let ly = 0; ly < 16; ly++)
            for (let lx = 0; lx < 16; lx++)
              chunk[lx + ly * 16 + lz * 256] = f(bx * 16 + lx, by * 16 + ly, bz * 16 + lz);
        const first = chunk[0]!;
        cells.push(chunk.every((v) => v === first) ? first : chunk);
      }
  return { blocks, cells };
}

export function gridFromCells(blocks: [number, number, number], list: Array<[number, number, number, number]>): SparseGrid {
  const m = new Map<string, number>();
  for (const [x, y, z, id] of list) m.set(`${x},${y},${z}`, id);
  return makeGrid(blocks, (x, y, z) => m.get(`${x},${y},${z}`) ?? 0);
}

export function cellAt(g: SparseGrid, x: number, y: number, z: number): number {
  const [Bx, By, Bz] = g.blocks;
  if (x < 0 || y < 0 || z < 0 || x >= Bx * 16 || y >= By * 16 || z >= Bz * 16) return 0;
  const c = g.cells[(x >> 4) + (y >> 4) * Bx + (z >> 4) * Bx * By]!;
  return typeof c === "number" ? c : c[(x & 15) + (y & 15) * 16 + (z & 15) * 256]!;
}

export const gridSize = (g: SparseGrid): Pt => [g.blocks[0] * 16, g.blocks[1] * 16, g.blocks[2] * 16];

export function countCells(g: SparseGrid, id?: number): number {
  let n = 0;
  for (const c of g.cells) {
    if (typeof c === "number") {
      if (id === undefined ? c !== 0 : c === id) n += CHUNK_CELLS;
    } else {
      for (let i = 0; i < CHUNK_CELLS; i++) {
        const v = c[i]!;
        if (id === undefined ? v !== 0 : v === id) n++;
      }
    }
  }
  return n;
}

export function gridsEqual(a: SparseGrid, b: SparseGrid): boolean {
  if (a.blocks.some((n, i) => n !== b.blocks[i])) return false;
  const [X, Y, Z] = gridSize(a);
  for (let z = 0; z < Z; z++) for (let y = 0; y < Y; y++) for (let x = 0; x < X; x++) if (cellAt(a, x, y, z) !== cellAt(b, x, y, z)) return false;
  return true;
}

export const numericChunks = (g: SparseGrid) => g.cells.filter((c) => typeof c === "number").length;

/**
 * Count per-bucket non-manifold contacts (docs/03 §4): edge contacts (diagonal 2x2 in any axis plane)
 * and vertex contacts (exactly two cells of one bucket at opposite corners of a 2x2x2 neighbourhood).
 */
export function countContacts(g: SparseGrid): { edge: number; vertex: number } {
  const [X, Y, Z] = gridSize(g);
  const at = (x: number, y: number, z: number) => cellAt(g, x, y, z);
  let edge = 0;
  let vertex = 0;
  for (let z = -1; z < Z; z++)
    for (let y = -1; y < Y; y++)
      for (let x = -1; x < X; x++) {
        // Edge contacts for the three axes: plane spanned by the other two axes.
        const planes: Array<(i: number, j: number) => number> = [
          (i, j) => at(x, y + i, z + j), // axis x
          (i, j) => at(x + i, y, z + j), // axis y
          (i, j) => at(x + i, y + j, z), // axis z
        ];
        for (const cell of planes) {
          const a = cell(0, 0), b = cell(1, 0), c = cell(0, 1), d = cell(1, 1);
          if (a > 0 && a === d && b !== a && c !== a) edge++;
          if (b > 0 && b === c && a !== b && d !== b) edge++;
        }
        // Vertex contacts: opposite corners i and 7-i of the 2x2x2 block.
        const v: number[] = [];
        for (let k = 0; k < 8; k++) v.push(at(x + (k & 1), y + ((k >> 1) & 1), z + ((k >> 2) & 1)));
        for (let k = 0; k < 4; k++) {
          const A = v[k]!;
          if (A > 0 && v[7 - k] === A && v.filter((q) => q === A).length === 2) vertex++;
        }
      }
  return { edge, vertex };
}

/** Unit faces exposed by `id` (neighbour differs). Equals the bucket mesh's total triangle area. */
export function exposedFaces(g: SparseGrid, id: number): number {
  const [X, Y, Z] = gridSize(g);
  let n = 0;
  const dirs: Pt[] = [[1, 0, 0], [-1, 0, 0], [0, 1, 0], [0, -1, 0], [0, 0, 1], [0, 0, -1]];
  for (let z = 0; z < Z; z++)
    for (let y = 0; y < Y; y++)
      for (let x = 0; x < X; x++)
        if (cellAt(g, x, y, z) === id)
          for (const [dx, dy, dz] of dirs) if (cellAt(g, x + dx, y + dy, z + dz) !== id) n++;
  return n;
}

export function randomGrid(seed: number, blocks: [number, number, number], density: number, buckets: number): SparseGrid {
  const rnd = mulberry32(seed);
  const [X, Y, Z] = [blocks[0] * 16, blocks[1] * 16, blocks[2] * 16];
  const cells = new Uint8Array(X * Y * Z);
  for (let i = 0; i < cells.length; i++) cells[i] = rnd() < density ? 1 + Math.floor(rnd() * buckets) : 0;
  return makeGrid(blocks, (x, y, z) => cells[x + y * X + z * X * Y]!);
}

// ---------------------------------------------------------------- meshes

export interface MeshStats {
  triangles: number;
  vertices: number;
  openEdges: number;
  nonManifoldEdges: number;
  degenerate: number;
  volume: number;
  area: number;
  duplicateVertices: number;
}

/** Position-keyed mesh analysis (so it also works on unwelded input). */
export function analyzeMesh(m: ColorBucketMesh): MeshStats {
  const P = m.positions, I = m.indices;
  const key = (i: number) => `${P[3 * i]},${P[3 * i + 1]},${P[3 * i + 2]}`;
  const dir = new Map<string, number>();
  let vol6 = 0, area = 0, degenerate = 0;
  for (let t = 0; t < I.length; t += 3) {
    const ia = I[t]!, ib = I[t + 1]!, ic = I[t + 2]!;
    const a: Pt = [P[3 * ia]!, P[3 * ia + 1]!, P[3 * ia + 2]!];
    const b: Pt = [P[3 * ib]!, P[3 * ib + 1]!, P[3 * ib + 2]!];
    const c: Pt = [P[3 * ic]!, P[3 * ic + 1]!, P[3 * ic + 2]!];
    for (const [u, v] of [[ia, ib], [ib, ic], [ic, ia]] as const) {
      const k = `${key(u)}>${key(v)}`;
      dir.set(k, (dir.get(k) ?? 0) + 1);
    }
    const e1: Pt = [b[0] - a[0], b[1] - a[1], b[2] - a[2]];
    const e2: Pt = [c[0] - a[0], c[1] - a[1], c[2] - a[2]];
    const cr: Pt = [e1[1] * e2[2] - e1[2] * e2[1], e1[2] * e2[0] - e1[0] * e2[2], e1[0] * e2[1] - e1[1] * e2[0]];
    const len = Math.hypot(cr[0], cr[1], cr[2]);
    if (len === 0) degenerate++;
    area += len / 2;
    vol6 += a[0] * (b[1] * c[2] - b[2] * c[1]) - a[1] * (b[0] * c[2] - b[2] * c[0]) + a[2] * (b[0] * c[1] - b[1] * c[0]);
  }
  let open = 0, nonManifold = 0;
  for (const [k, n] of dir) {
    const [p, q] = k.split(">") as [string, string];
    if (!dir.has(`${q}>${p}`)) open += n;
    if (n > 1) nonManifold += n - 1;
  }
  const vertices = P.length / 3;
  const uniq = new Set<string>();
  for (let i = 0; i < vertices; i++) uniq.add(key(i));
  return {
    triangles: I.length / 3, vertices, openEdges: open, nonManifoldEdges: nonManifold, degenerate,
    volume: vol6 / 6, area, duplicateVertices: vertices - uniq.size,
  };
}

export const isClosed = (m: ColorBucketMesh) => {
  const s = analyzeMesh(m);
  return s.openEdges === 0 && s.nonManifoldEdges === 0;
};

/** Build a welded mesh from triangles given as coordinate triples. */
export function meshFromTris(bucketId: number, tris: Array<[Pt, Pt, Pt]>): ColorBucketMesh {
  const index = new Map<string, number>();
  const pos: number[] = [];
  const idx: number[] = [];
  for (const tri of tris)
    for (const p of tri) {
      const k = p.join(",");
      let i = index.get(k);
      if (i === undefined) {
        i = pos.length / 3;
        index.set(k, i);
        pos.push(...p);
      }
      idx.push(i);
    }
  return { bucketId, positions: Int32Array.from(pos), indices: Uint32Array.from(idx) };
}

/** Quad (p0,p1,p2,p3) given CCW seen from outside -> triangles (p0,p1,p2),(p0,p2,p3). */
export const quad = (p0: Pt, p1: Pt, p2: Pt, p3: Pt): Array<[Pt, Pt, Pt]> => [[p0, p1, p2], [p0, p2, p3]];

/** Closed axis-aligned box [x0,x1]x[y0,y1]x[z0,z1], CCW outward, 12 triangles. */
export function boxTris(x0: number, y0: number, z0: number, x1: number, y1: number, z1: number): Array<[Pt, Pt, Pt]> {
  return [
    ...quad([x0, y0, z0], [x0, y1, z0], [x1, y1, z0], [x1, y0, z0]), // -z
    ...quad([x0, y0, z1], [x1, y0, z1], [x1, y1, z1], [x0, y1, z1]), // +z
    ...quad([x0, y0, z0], [x1, y0, z0], [x1, y0, z1], [x0, y0, z1]), // -y
    ...quad([x0, y1, z0], [x0, y1, z1], [x1, y1, z1], [x1, y1, z0]), // +y
    ...quad([x0, y0, z0], [x0, y0, z1], [x0, y1, z1], [x0, y1, z0]), // -x
    ...quad([x1, y0, z0], [x1, y1, z0], [x1, y1, z1], [x1, y0, z1]), // +x
  ];
}

export const cubeMesh = (bucketId: number, x: number, y: number, z: number, s: number) =>
  meshFromTris(bucketId, boxTris(x, y, z, x + s, y + s, z + s));

/** 2x2x1 slab whose bottom face is tiled 1 big + 2 small quads: leaves T-junctions against the side faces. */
export function tJunctionSlab(bucketId = 1): ColorBucketMesh {
  const tris: Array<[Pt, Pt, Pt]> = [
    // bottom (z=0, -z): A=[0,2]x[0,1], B1=[0,1]x[1,2], B2=[1,2]x[1,2]
    ...quad([0, 0, 0], [0, 1, 0], [2, 1, 0], [2, 0, 0]),
    ...quad([0, 1, 0], [0, 2, 0], [1, 2, 0], [1, 1, 0]),
    ...quad([1, 1, 0], [1, 2, 0], [2, 2, 0], [2, 1, 0]),
    // top (z=1, +z), single quad
    ...quad([0, 0, 1], [2, 0, 1], [2, 2, 1], [0, 2, 1]),
    // sides, single quads
    ...quad([0, 0, 0], [2, 0, 0], [2, 0, 1], [0, 0, 1]), // -y
    ...quad([0, 2, 0], [0, 2, 1], [2, 2, 1], [2, 2, 0]), // +y
    ...quad([0, 0, 0], [0, 0, 1], [0, 2, 1], [0, 2, 0]), // -x
    ...quad([2, 0, 0], [2, 2, 0], [2, 2, 1], [2, 0, 1]), // +x
  ];
  return meshFromTris(bucketId, tris);
}

export function mergeMeshes(bucketId: number, ms: ColorBucketMesh[]): ColorBucketMesh {
  const tris: Array<[Pt, Pt, Pt]> = [];
  for (const m of ms)
    for (let t = 0; t < m.indices.length; t += 3) {
      const p = (k: number): Pt => [m.positions[3 * m.indices[t + k]!]!, m.positions[3 * m.indices[t + k]! + 1]!, m.positions[3 * m.indices[t + k]! + 2]!];
      tris.push([p(0), p(1), p(2)]);
    }
  return meshFromTris(bucketId, tris);
}

export const bytesOf = (m: ColorBucketMesh): Uint8Array => {
  const a = new Uint8Array(m.positions.buffer, m.positions.byteOffset, m.positions.byteLength);
  const b = new Uint8Array(m.indices.buffer, m.indices.byteOffset, m.indices.byteLength);
  const out = new Uint8Array(a.length + b.length);
  out.set(a, 0);
  out.set(b, a.length);
  return out;
};

export const hasVertex = (m: ColorBucketMesh, x: number, y: number, z: number) => {
  for (let i = 0; i < m.positions.length; i += 3) if (m.positions[i] === x && m.positions[i + 1] === y && m.positions[i + 2] === z) return true;
  return false;
};
