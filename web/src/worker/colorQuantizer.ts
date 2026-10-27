// docs/04 §1: deterministic weighted K-Means++ in CIE L*a*b* (D65, CIE76 distance). No randomness, no network.
import type { FilamentSlotBucket, QuantizationResult } from "../types/color";

type Lab = [number, number, number];

const WHITE = [0.95047, 1.0, 1.08883] as const; // D65

const toLinear = (c: number) => (c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4));
const fromLinear = (c: number) => (c <= 0.0031308 ? 12.92 * c : 1.055 * Math.pow(c, 1 / 2.4) - 0.055);
const labF = (t: number) => (t > 216 / 24389 ? Math.cbrt(t) : (24389 / 27 * t + 16) / 116);
const labFInv = (t: number) => (t * t * t > 216 / 24389 ? t * t * t : (116 * t - 16) / (24389 / 27));

function hexToRgb(hex: string): [number, number, number] {
  const v = parseInt(hex.slice(1), 16);
  return [(v >> 16) & 255, (v >> 8) & 255, v & 255];
}

function rgbToHex(r: number, g: number, b: number): string {
  return "#" + [r, g, b].map((v) => v.toString(16).padStart(2, "0")).join("").toUpperCase();
}

function hexToLab(hex: string): Lab {
  const [r, g, b] = hexToRgb(hex).map((v) => toLinear(v / 255)) as [number, number, number];
  const x = 0.4124564 * r + 0.3575761 * g + 0.1804375 * b;
  const y = 0.2126729 * r + 0.7151522 * g + 0.072175 * b;
  const z = 0.0193339 * r + 0.119192 * g + 0.9503041 * b;
  const fx = labF(x / WHITE[0]), fy = labF(y / WHITE[1]), fz = labF(z / WHITE[2]);
  return [116 * fy - 16, 500 * (fx - fy), 200 * (fy - fz)];
}

function labToHex(lab: Lab): string {
  const fy = (lab[0] + 16) / 116, fx = fy + lab[1] / 500, fz = fy - lab[2] / 200;
  const x = labFInv(fx) * WHITE[0], y = labFInv(fy) * WHITE[1], z = labFInv(fz) * WHITE[2];
  const lin = [
    3.2404542 * x - 1.5371385 * y - 0.4985314 * z,
    -0.969266 * x + 1.8760108 * y + 0.041556 * z,
    0.0556434 * x - 0.2040259 * y + 1.0572252 * z,
  ];
  const [r, g, b] = lin.map((c) => Math.round(Math.min(1, Math.max(0, fromLinear(Math.min(1, Math.max(0, c))))) * 255)) as [number, number, number];
  return rgbToHex(r, g, b);
}

const dist2 = (a: Lab, b: Lab) => (a[0] - b[0]) ** 2 + (a[1] - b[1]) ** 2 + (a[2] - b[2]) ** 2;

const NAMES: ReadonlyArray<readonly [string, string]> = [
  ["White", "#FFFFFF"], ["Light Gray", "#C0C0C0"], ["Gray", "#808080"], ["Stone Gray", "#7A797A"], ["Dark Gray", "#404040"],
  ["Black", "#000000"], ["Brown", "#8B5A2B"], ["Dark Brown", "#4E3524"], ["Tan", "#D2B48C"], ["Red", "#FF0000"],
  ["Dark Red", "#8B1A1A"], ["Orange", "#FFA500"], ["Yellow", "#FFFF00"], ["Gold", "#E6B800"], ["Lime", "#80FF00"],
  ["Green", "#2E9E2E"], ["Dark Green", "#1E5E1E"], ["Cyan", "#00FFFF"], ["Teal", "#008080"], ["Light Blue", "#87CEEB"],
  ["Blue", "#0000FF"], ["Dark Blue", "#00008B"], ["Purple", "#800080"], ["Magenta", "#FF00FF"], ["Pink", "#FFC0CB"],
];
const NAME_LABS = NAMES.map(([, hex]) => hexToLab(hex));

function nameFor(lab: Lab): string {
  let best = 0, bestD = Infinity;
  for (let i = 0; i < NAMES.length; i++) {
    const d = dist2(lab, NAME_LABS[i]!);
    if (d < bestD) {
      bestD = d;
      best = i;
    }
  }
  return NAMES[best]![0];
}

/** One distinct colour: palette entries with the same hex are merged. */
interface Point {
  hex: string;
  lab: Lab;
  weight: number;
  indices: number[]; // ascending
}

export function quantizePaletteToSlots(
  palette: Array<{ color: string | null }>,
  voxelCounts: Uint32Array,
  maxSlots: number,
): QuantizationResult {
  const paletteToBucketMap = new Uint16Array(palette.length);

  // 1. Distinct colours with voxels (palette 0, null colours, zero counts skipped).
  const byHex = new Map<string, Point>();
  for (let i = 1; i < palette.length; i++) {
    const color = palette[i]!.color;
    const count = voxelCounts[i] ?? 0;
    if (color === null || count === 0) continue;
    const hex = color.toUpperCase();
    let p = byHex.get(hex);
    if (!p) byHex.set(hex, (p = { hex, lab: hexToLab(hex), weight: 0, indices: [] }));
    p.weight += count;
    p.indices.push(i);
  }
  const points = [...byHex.values()].sort((a, b) => a.indices[0]! - b.indices[0]!); // stable order: lowest palette index
  if (points.length === 0 || maxSlots < 1) return { buckets: [], paletteToBucketMap };

  // 2. Cluster.
  const k = Math.min(Math.floor(maxSlots), points.length);
  const assign = new Int32Array(points.length);
  let centroids: Lab[] = [];

  if (points.length > k) {
    // K-means++ seeding: highest weight first, then max w * minDist^2; ties -> lowest index (points are index-ordered).
    const seeds: number[] = [];
    let first = 0;
    for (let i = 1; i < points.length; i++) if (points[i]!.weight > points[first]!.weight) first = i;
    seeds.push(first);
    const minD = points.map((p) => dist2(p.lab, points[first]!.lab));
    while (seeds.length < k) {
      let best = -1, bestScore = -1;
      for (let i = 0; i < points.length; i++) {
        if (seeds.includes(i)) continue;
        const score = points[i]!.weight * minD[i]!;
        if (score > bestScore) {
          bestScore = score;
          best = i;
        }
      }
      seeds.push(best);
      for (let i = 0; i < points.length; i++) minD[i] = Math.min(minD[i]!, dist2(points[i]!.lab, points[best]!.lab));
    }
    centroids = seeds.map((s) => [...points[s]!.lab] as Lab);
    assign.fill(-1);

    for (let iter = 0; iter < 30; iter++) {
      let changed = false;
      for (let i = 0; i < points.length; i++) {
        let best = 0, bestD = Infinity;
        for (let c = 0; c < k; c++) {
          const d = dist2(points[i]!.lab, centroids[c]!);
          if (d < bestD) {
            bestD = d;
            best = c;
          }
        }
        if (assign[i] !== best) {
          assign[i] = best;
          changed = true;
        }
      }
      // Weighted centroid update; an empty cluster takes the point farthest from its own centroid.
      const sum: Lab[] = Array.from({ length: k }, () => [0, 0, 0] as Lab);
      const w = new Array<number>(k).fill(0);
      const size = new Array<number>(k).fill(0);
      for (let i = 0; i < points.length; i++) {
        const c = assign[i]!, p = points[i]!;
        sum[c]![0] += p.lab[0] * p.weight; sum[c]![1] += p.lab[1] * p.weight; sum[c]![2] += p.lab[2] * p.weight;
        w[c]! += p.weight;
        size[c]!++;
      }
      for (let c = 0; c < k; c++) {
        if (size[c] === 0) {
          let far = -1, farD = -1;
          for (let i = 0; i < points.length; i++) {
            if (size[assign[i]!]! < 2) continue;
            const d = dist2(points[i]!.lab, centroids[assign[i]!]!);
            if (d > farD) {
              farD = d;
              far = i;
            }
          }
          if (far >= 0) {
            size[assign[far]!]!--;
            assign[far] = c;
            size[c] = 1;
            centroids[c] = [...points[far]!.lab] as Lab;
            changed = true;
          }
        } else {
          centroids[c] = [sum[c]![0] / w[c]!, sum[c]![1] / w[c]!, sum[c]![2] / w[c]!];
        }
      }
      if (!changed) break;
    }
  } else {
    for (let i = 0; i < points.length; i++) assign[i] = i;
  }

  // 3. Buckets: one per non-empty cluster, ordered by descending voxel count (ties: lowest palette index).
  interface Cluster { members: Point[]; }
  const clusters: Cluster[] = Array.from({ length: k }, () => ({ members: [] }));
  for (let i = 0; i < points.length; i++) clusters[assign[i]!]!.members.push(points[i]!);
  const built = clusters
    .filter((c) => c.members.length > 0)
    .map((c) => {
      const indices = c.members.flatMap((m) => m.indices).sort((a, b) => a - b);
      const voxelCount = c.members.reduce((s, m) => s + m.weight, 0);
      let hex: string;
      let lab: Lab;
      if (c.members.length === 1) {
        hex = c.members[0]!.hex;
        lab = c.members[0]!.lab;
      } else {
        const sum: Lab = [0, 0, 0];
        for (const m of c.members) for (let a = 0; a < 3; a++) sum[a]! += m.lab[a]! * m.weight;
        lab = [sum[0] / voxelCount, sum[1] / voxelCount, sum[2] / voxelCount];
        hex = labToHex(lab);
      }
      return { indices, voxelCount, hex, lab };
    })
    .sort((a, b) => b.voxelCount - a.voxelCount || a.indices[0]! - b.indices[0]!);

  const buckets: FilamentSlotBucket[] = built.map((b, i) => {
    const bucketId = i + 1;
    for (const pi of b.indices) paletteToBucketMap[pi] = bucketId;
    return {
      bucketId,
      name: `Slot ${bucketId} – ${nameFor(b.lab)} (${b.hex})`,
      hexColor: b.hex,
      paletteIndices: b.indices,
      voxelCount: b.voxelCount,
    };
  });
  return { buckets, paletteToBucketMap };
}
