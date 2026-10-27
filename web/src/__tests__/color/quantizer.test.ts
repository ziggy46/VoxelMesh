// docs/04 §1: quantizePaletteToSlots (D3)
// Contract decisions: bucket ids 1..K are assigned by descending voxelCount (ties: lowest member palette index);
// hexColor is uppercase "#RRGGBB"; names look like "Slot 1 – Stone Gray (#7A797A)".
import { describe, expect, it } from "vitest";
import { quantizePaletteToSlots } from "../../worker/colorQuantizer";

const pal = (...colors: Array<string | null>) => [{ color: null as string | null }, ...colors.map((color) => ({ color }))];
const counts = (...n: number[]) => Uint32Array.from([0, ...n]);
const rgb = (hex: string) => [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16)) as [number, number, number];

describe("quantizePaletteToSlots", () => {
  it("gives one bucket per distinct colour when they fit, and air maps to 0", () => {
    const r = quantizePaletteToSlots(pal("#7a797a", "#a12722", "#35399d"), counts(50, 30, 20), 4);
    expect(r.buckets.map((b) => b.bucketId)).toEqual([1, 2, 3]);
    expect(r.buckets.map((b) => b.hexColor)).toEqual(["#7A797A", "#A12722", "#35399D".toUpperCase()]);
    expect(r.buckets.map((b) => b.voxelCount)).toEqual([50, 30, 20]);
    expect(Array.from(r.paletteToBucketMap)).toEqual([0, 1, 2, 3]);
  });

  it("merges identical hex values from different palette entries", () => {
    const r = quantizePaletteToSlots(pal("#ff0000", "#00ff00", "#FF0000"), counts(5, 7, 4), 4);
    expect(r.buckets).toHaveLength(2);
    const red = r.buckets.find((b) => b.hexColor === "#FF0000")!;
    expect(red.paletteIndices.slice().sort()).toEqual([1, 3]);
    expect(red.voxelCount).toBe(9);
    expect(r.paletteToBucketMap[1]).toBe(r.paletteToBucketMap[3]);
  });

  it("orders buckets by descending voxel count, ties by lowest palette index", () => {
    const r = quantizePaletteToSlots(pal("#111111", "#999999", "#eeeeee"), counts(5, 10, 5), 4);
    expect(r.buckets.map((b) => b.paletteIndices[0])).toEqual([2, 1, 3]);
    expect(r.buckets.map((b) => b.bucketId)).toEqual([1, 2, 3]);
  });

  it("skips palette 0, zero-count entries and null colours", () => {
    const palette = [{ color: "#123456" }, { color: "#ff0000" }, { color: null }, { color: "#00ff00" }];
    const r = quantizePaletteToSlots(palette, Uint32Array.from([99, 4, 8, 0]), 4);
    expect(r.buckets).toHaveLength(1);
    expect(Array.from(r.paletteToBucketMap)).toEqual([0, 1, 0, 0]);
  });

  it("returns no buckets when nothing has voxels", () => {
    const r = quantizePaletteToSlots(pal("#ff0000"), counts(0), 4);
    expect(r.buckets).toEqual([]);
    expect(Array.from(r.paletteToBucketMap)).toEqual([0, 0]);
  });

  it("maxSlots = 1 gives a single bucket whose centroid is the Lab mean (black+white -> mid grey)", () => {
    const r = quantizePaletteToSlots(pal("#000000", "#ffffff"), counts(10, 10), 1);
    expect(r.buckets).toHaveLength(1);
    expect(r.buckets[0]!.paletteIndices.slice().sort()).toEqual([1, 2]);
    expect(r.buckets[0]!.voxelCount).toBe(20);
    for (const ch of rgb(r.buckets[0]!.hexColor)) expect(Math.abs(ch - 0x77)).toBeLessThanOrEqual(2);
    expect(Array.from(r.paletteToBucketMap)).toEqual([0, 1, 1]);
  });

  it("clusters reds together and blues together when asked for 2 slots", () => {
    const reds = ["#ff0000", "#ee1111", "#dd0000", "#ff2200"];
    const blues = ["#0000ff", "#1111ee", "#0000dd", "#2200ff"];
    const r = quantizePaletteToSlots(pal(...reds, ...blues), counts(10, 9, 8, 7, 5, 4, 3, 2), 2);
    expect(r.buckets).toHaveLength(2);
    const m = r.paletteToBucketMap;
    expect(new Set([m[1], m[2], m[3], m[4]]).size).toBe(1);
    expect(new Set([m[5], m[6], m[7], m[8]]).size).toBe(1);
    expect(m[1]).toBe(1); // reds total 34 > blues 14
    expect(m[5]).toBe(2);
    const [R, , B] = rgb(r.buckets[0]!.hexColor);
    expect(R).toBeGreaterThan(200);
    expect(B).toBeLessThan(40);
    expect(r.buckets.reduce((s, b) => s + b.voxelCount, 0)).toBe(48);
  });

  it("reduces 35 colours to 16 non-empty slots with a consistent map", () => {
    const colors = Array.from({ length: 35 }, (_, i) => "#" + [(i * 37) % 256, (i * 91) % 256, (i * 53) % 256].map((v) => v.toString(16).padStart(2, "0")).join(""));
    const c = Array.from({ length: 35 }, (_, i) => 1 + (i % 5));
    const r = quantizePaletteToSlots(pal(...colors), counts(...c), 16);
    expect(r.buckets).toHaveLength(16);
    expect(r.buckets.map((b) => b.bucketId)).toEqual(Array.from({ length: 16 }, (_, i) => i + 1));
    const seen = new Set<number>();
    for (const b of r.buckets) {
      expect(b.paletteIndices.length).toBeGreaterThan(0);
      for (const pi of b.paletteIndices) {
        expect(r.paletteToBucketMap[pi]).toBe(b.bucketId);
        seen.add(pi);
      }
    }
    expect(seen.size).toBe(35);
    expect(r.buckets.reduce((s, b) => s + b.voxelCount, 0)).toBe(c.reduce((a, b) => a + b, 0));
    expect(r.paletteToBucketMap).toHaveLength(36);
  });

  it("is deterministic", () => {
    const colors = Array.from({ length: 20 }, (_, i) => "#" + [(i * 41) % 256, (i * 17) % 256, (i * 101) % 256].map((v) => v.toString(16).padStart(2, "0")).join(""));
    const c = Array.from({ length: 20 }, (_, i) => 3 + (i % 4));
    const a = quantizePaletteToSlots(pal(...colors), counts(...c), 4);
    const b = quantizePaletteToSlots(pal(...colors), counts(...c), 4);
    expect(b).toEqual(a);
  });

  it("names slots from a built-in table: 'Slot N – <name> (#RRGGBB)'", () => {
    const r = quantizePaletteToSlots(pal("#ff0000", "#000000", "#ffffff"), counts(3, 2, 1), 4);
    expect(r.buckets[0]!.name).toMatch(/^Slot 1 – .*Red.* \(#FF0000\)$/i);
    expect(r.buckets[1]!.name).toMatch(/^Slot 2 – .*Black.* \(#000000\)$/i);
    expect(r.buckets[2]!.name).toMatch(/^Slot 3 – .*White.* \(#FFFFFF\)$/i);
  });
});
