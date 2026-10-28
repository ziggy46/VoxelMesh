# 01 — VoxelMesh Payload Specification (`.vxm.json` / `.vxm.json.gz`)

## 1. Coordinates and units

- Minecraft axes: +X east, +Y up, +Z south.
- Slicer axes (STL/3MF): right-handed, Z-up.
- **Mapping:** `(slicerX, slicerY, slicerZ) = (mcX, −mcZ, mcY)`, with the whole model then translated so its minimum corner is the origin. At sub-voxel level, with block `(bx,by,bz)` and local `(lx,ly,lz)` in `[0,16)`:
  - `X = bx*16 + lx`
  - `Y = (dimZ−1−bz)*16 + (15−lz)`
  - `Z = by*16 + ly`
- Determinant of the linear map is +1: it is a rotation, not a mirror, so triangle winding is unchanged. Box `[minZ,maxZ]` maps to `[16−maxZ, 16−minZ]` within the flipped block.
- 1 block = 16 sub-voxels. Default scale 4.0 mm/block (0.25 mm/sub-voxel), user range 1.0–20.0.

## 2. Schema

```ts
export type SubVoxelBox = [minX: number, minY: number, minZ: number,
                           maxX: number, maxY: number, maxZ: number]; // ints 0..16, max > min

export type BlockCategory = "solid" | "partial" | "thin" | "foliage" | "fluid" | "air";

export interface PaletteEntry {
  id: string;            // "minecraft:oak_stairs[facing=north,half=bottom]"
  name: string;          // "Oak Stairs"
  color: string | null;  // "#RRGGBB", null for air
  category: BlockCategory;
  boxes: SubVoxelBox[];  // [] for air
  /** Optional, full-cube blocks only: base64 of 1536 luma bytes = six 16x16 face maps (see Surface relief below). */
  relief?: string;
  /** Optional filter tags. Only "glass" and "leaves" are defined; unknown tags are ignored. Older payloads have none. */
  tags?: string[];
}

export interface VoxelPayload {
  version: 1;
  metadata: { title: string; author?: string; mcVersion: string; exportedAt: string;
              origin: [number, number, number]; };
  dimensions: [number, number, number];   // blocks [sizeX, sizeY, sizeZ]
  palette: PaletteEntry[];                // index 0 MUST be minecraft:air
  /** Little-endian Uint16Array, length sizeX*sizeY*sizeZ, index = x + z*sizeX + y*(sizeX*sizeZ) */
  voxelsBase64: string;
  /** Optional CRC32 (hex) of the decoded voxel bytes, verified on load if present */
  voxelsCrc32?: string;
}
```

## 3. Limits and validation (web loader)

- Reject: `version !== 1`, `palette[0].id !== "minecraft:air"`, any box with `max <= min` or outside `[0,16]`, decoded byte length ≠ `2*sx*sy*sz`, any voxel index ≥ `palette.length`, CRC mismatch.
- Warn above 64³ blocks, hard-gate above 128³.
- Palette ≤ 65,534 entries (bucket id 65535 is reserved and unused; see `docs/03`).

## 3b. Surface relief data (`relief`)

Per full-cube palette entry, six 16×16 maps of texture brightness (0 = dark, 255 = light), concatenated in the order `DOWN, UP, NORTH, SOUTH, WEST, EAST` (Minecraft's `Direction` ids), 256 bytes each, `index = a + b*16`, in MC block-local axes:

| Faces | a | b |
|---|---|---|
| DOWN, UP | x | z |
| NORTH, SOUTH | x | y |
| WEST, EAST | z | y |

One texel is one sub-voxel on that face. Texels are sampled through the face quad's own UVs, so texture rotation and mirroring are honoured. A face with no full-face quad is flat (128). The web loader rejects a `relief` that does not decode to exactly 1536 bytes. Payloads without `relief` are valid; relief is simply unavailable for them.

## 4. Category heuristics (in the mod)

1. `air`: `state.isAir()` → palette index 0, `boxes: []`.
2. `fluid`: non-empty fluid state and empty outline shape → boxes `[[0,0,0,16,14,16]]`.
3. `foliage`: empty collision shape and tagged flowers / crops / replaceable plants → one stylized box `[[4,0,4,12,10,12]]` (dropped by default in the web app).
4. `solid`: exactly one box `[0,0,0,16,16,16]`.
5. `thin`: any box thinner than or equal to 4 sub-voxels along X or Z (fences, bars, chains, torches, panes, lanterns).
6. `partial`: everything else (stairs, slabs, chests, lecterns).

Non-obvious: a modded block with an empty outline shape but a non-empty collision shape should fall back to the collision shape, otherwise it silently vanishes from prints.
