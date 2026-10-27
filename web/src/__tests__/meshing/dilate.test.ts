// docs/03 §2: dilateThinFeatures (D1). minSub = ceil(minNozzleWallMm / scaleMmPerBlock * 16).
import { describe, expect, it } from "vitest";
import { dilateThinFeatures } from "../../worker/meshingKernel/dilate";
import { DEFAULT_FDM_OPTIONS, DEFAULT_RESIN_OPTIONS } from "../../types/mesh";
import type { SubVoxelBox } from "../../types/voxelPayload";

const fdm = DEFAULT_FDM_OPTIONS; // 0.8 mm wall at 4 mm/block -> 4 sub-voxels

describe("dilateThinFeatures", () => {
  it("leaves everything alone in Resin mode", () => {
    const boxes: SubVoxelBox[] = [[7, 0, 7, 9, 16, 9]];
    expect(dilateThinFeatures(boxes, DEFAULT_RESIN_OPTIONS)).toEqual(boxes);
  });

  it("grows a 2-wide post symmetrically to 4", () => {
    expect(dilateThinFeatures([[7, 0, 7, 9, 16, 9]], fdm)).toEqual([[6, 0, 6, 10, 16, 10]]);
  });

  it("shifts the remainder inward at a block edge so the width still reaches minSub", () => {
    expect(dilateThinFeatures([[0, 0, 0, 2, 16, 16]], fdm)).toEqual([[0, 0, 0, 4, 16, 16]]);
    expect(dilateThinFeatures([[14, 0, 0, 16, 16, 16]], fdm)).toEqual([[12, 0, 0, 16, 16, 16]]);
    expect(dilateThinFeatures([[0, 0, 14, 16, 16, 16]], fdm)).toEqual([[0, 0, 12, 16, 16, 16]]);
  });

  it("only touches the offending axis and never touches Y", () => {
    expect(dilateThinFeatures([[7, 0, 0, 9, 16, 16]], fdm)).toEqual([[6, 0, 0, 10, 16, 16]]);
    expect(dilateThinFeatures([[0, 0, 0, 16, 1, 16]], fdm)).toEqual([[0, 0, 0, 16, 1, 16]]); // thin in Y only
    expect(dilateThinFeatures([[3, 5, 3, 9, 6, 9]], fdm)).toEqual([[3, 5, 3, 9, 6, 9]]); // already 6 wide
  });

  it("odd deficits still reach minSub, contain the original, and stay inside the block", () => {
    const [out] = dilateThinFeatures([[7, 0, 7, 10, 16, 10]], fdm);
    expect(out![3] - out![0]).toBeGreaterThanOrEqual(4);
    expect(out![5] - out![2]).toBeGreaterThanOrEqual(4);
    expect(out![0]).toBeLessThanOrEqual(7);
    expect(out![3]).toBeGreaterThanOrEqual(10);
    for (const v of out!) {
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThanOrEqual(16);
    }
  });

  it("minSub follows the scale: 8 mm/block -> 2, 1 mm/block -> 13", () => {
    const [a] = dilateThinFeatures([[7, 0, 7, 8, 16, 8]], { ...fdm, scaleMmPerBlock: 8 });
    expect(a![3] - a![0]).toBe(2);
    expect(a![5] - a![2]).toBe(2);
    const [b] = dilateThinFeatures([[7, 0, 7, 9, 16, 9]], { ...fdm, scaleMmPerBlock: 1 });
    expect(b![3] - b![0]).toBe(13);
    expect(b![5] - b![2]).toBe(13);
    expect(b![0]).toBeGreaterThanOrEqual(0);
    expect(b![3]).toBeLessThanOrEqual(16);
  });

  it("is pure, idempotent and deterministic", () => {
    const input: SubVoxelBox[] = [[7, 0, 7, 9, 16, 9], [0, 0, 0, 16, 8, 16]];
    const copy = JSON.parse(JSON.stringify(input));
    const once = dilateThinFeatures(input, fdm);
    expect(input).toEqual(copy);
    expect(once).not.toBe(input);
    expect(dilateThinFeatures(once, fdm)).toEqual(once);
    expect(dilateThinFeatures(input, fdm)).toEqual(once);
  });
});
