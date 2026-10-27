// docs/04 §3 + docs/06 §4: generateBinarySTL (D4)
import { describe, expect, it } from "vitest";
import { generateBinarySTL } from "../../exporters/slicerExporters";
import type { ExportBucket } from "../../types/color";
import { cubeMesh, meshFromTris } from "../helpers";

const bucket = (id: number, x = 0): ExportBucket => ({ bucketId: id, name: `Slot ${id}`, hexColor: "#7A797A", mesh: cubeMesh(id, x, 0, 0, 16) });
const HEADER = "VoxelMesh Binary STL - Minecraft Build";

describe("generateBinarySTL", () => {
  it("has the exact layout: 80-byte ASCII header, uint32 count, 50 bytes per triangle", () => {
    const buf = generateBinarySTL([bucket(1)], 4);
    expect(buf.byteLength).toBe(84 + 50 * 12);
    const u8 = new Uint8Array(buf);
    expect(new TextDecoder().decode(u8.subarray(0, HEADER.length))).toBe(HEADER);
    expect(u8.subarray(HEADER.length, 80).every((b) => b === 0)).toBe(true);
    expect(new DataView(buf).getUint32(80, true)).toBe(12);
  });

  it("scales lattice units to millimetres (16 sub-voxels = 1 block = scale mm)", () => {
    const dv = new DataView(generateBinarySTL([bucket(1)], 4));
    let max = 0;
    for (let t = 0; t < 12; t++) for (let v = 0; v < 3; v++) for (let k = 0; k < 3; k++) max = Math.max(max, dv.getFloat32(84 + 50 * t + 12 + 12 * v + 4 * k, true));
    expect(max).toBe(4);
  });

  it("writes unit normals that agree with the winding and point outward; attribute bytes are 0", () => {
    const dv = new DataView(generateBinarySTL([bucket(1)], 4));
    for (let t = 0; t < 12; t++) {
      const o = 84 + 50 * t;
      const n = [0, 1, 2].map((k) => dv.getFloat32(o + 4 * k, true));
      const v = [0, 1, 2].map((i) => [0, 1, 2].map((k) => dv.getFloat32(o + 12 + 12 * i + 4 * k, true)));
      expect(Math.hypot(n[0]!, n[1]!, n[2]!)).toBeCloseTo(1, 5);
      const e1 = v[1]!.map((x, k) => x - v[0]![k]!), e2 = v[2]!.map((x, k) => x - v[0]![k]!);
      const cr = [e1[1]! * e2[2]! - e1[2]! * e2[1]!, e1[2]! * e2[0]! - e1[0]! * e2[2]!, e1[0]! * e2[1]! - e1[1]! * e2[0]!];
      expect(cr[0]! * n[0]! + cr[1]! * n[1]! + cr[2]! * n[2]!).toBeGreaterThan(0); // normal matches winding
      const cen = [0, 1, 2].map((k) => (v[0]![k]! + v[1]![k]! + v[2]![k]!) / 3 - 2);
      expect(n[0]! * cen[0]! + n[1]! * cen[1]! + n[2]! * cen[2]!).toBeGreaterThan(0); // outward
      expect(dv.getUint16(o + 48, true)).toBe(0);
    }
  });

  it("concatenates several buckets without dedup", () => {
    const buf = generateBinarySTL([bucket(1), bucket(2, 16)], 4);
    expect(new DataView(buf).getUint32(80, true)).toBe(24);
    expect(buf.byteLength).toBe(84 + 50 * 24);
  });

  it("throws on degenerate triangles", () => {
    const bad: ExportBucket = { bucketId: 1, name: "bad", hexColor: "#000000", mesh: meshFromTris(1, [[[0, 0, 0], [1, 0, 0], [2, 0, 0]]]) };
    expect(() => generateBinarySTL([bad], 4)).toThrow();
  });

  it("is deterministic", () => {
    expect(new Uint8Array(generateBinarySTL([bucket(1)], 4))).toEqual(new Uint8Array(generateBinarySTL([bucket(1)], 4)));
  });
});
