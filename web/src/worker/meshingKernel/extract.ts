// docs/03 §5: hidden-face culling + greedy meshing, one closed mesh per bucket.
//
// For each of the 6 directions and each slice, cell A (>0) shows a face toward neighbour B iff B !== A; BOTH buckets emit a
// shared colour boundary. Slices are only built for chunks that can show a face: a uniform chunk shows faces only on the one
// layer touching a different neighbour, so uniform interiors cost nothing. Greedy rectangles may span chunk boundaries.
import type { ColorBucketMesh, SparseGrid } from "../../types/mesh";
import { SUB } from "../../types/mesh";

/** Per-axis strides inside a chunk (idx = lx + ly*16 + lz*256) and the two in-plane axes for a face normal along each axis. */
const STRIDE = [1, 16, 256] as const;
const PLANE_AXES = [[1, 2], [0, 2], [0, 1]] as const;

class Builder {
  readonly index = new Map<number, number>();
  readonly pos: number[] = [];
  readonly idx: number[] = [];

  vertex(x: number, y: number, z: number): number {
    const key = x * 16777216 + y * 4096 + z; // lattice coordinates are < 4096 (128 blocks * 16 = 2048)
    let i = this.index.get(key);
    if (i === undefined) {
      i = this.pos.length / 3;
      this.index.set(key, i);
      this.pos.push(x, y, z);
    }
    return i;
  }
}

export function extractMeshes(g: SparseGrid): ColorBucketMesh[] {
  const B = g.blocks;
  const cells = g.cells;
  const builders = new Map<number, Builder>();
  const builderFor = (id: number): Builder => {
    let b = builders.get(id);
    if (!b) {
      b = new Builder();
      builders.set(id, b);
    }
    return b;
  };

  const emit = (id: number, a: number, ua: number, va: number, plane: number, u0: number, v0: number, w: number, h: number, sgn: number) => {
    const b = builderFor(id);
    const corner = (u: number, v: number): number => {
      const c: [number, number, number] = [0, 0, 0];
      c[a] = plane;
      c[ua] = u;
      c[va] = v;
      return b.vertex(c[0], c[1], c[2]);
    };
    // (u,v,a) is right-handed only for a = 0 and 2; the natural quad order has normal e_u x e_v = s_a * e_a.
    const sa = a === 1 ? -1 : 1;
    let q = [corner(u0, v0), corner(u0 + w, v0), corner(u0 + w, v0 + h), corner(u0, v0 + h)];
    if (sa !== sgn) q = [q[0]!, q[3]!, q[2]!, q[1]!];
    b.idx.push(q[0]!, q[1]!, q[2]!, q[0]!, q[2]!, q[3]!);
  };

  for (let a = 0; a < 3; a++) {
    const [ua, va] = PLANE_AXES[a]!;
    const Ba = B[a]!, Bu = B[ua]!, Bv = B[va]!;
    const Uc = Bu * SUB, Vc = Bv * SUB;
    const sA = STRIDE[a]!, sU = STRIDE[ua]!, sV = STRIDE[va]!;
    let mask: Uint16Array | null = null;

    const chunkAt = (ca: number, cu: number, cv: number): number | Uint16Array => {
      const cc: [number, number, number] = [0, 0, 0];
      cc[a] = ca;
      cc[ua] = cu;
      cc[va] = cv;
      return cells[cc[0] + cc[1] * B[0]! + cc[2] * B[0]! * B[1]!]!;
    };

    for (const sgn of [1, -1]) {
      const edgeLs = sgn > 0 ? 15 : 0; // local slice touching the neighbour chunk
      const nbLs = sgn > 0 ? 0 : 15; // neighbour's slice facing us
      for (let ca = 0; ca < Ba; ca++) {
        // Chunks of this layer that can show a face, in (cv, cu) order.
        const acu: number[] = [], acv: number[] = [], aChunk: Array<number | Uint16Array> = [], aNb: Array<number | Uint16Array> = [];
        for (let cv = 0; cv < Bv; cv++)
          for (let cu = 0; cu < Bu; cu++) {
            const c = chunkAt(ca, cu, cv);
            if (c === 0) continue;
            const na = ca + sgn;
            const nb: number | Uint16Array = na >= 0 && na < Ba ? chunkAt(na, cu, cv) : 0;
            if (typeof c === "number" && nb === c) continue;
            acu.push(cu); acv.push(cv); aChunk.push(c); aNb.push(nb);
          }
        if (acu.length === 0) continue;
        if (mask === null) mask = new Uint16Array(Uc * Vc);

        for (let ls = 0; ls < SUB; ls++) {
          // Fill the face mask for this slice.
          const live: number[] = [];
          for (let k = 0; k < acu.length; k++) {
            const c = aChunk[k]!, nb = aNb[k]!;
            const gu0 = acu[k]! * SUB, gv0 = acv[k]! * SUB;
            let any = false;
            if (typeof c === "number") {
              if (ls !== edgeLs) continue;
              for (let lv = 0; lv < SUB; lv++)
                for (let lu = 0; lu < SUB; lu++) {
                  const nv = typeof nb === "number" ? nb : nb[nbLs * sA + lu * sU + lv * sV]!;
                  if (nv !== c) {
                    mask[gu0 + lu + (gv0 + lv) * Uc] = c;
                    any = true;
                  }
                }
            } else {
              for (let lv = 0; lv < SUB; lv++)
                for (let lu = 0; lu < SUB; lu++) {
                  const i = ls * sA + lu * sU + lv * sV;
                  const A = c[i]!;
                  if (A === 0) continue;
                  const ln = ls + sgn;
                  const nv = ln >= 0 && ln < SUB ? c[i + sgn * sA]! : typeof nb === "number" ? nb : nb[nbLs * sA + lu * sU + lv * sV]!;
                  if (nv !== A) {
                    mask[gu0 + lu + (gv0 + lv) * Uc] = A;
                    any = true;
                  }
                }
            }
            if (any) live.push(k);
          }
          if (live.length === 0) continue;

          // Greedy merge in raster order over the live chunks.
          const s = ca * SUB + ls;
          const plane = s + (sgn > 0 ? 1 : 0);
          let k = 0;
          while (k < live.length) {
            const row = acv[live[k]!]!;
            let end = k;
            while (end < live.length && acv[live[end]!] === row) end++;
            for (let lv = 0; lv < SUB; lv++) {
              const gv = row * SUB + lv;
              for (let t = k; t < end; t++) {
                const gu0 = acu[live[t]!]! * SUB;
                for (let lu = 0; lu < SUB; lu++) {
                  const gu = gu0 + lu;
                  const id = mask[gu + gv * Uc]!;
                  if (id === 0) continue;
                  let w = 1;
                  while (gu + w < Uc && mask[gu + w + gv * Uc] === id) w++;
                  let h = 1;
                  grow: while (gv + h < Vc) {
                    for (let i = 0; i < w; i++) if (mask[gu + i + (gv + h) * Uc] !== id) break grow;
                    h++;
                  }
                  for (let j = 0; j < h; j++) mask.fill(0, gu + (gv + j) * Uc, gu + w + (gv + j) * Uc);
                  emit(id, a, ua, va, plane, gu, gv, w, h, sgn);
                }
              }
            }
            k = end;
          }
        }
      }
    }
  }

  return [...builders.keys()]
    .sort((p, q) => p - q)
    .map((bucketId) => {
      const b = builders.get(bucketId)!;
      return { bucketId, positions: Int32Array.from(b.pos), indices: Uint32Array.from(b.idx) };
    });
}
