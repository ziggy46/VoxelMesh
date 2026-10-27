// docs/06 §1: manifold validator, the hard gate for export.
// Each directed edge (a,b) of a welded mesh must appear exactly once and its reverse (b,a) exactly once.
import type { ColorBucketMesh, ManifoldReport } from "../types/mesh";

export type { ManifoldReport } from "../types/mesh";

export function validateMesh(m: ColorBucketMesh): ManifoldReport {
  const P = m.positions, I = m.indices;
  const nv = P.length / 3;
  const nt = Math.floor(I.length / 3);

  // Directed edge keys a*nv+b (exact in a double while nv < ~9e7), sorted so duplicates and reverses are found by search.
  const keys = new Float64Array(3 * nt);
  const parent = new Int32Array(nv);
  for (let v = 0; v < nv; v++) parent[v] = v;
  const find = (v: number): number => {
    while (parent[v] !== v) {
      parent[v] = parent[parent[v]!]!;
      v = parent[v]!;
    }
    return v;
  };
  const used = new Uint8Array(nv);

  let degenerateTriangles = 0;
  let vol6 = 0;
  for (let t = 0; t < nt; t++) {
    const a = I[3 * t]!, b = I[3 * t + 1]!, c = I[3 * t + 2]!;
    if (a >= nv || b >= nv || c >= nv) throw new RangeError(`triangle ${t} references a vertex outside the mesh`);
    keys[3 * t] = a * nv + b;
    keys[3 * t + 1] = b * nv + c;
    keys[3 * t + 2] = c * nv + a;
    used[a] = used[b] = used[c] = 1;
    const ra = find(a), rb = find(b), rc = find(c);
    if (ra !== rb) parent[rb] = ra;
    if (find(a) !== rc) parent[rc] = find(a);

    const ax = P[3 * a]!, ay = P[3 * a + 1]!, az = P[3 * a + 2]!;
    const bx = P[3 * b]!, by = P[3 * b + 1]!, bz = P[3 * b + 2]!;
    const cx = P[3 * c]!, cy = P[3 * c + 1]!, cz = P[3 * c + 2]!;
    const ux = bx - ax, uy = by - ay, uz = bz - az, vx = cx - ax, vy = cy - ay, vz = cz - az;
    if (uy * vz - uz * vy === 0 && uz * vx - ux * vz === 0 && ux * vy - uy * vx === 0) degenerateTriangles++;
    vol6 += ax * (by * cz - bz * cy) - ay * (bx * cz - bz * cx) + az * (bx * cy - by * cx);
  }

  keys.sort();
  const has = (key: number): boolean => {
    let lo = 0, hi = keys.length;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (keys[mid]! < key) lo = mid + 1;
      else hi = mid;
    }
    return lo < keys.length && keys[lo] === key;
  };

  let openEdges = 0;
  let nonManifoldEdges = 0;
  for (let i = 0; i < keys.length; ) {
    const key = keys[i]!;
    let j = i + 1;
    while (j < keys.length && keys[j] === key) j++;
    const count = j - i;
    if (count > 1) nonManifoldEdges += count - 1;
    const a = Math.floor(key / nv), b = key - a * nv;
    if (!has(b * nv + a)) openEdges += count;
    i = j;
  }

  let components = 0;
  for (let v = 0; v < nv; v++) if (used[v] === 1 && find(v) === v) components++;

  const signedVolume = vol6 / 6;
  return {
    bucketId: m.bucketId,
    triangles: nt,
    openEdges,
    nonManifoldEdges,
    degenerateTriangles,
    signedVolume,
    components,
    ok: openEdges === 0 && nonManifoldEdges === 0 && degenerateTriangles === 0 && signedVolume > 0,
  };
}

export function validateAll(ms: ColorBucketMesh[]): ManifoldReport[] {
  return ms.map(validateMesh);
}
