// Payload loader / validator: docs/01_PAYLOAD_SPEC.md §3
import type { BlockCategory, PaletteEntry, VoxelPayload } from "../types/voxelPayload";
import { MAX_BLOCKS, MAX_PALETTE_ENTRIES, WARN_BLOCKS } from "../types/voxelPayload";

export class PayloadError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "PayloadError";
  }
}

export interface LoadedPayload {
  payload: VoxelPayload;
  /** Decoded voxel palette indices, index = x + z*sizeX + y*(sizeX*sizeZ). */
  voxels: Uint16Array;
  warnings: string[];
}

const CATEGORIES: ReadonlySet<string> = new Set<BlockCategory>([
  "solid", "partial", "thin", "foliage", "fluid", "air",
]);

const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();

/** IEEE CRC32 as 8 lowercase hex digits. */
export function crc32(bytes: Uint8Array): string {
  let c = 0xffffffff;
  for (let i = 0; i < bytes.length; i++) c = CRC_TABLE[(c ^ bytes[i]!) & 0xff]! ^ (c >>> 8);
  return ((c ^ 0xffffffff) >>> 0).toString(16).padStart(8, "0");
}

export function bytesToBase64(bytes: Uint8Array): string {
  let s = "";
  const CH = 0x8000;
  for (let i = 0; i < bytes.length; i += CH) s += String.fromCharCode(...bytes.subarray(i, i + CH));
  return btoa(s);
}

export function base64ToBytes(b64: string): Uint8Array {
  let s: string;
  try {
    s = atob(b64);
  } catch {
    throw new PayloadError("voxelsBase64 is not valid base64");
  }
  const out = new Uint8Array(s.length);
  for (let i = 0; i < s.length; i++) out[i] = s.charCodeAt(i);
  return out;
}

/** Little-endian Uint16 voxel array to raw bytes. */
export function voxelsToBytes(voxels: Uint16Array): Uint8Array {
  const out = new Uint8Array(voxels.length * 2);
  const dv = new DataView(out.buffer);
  for (let i = 0; i < voxels.length; i++) dv.setUint16(i * 2, voxels[i]!, true);
  return out;
}

export function encodeVoxels(voxels: Uint16Array): { base64: string; crc32: string } {
  const bytes = voxelsToBytes(voxels);
  return { base64: bytesToBase64(bytes), crc32: crc32(bytes) };
}

/** Decode a `voxelsBase64` string to palette indices (little-endian Uint16). No range checking; use parsePayload for that. */
export function decodeVoxels(base64: string): Uint16Array {
  const bytes = base64ToBytes(base64);
  if (bytes.length % 2 !== 0) throw new PayloadError("voxel byte length is odd");
  const out = new Uint16Array(bytes.length / 2);
  const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  for (let i = 0; i < out.length; i++) out[i] = dv.getUint16(i * 2, true);
  return out;
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

function fail(msg: string): never {
  throw new PayloadError(msg);
}

function validatePaletteEntry(e: unknown, i: number): PaletteEntry {
  if (!isRecord(e)) fail(`palette[${i}] is not an object`);
  if (typeof e.id !== "string") fail(`palette[${i}].id must be a string`);
  if (typeof e.name !== "string") fail(`palette[${i}].name must be a string`);
  if (e.color !== null && (typeof e.color !== "string" || !/^#[0-9A-Fa-f]{6}$/.test(e.color))) {
    fail(`palette[${i}].color must be null or "#RRGGBB"`);
  }
  if (typeof e.category !== "string" || !CATEGORIES.has(e.category)) {
    fail(`palette[${i}].category is invalid`);
  }
  if (!Array.isArray(e.boxes)) fail(`palette[${i}].boxes must be an array`);
  e.boxes.forEach((b: unknown, j: number) => {
    if (!Array.isArray(b) || b.length !== 6) fail(`palette[${i}].boxes[${j}] must have 6 numbers`);
    for (const n of b) {
      if (!Number.isInteger(n) || n < 0 || n > 16) {
        fail(`palette[${i}].boxes[${j}] has a coordinate outside the integers 0..16`);
      }
    }
    if (b[3] <= b[0] || b[4] <= b[1] || b[5] <= b[2]) {
      fail(`palette[${i}].boxes[${j}] has max <= min`);
    }
  });
  return e as unknown as PaletteEntry;
}

/** Validate an already-parsed JSON value and decode its voxel array. */
export function parsePayload(raw: unknown): LoadedPayload {
  if (!isRecord(raw)) fail("payload is not an object");
  if (raw.version !== 1) fail(`unsupported payload version: ${String(raw.version)}`);

  const md = raw.metadata;
  if (!isRecord(md) || typeof md.title !== "string" || typeof md.mcVersion !== "string" ||
      typeof md.exportedAt !== "string" || !Array.isArray(md.origin) || md.origin.length !== 3 ||
      !md.origin.every((n) => typeof n === "number")) {
    fail("metadata is missing or malformed");
  }

  const dims = raw.dimensions;
  if (!Array.isArray(dims) || dims.length !== 3 || !dims.every((n) => Number.isInteger(n) && n > 0)) {
    fail("dimensions must be three positive integers");
  }
  const [sx, sy, sz] = dims as [number, number, number];
  const total = sx * sy * sz;
  const warnings: string[] = [];
  if (total > MAX_BLOCKS) fail(`selection of ${total} blocks exceeds the ${MAX_BLOCKS} block (128^3) limit`);
  if (total > WARN_BLOCKS) warnings.push(`large selection: ${total} blocks (> 64^3); processing may be slow`);

  const pal = raw.palette;
  if (!Array.isArray(pal) || pal.length === 0) fail("palette must be a non-empty array");
  if (pal.length > MAX_PALETTE_ENTRIES) fail(`palette has more than ${MAX_PALETTE_ENTRIES} entries`);
  const palette = pal.map(validatePaletteEntry);
  if (palette[0]!.id !== "minecraft:air") fail('palette[0].id must be "minecraft:air"');

  if (typeof raw.voxelsBase64 !== "string") fail("voxelsBase64 must be a string");
  const bytes = base64ToBytes(raw.voxelsBase64);
  if (bytes.length !== 2 * total) {
    fail(`voxel byte length ${bytes.length} does not match 2*${sx}*${sy}*${sz} = ${2 * total}`);
  }
  if (raw.voxelsCrc32 !== undefined) {
    if (typeof raw.voxelsCrc32 !== "string") fail("voxelsCrc32 must be a string");
    if (raw.voxelsCrc32.toLowerCase() !== crc32(bytes)) fail("voxel data CRC32 mismatch");
  }

  const voxels = new Uint16Array(total);
  const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  for (let i = 0; i < total; i++) {
    const v = dv.getUint16(i * 2, true);
    if (v >= palette.length) fail(`voxel ${i} references palette index ${v} (palette has ${palette.length})`);
    voxels[i] = v;
  }

  return { payload: { ...(raw as unknown as VoxelPayload), palette }, voxels, warnings };
}

async function pipeBytes(bytes: Uint8Array, stream: GenericTransformStream): Promise<Uint8Array> {
  const piped = new Blob([bytes as BlobPart]).stream().pipeThrough(stream);
  return new Uint8Array(await new Response(piped).arrayBuffer());
}

export const gunzip = (b: Uint8Array) => pipeBytes(b, new DecompressionStream("gzip"));
export const gzip = (b: Uint8Array) => pipeBytes(b, new CompressionStream("gzip"));

/** Load a `.vxm.json` or `.vxm.json.gz` file's bytes (gzip detected by magic number). */
export async function loadPayloadBytes(bytes: Uint8Array): Promise<LoadedPayload> {
  let text: Uint8Array = bytes;
  if (bytes.length >= 2 && bytes[0] === 0x1f && bytes[1] === 0x8b) {
    try {
      text = await gunzip(bytes);
    } catch {
      fail("file looks gzipped but could not be decompressed");
    }
  }
  let json: unknown;
  try {
    json = JSON.parse(new TextDecoder().decode(text));
  } catch {
    fail("payload is not valid JSON");
  }
  return parsePayload(json);
}

export function serializePayload(p: VoxelPayload): Uint8Array {
  return new TextEncoder().encode(JSON.stringify(p));
}
