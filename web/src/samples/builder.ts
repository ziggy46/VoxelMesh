// Test/sample helper: builds a VoxelPayload from named block definitions.
import { crc32, encodeVoxels, voxelsToBytes } from "../payload/loader";
import type { PaletteEntry, VoxelPayload } from "../types/voxelPayload";

const AIR: PaletteEntry = { id: "minecraft:air", name: "Air", color: null, category: "air", boxes: [] };

export class PayloadBuilder {
  readonly dims: [number, number, number];
  readonly palette: PaletteEntry[] = [AIR];
  private readonly voxels: Uint16Array;
  private readonly index = new Map<string, number>();

  constructor(readonly title: string, dims: [number, number, number]) {
    this.dims = dims;
    this.voxels = new Uint16Array(dims[0] * dims[1] * dims[2]);
  }

  /** Register a block definition; returns its palette index. Registering twice reuses the index. */
  def(entry: PaletteEntry): number {
    const existing = this.index.get(entry.id);
    if (existing !== undefined) return existing;
    this.palette.push(entry);
    this.index.set(entry.id, this.palette.length - 1);
    return this.palette.length - 1;
  }

  private at(x: number, y: number, z: number): number {
    const [sx, sy, sz] = this.dims;
    if (x < 0 || y < 0 || z < 0 || x >= sx || y >= sy || z >= sz) {
      throw new RangeError(`block (${x},${y},${z}) outside ${sx}x${sy}x${sz}`);
    }
    return x + z * sx + y * sx * sz;
  }

  set(x: number, y: number, z: number, entry: PaletteEntry | null): this {
    this.voxels[this.at(x, y, z)] = entry ? this.def(entry) : 0;
    return this;
  }

  /** Fill the half-open box [x0,x1) x [y0,y1) x [z0,z1). */
  fill(x0: number, y0: number, z0: number, x1: number, y1: number, z1: number, entry: PaletteEntry | null): this {
    for (let y = y0; y < y1; y++)
      for (let z = z0; z < z1; z++)
        for (let x = x0; x < x1; x++) this.set(x, y, z, entry);
    return this;
  }

  get(x: number, y: number, z: number): number {
    return this.voxels[this.at(x, y, z)]!;
  }

  build(): VoxelPayload {
    const { base64, crc32: crc } = encodeVoxels(this.voxels);
    return {
      version: 1,
      metadata: {
        title: this.title,
        mcVersion: "1.21.1",
        exportedAt: "2026-01-01T00:00:00.000Z", // fixed: fixtures are deterministic
        origin: [0, 0, 0],
      },
      dimensions: [...this.dims],
      palette: this.palette.map((p) => ({ ...p, boxes: p.boxes.map((b) => [...b] as typeof b) })),
      voxelsBase64: base64,
      voxelsCrc32: crc,
    };
  }
}

export { crc32, voxelsToBytes };
