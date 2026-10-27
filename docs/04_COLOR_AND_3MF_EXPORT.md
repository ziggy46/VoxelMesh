# 04 — Color Quantization & .3MF / .STL Export (`colorQuantizer.ts`, `slicerExporters.ts`)

Delegations D3 and D4.

## 1. CIE L*a*b* weighted K-Means (`web/src/worker/colorQuantizer.ts`)

Multi-color printers hold 4 (1× AMS/MMU), 8 (2×) or 16 (4×) filaments; a build can have 35+ block colors.

```ts
export interface PaletteColorInput { paletteIndex: number; hex: string; }  // air excluded by caller or by index 0
export interface FilamentSlotBucket {
  bucketId: number;          // 1..K
  name: string;              // "Slot 1 – Stone Gray (#7A797A)"
  hexColor: string;          // weighted-mean centroid, converted back to sRGB
  paletteIndices: number[];
  voxelCount: number;
}
export interface QuantizationResult {
  buckets: FilamentSlotBucket[];
  paletteToBucketMap: Uint16Array;   // index = paletteIndex; 0 for air / unmapped
}
export function quantizePaletteToSlots(
  palette: Array<{ color: string | null }>, voxelCounts: Uint32Array, maxSlots: number
): QuantizationResult;
```

Algorithm:
1. Skip palette 0 and entries with zero count or `color === null`.
2. sRGB → linear (gamma decode) → XYZ (D65) → L*a*b*. Distance ΔE = CIE76 (Euclidean in Lab).
3. If distinct colors ≤ `maxSlots`, one bucket per distinct color (merge identical hex).
4. Else deterministic weighted K-Means++: seed 0 = highest count (tie → lowest palette index); each next seed maximizes `w · min ΔE²` to existing seeds (tie → lowest index); Lloyd iterations ≤ 30 with weighted centroid updates; stop on no reassignment. Empty cluster → reseed with the point farthest from its centroid.
5. `maxSlots === 1` → single bucket (mono).
6. Names: nearest entry in a small built-in table of ~24 named colors (white, black, gray, stone gray, brown, red, orange, yellow, lime, green, cyan, blue, purple, magenta, pink, tan…), no network lookups.
7. User overrides (manual block→slot reassignment in the UI) are applied by the store afterwards by editing `paletteToBucketMap`; centroids are recomputed from members.

## 2. Multi-color .3MF (`slicerExporters.ts`)

```ts
export interface ExportBucket { bucketId: number; name: string; hexColor: string; mesh: ColorBucketMesh; }
export function generateMultiColor3MF(buckets: ExportBucket[], buildName: string, scaleMmPerBlock: number): Promise<Blob>;
export function generateBinarySTL(buckets: ExportBucket[], scaleMmPerBlock: number): ArrayBuffer;
```

Millimeter coordinates = `lattice * scaleMmPerBlock / 16`, written with a fixed number of decimals (e.g. 4) for determinism.

OPC zip (DEFLATE) with exactly:
1. `[Content_Types].xml`: defaults for `rels` and `model`.
2. `_rels/.rels`: relationship to `/3D/3dmodel.model`.
3. `3D/3dmodel.model`:
   - `<model unit="millimeter" xml:lang="en-US" xmlns="http://schemas.microsoft.com/3dmanufacturing/core/2015/02">`
   - `<resources>`: `<basematerials id="100">` with a `<base name="Slot N …" displaycolor="#RRGGBBFF"/>` per bucket.
   - One `<object id="{bucketId}" name="…" type="model" pid="100" pindex="{bucketIdx0}">` per non-empty bucket containing `<mesh>` with welded `<vertices>` and `<triangles>`. `pindex` is **0-based** into the basematerials list.
   - One parent `<object id="{K+1}" name="{buildName}" type="model">` with `<components><component objectid="1"/>…</components>`.
   - `<build><item objectid="{K+1}"/></build>`: exactly one item. Multiple root items makes slicers drop elevated colors to Z=0.
4. `Metadata/model_settings.config` (Bambu/Orca hint): per `<part id>` an `<metadata key="extruder" value="{bucketId}"/>` so slot N maps to filament N on import.

Rules: IDs are positive and unique; XML-escape names; no empty meshes; triangles reference valid vertex indices; every bucket passes the validator before the zip is built (`docs/06`).

## 3. Binary .STL
- Single-material export: the pipeline is run with all buckets mapped to 1 (so interior boundaries disappear), then this serializer receives one bucket. If called with several, it concatenates without dedup.
- Layout (little-endian `DataView`): 80-byte header `"VoxelMesh Binary STL - Minecraft Build"` zero-padded; `uint32` triangle count; per triangle 12×`float32` (normal then 3 vertices) + `uint16` attribute `0`. Total size `84 + 50·N`.
- Normals computed from the winding, normalized; degenerate triangles are an error (the validator should have caught them).
