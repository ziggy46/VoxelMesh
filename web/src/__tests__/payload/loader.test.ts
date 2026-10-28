import { describe, expect, it } from "vitest";
import { B } from "../../samples/blocks";
import { PayloadBuilder } from "../../samples/builder";
import { sampleCastlePayload } from "../../samples/sampleCastlePayload";
import {
  PayloadError, base64ToBytes, crc32, decodeVoxels, encodeVoxels, gzip, loadPayloadBytes, parsePayload, serializePayload,
} from "../../payload/loader";
import type { VoxelPayload } from "../../types/voxelPayload";

const small = (): VoxelPayload =>
  new PayloadBuilder("t", [2, 2, 2]).set(0, 0, 0, B.stone).set(1, 1, 1, B.stoneSlab).build();
const clone = (p: VoxelPayload) => JSON.parse(JSON.stringify(p)) as VoxelPayload;
const rejects = (mutate: (p: any) => void, msg: RegExp) => {
  const p = clone(small()) as any;
  mutate(p);
  expect(() => parsePayload(p)).toThrow(PayloadError);
  expect(() => parsePayload(p)).toThrow(msg);
};

describe("crc32 / base64", () => {
  it("matches the IEEE test vector", () => {
    expect(crc32(new TextEncoder().encode("123456789"))).toBe("cbf43926");
    expect(crc32(new Uint8Array(0))).toBe("00000000");
  });
  it("round-trips voxels little-endian", () => {
    const v = Uint16Array.from([0, 1, 258, 65534]);
    const { base64 } = encodeVoxels(v);
    expect(Array.from(base64ToBytes(base64))).toEqual([0, 0, 1, 0, 2, 1, 254, 255]);
    expect(Array.from(decodeVoxels(base64))).toEqual(Array.from(v));
  });
});

describe("parsePayload", () => {
  it("accepts a valid payload and indexes voxels as x + z*sx + y*sx*sz", () => {
    const { payload, voxels, warnings } = parsePayload(small());
    expect(warnings).toEqual([]);
    expect(payload.palette[0]!.id).toBe("minecraft:air");
    expect(voxels.length).toBe(8);
    expect(voxels[0]).toBe(1); // (0,0,0)
    expect(voxels[1 + 1 * 2 + 1 * 4]).toBe(2); // (1,1,1)
  });

  it("accepts the sample castle", () => {
    const { payload, warnings } = parsePayload(sampleCastlePayload);
    expect(payload.dimensions).toEqual([24, 16, 24]);
    expect(warnings).toEqual([]);
  });

  it("rejects bad version", () => rejects((p) => (p.version = 2), /version/));
  it("rejects palette[0] that is not air", () => rejects((p) => (p.palette[0].id = "minecraft:stone"), /air/));
  it("rejects a box with max <= min", () => rejects((p) => (p.palette[1].boxes[0] = [0, 0, 0, 0, 16, 16]), /max <= min/));
  it("rejects a box outside 0..16", () => rejects((p) => (p.palette[1].boxes[0] = [0, 0, 0, 17, 16, 16]), /0\.\.16/));
  it("rejects a non-integer box coordinate", () => rejects((p) => (p.palette[1].boxes[0] = [0, 0, 0.5, 16, 16, 16]), /0\.\.16/));
  it("rejects a wrong voxel byte length", () => rejects((p) => (p.dimensions = [3, 2, 2]), /byte length/));
  it("rejects a voxel index beyond the palette", () => {
    const p = clone(small());
    const v = decodeVoxels(p.voxelsBase64);
    v[3] = 99;
    const enc = encodeVoxels(v);
    p.voxelsBase64 = enc.base64;
    p.voxelsCrc32 = enc.crc32;
    expect(() => parsePayload(p)).toThrow(/palette index 99/);
  });
  it("rejects a CRC mismatch", () => rejects((p) => (p.voxelsCrc32 = "deadbeef"), /CRC/));
  it("accepts a payload without a CRC", () => {
    const p = clone(small());
    delete p.voxelsCrc32;
    expect(() => parsePayload(p)).not.toThrow();
  });
  it("rejects non-base64 voxel data", () => rejects((p) => (p.voxelsBase64 = "!!!!"), /base64/));
  it("rejects a malformed colour", () => rejects((p) => (p.palette[1].color = "red"), /color/));
  it("rejects an unknown category", () => rejects((p) => (p.palette[1].category = "magic"), /category/));

  it("hard-gates selections above 128^3 blocks before decoding", () => {
    const p = clone(small());
    p.dimensions = [129, 128, 128];
    expect(() => parsePayload(p)).toThrow(/limit/);
  });

  it("warns above 64^3 blocks", () => {
    const dims: [number, number, number] = [65, 64, 64];
    const total = dims[0] * dims[1] * dims[2];
    const { base64, crc32: crc } = encodeVoxels(new Uint16Array(total));
    const p = { ...small(), dimensions: dims, voxelsBase64: base64, voxelsCrc32: crc };
    expect(parsePayload(p).warnings.join(" ")).toMatch(/large selection/);
  });
});

describe("loadPayloadBytes", () => {
  it("loads plain JSON and gzipped JSON identically", async () => {
    const bytes = serializePayload(small());
    const plain = await loadPayloadBytes(bytes);
    const zipped = await loadPayloadBytes(await gzip(bytes));
    expect(Array.from(zipped.voxels)).toEqual(Array.from(plain.voxels));
    expect(zipped.payload.metadata.title).toBe("t");
  });
  it("reports invalid JSON and corrupt gzip as PayloadError", async () => {
    await expect(loadPayloadBytes(new TextEncoder().encode("{nope"))).rejects.toThrow(PayloadError);
    await expect(loadPayloadBytes(Uint8Array.from([0x1f, 0x8b, 1, 2, 3]))).rejects.toThrow(PayloadError);
  });
});

describe("palette relief field", () => {
  const good = () => {
    const p = clone(small()) as any;
    p.palette[1].relief = btoa(String.fromCharCode(...new Uint8Array(1536).fill(128)));
    return p;
  };
  it("accepts a 1536-byte base64 relief and keeps it", () => {
    const { payload } = parsePayload(good());
    expect(payload.palette[1]!.relief).toBeTypeOf("string");
  });
  it("rejects a relief of the wrong length or type", () => {
    const short = good();
    short.palette[1].relief = btoa("abc");
    expect(() => parsePayload(short)).toThrow(/relief/);
    const wrong = good();
    wrong.palette[1].relief = 5;
    expect(() => parsePayload(wrong)).toThrow(/relief/);
  });
  it("payloads without relief still load", () => {
    expect(() => parsePayload(small())).not.toThrow();
  });
});

describe("palette tags field", () => {
  const withTags = (tags: unknown) => {
    const p = clone(small()) as any;
    p.palette[1].tags = tags;
    return p;
  };
  it("accepts a short list of strings and keeps it", () => {
    expect(parsePayload(withTags(["glass"])).payload.palette[1]!.tags).toEqual(["glass"]);
  });
  it("rejects a non-array, non-string items, too many or too long tags", () => {
    expect(() => parsePayload(withTags("glass"))).toThrow(/tags/);
    expect(() => parsePayload(withTags([1]))).toThrow(/tags/);
    expect(() => parsePayload(withTags(Array.from({ length: 17 }, () => "x")))).toThrow(/tags/);
    expect(() => parsePayload(withTags(["x".repeat(33)]))).toThrow(/tags/);
  });
  it("payloads without tags still load", () => {
    expect(() => parsePayload(small())).not.toThrow();
  });
});

