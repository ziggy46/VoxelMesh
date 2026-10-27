// Synthetic relief maps for the built-in samples and tests, standing in for real Minecraft texture brightness.
// Deterministic: a hash of (face, a, b), no randomness.
import { bytesToBase64 } from "../payload/loader";
import { RELIEF_BYTES } from "../types/voxelPayload";

const hash = (a: number, b: number, c: number): number => {
  let h = (Math.imul(a + 1, 73856093) ^ Math.imul(b + 1, 19349663) ^ Math.imul(c + 1, 83492791)) >>> 0;
  h = Math.imul(h ^ (h >>> 13), 0x5bd1e995) >>> 0;
  return (h ^ (h >>> 15)) / 4294967296;
};

/** Base64 of the 1536-byte payload field from a per-texel luma function. */
export function reliefFrom(fn: (face: number, a: number, b: number) => number): string {
  const bytes = new Uint8Array(RELIEF_BYTES);
  for (let f = 0; f < 6; f++)
    for (let b = 0; b < 16; b++)
      for (let a = 0; a < 16; a++) bytes[f * 256 + b * 16 + a] = Math.max(0, Math.min(255, Math.round(fn(f, a, b))));
  return bytesToBase64(bytes);
}

const noise = (lo: number, hi: number) => (f: number, a: number, b: number) => lo + hash(f, a, b) * (hi - lo);

/** Brick courses on the side faces (mortar is dark), noise on top and bottom. */
export const BRICKS = reliefFrom((f, a, b) => {
  if (f < 2) return noise(120, 190)(f, a, b);
  const row = Math.floor(b / 4);
  const mortarH = b % 4 === 3;
  const mortarV = (a + (row % 2) * 4) % 8 === 7;
  return mortarH || mortarV ? 60 : 165 + hash(f, a, b) * 25;
});

/** Rounded cobbles: dark gaps between lumps. */
export const COBBLE = reliefFrom(noise(70, 200));

/** Horizontal grain lines on the sides. */
export const PLANKS = reliefFrom((f, a, b) => (f >= 2 && b % 4 === 0 ? 85 : 175 + hash(f, a, b) * 20));

/** Fine grain. */
export const DIRT = reliefFrom(noise(110, 170));

/** A flat texture: carries data but no contrast, so it must never carve. */
export const FLAT = reliefFrom(() => 128);
