// docs/03 §6: T-junction healing. Greedy rectangles of different sizes leave a vertex in the interior of a neighbour's
// axis-aligned edge; slicers report that as an open edge. Split such triangles at the vertex (fan from the opposite
// corner, winding preserved) and repeat until nothing splits.
import type { ColorBucketMesh } from "../../types/mesh";

const MAX_ROUNDS = 32;
const key3 = (x: number, y: number, z: number) => x * 16777216 + y * 4096 + z;
const lineKey = (axis: number, c1: number, c2: number) => (axis * 4096 + c1) * 4096 + c2;

export function healTJunctions(m: ColorBucketMesh): ColorBucketMesh {
  // Weld by position so edges match by vertex id.
  const weld = new Map<number, number>();
  const P: number[] = [];
  const remap = new Uint32Array(m.positions.length / 3);
  for (let i = 0; i < remap.length; i++) {
    const x = m.positions[3 * i]!, y = m.positions[3 * i + 1]!, z = m.positions[3 * i + 2]!;
    if (x < 0 || y < 0 || z < 0 || x >= 4096 || y >= 4096 || z >= 4096) throw new RangeError("lattice coordinate out of range");
    const k = key3(x, y, z);
    let id = weld.get(k);
    if (id === undefined) {
      id = P.length / 3;
      weld.set(k, id);
      P.push(x, y, z);
    }
    remap[i] = id;
  }

  // Index vertices by axis-aligned line, sorted along the line.
  const lines = new Map<number, number[]>();
  const nv = P.length / 3;
  for (let v = 0; v < nv; v++) {
    const x = P[3 * v]!, y = P[3 * v + 1]!, z = P[3 * v + 2]!;
    for (const k of [lineKey(0, y, z), lineKey(1, x, z), lineKey(2, x, y)]) {
      let l = lines.get(k);
      if (!l) lines.set(k, (l = []));
      l.push(v);
    }
  }
  for (const [k, l] of lines) {
    const axis = Math.floor(k / (4096 * 4096));
    l.sort((p, q) => P[3 * p + axis]! - P[3 * q + axis]!);
  }

  /** Vertices strictly inside the axis-aligned edge p -> q, ordered from p to q. */
  const interior = (p: number, q: number): number[] => {
    const dx = P[3 * q]! - P[3 * p]!, dy = P[3 * q + 1]! - P[3 * p + 1]!, dz = P[3 * q + 2]! - P[3 * p + 2]!;
    const nonzero = (dx !== 0 ? 1 : 0) + (dy !== 0 ? 1 : 0) + (dz !== 0 ? 1 : 0);
    if (nonzero !== 1) return [];
    const axis = dx !== 0 ? 0 : dy !== 0 ? 1 : 2;
    const o1 = axis === 0 ? 1 : 0, o2 = axis === 2 ? 1 : 2;
    const l = lines.get(lineKey(axis, P[3 * p + o1]!, P[3 * p + o2]!));
    if (!l) return [];
    const t0 = P[3 * p + axis]!, t1 = P[3 * q + axis]!;
    const lo = Math.min(t0, t1), hi = Math.max(t0, t1);
    // First index with t > lo.
    let a = 0, b = l.length;
    while (a < b) {
      const mid = (a + b) >> 1;
      if (P[3 * l[mid]! + axis]! > lo) b = mid;
      else a = mid + 1;
    }
    const out: number[] = [];
    for (let i = a; i < l.length && P[3 * l[i]! + axis]! < hi; i++) out.push(l[i]!);
    return t1 < t0 ? out.reverse() : out;
  };

  let tris: number[] = [];
  for (let i = 0; i < m.indices.length; i++) tris.push(remap[m.indices[i]!]!);

  for (let round = 0; round < MAX_ROUNDS; round++) {
    const next: number[] = [];
    let changed = false;
    for (let t = 0; t < tris.length; t += 3) {
      const tri = [tris[t]!, tris[t + 1]!, tris[t + 2]!];
      let split = false;
      for (let e = 0; e < 3 && !split; e++) {
        const p = tri[e]!, q = tri[(e + 1) % 3]!, r = tri[(e + 2) % 3]!;
        const pts = interior(p, q);
        if (pts.length === 0) continue;
        let prev = p;
        for (const pt of pts) {
          next.push(prev, pt, r);
          prev = pt;
        }
        next.push(prev, q, r);
        split = true;
        changed = true;
      }
      if (!split) next.push(tri[0]!, tri[1]!, tri[2]!);
    }
    tris = next;
    if (!changed) return { bucketId: m.bucketId, positions: Int32Array.from(P), indices: Uint32Array.from(tris) };
  }
  throw new Error("healTJunctions did not converge");
}
