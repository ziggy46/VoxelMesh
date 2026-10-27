# 03 — Sub-Voxel Meshing, Manifold Repair & Culling Engine (`web/src/worker/meshingKernel/`)

Delegated as D1 (§1–§4) and D2 (§5–§6). Types below live in `web/src/types/mesh.ts` (Lead writes them first).

## 0. Contracts

```ts
export interface MeshingOptions {
  printerMode: "fdm" | "resin";
  scaleMmPerBlock: number;        // default 4.0
  includeFluids: boolean;         // default false
  includeFoliage: boolean;        // default false
  fillInteriorCavities: boolean;  // default: true for fdm, false for resin
  fixNonManifold: boolean;        // default true
  minNozzleWallMm: number;        // default 0.8 (fdm), 0 (resin)
}

/** Block-chunked sparse grid in SLICER space. Block index = bx + by*Bx + bz*Bx*By. */
export interface SparseGrid {
  blocks: [number, number, number];            // Bx, By, Bz (slicer-space block dims)
  cells: Array<number | Uint16Array>;          // number = whole block is that bucket (0 = air)
                                               // Uint16Array(4096): idx = lx + ly*16 + lz*256
}

export interface ColorBucketMesh {
  bucketId: number;
  positions: Int32Array;    // integer sub-voxel lattice coordinates, xyz triples
  indices: Uint32Array;     // CCW outward triangles
}

export function buildSparseGrid(p: VoxelPayload, o: MeshingOptions, paletteToBucket: Uint16Array): SparseGrid;
export function dilateThinFeatures(boxes: SubVoxelBox[], o: MeshingOptions): SubVoxelBox[]; // used inside buildSparseGrid
export function fillInteriorCavities(g: SparseGrid): void;
export function repairNonManifold(g: SparseGrid): { bridgesAdded: number; recolored: number };
export function extractMeshes(g: SparseGrid): ColorBucketMesh[];
export function healTJunctions(m: ColorBucketMesh): ColorBucketMesh;
export function runMeshingPipeline(p: VoxelPayload, o: MeshingOptions, paletteToBucket: Uint16Array): ColorBucketMesh[]; // Lead wires; kernel exports index.ts
```

Bucket ids are `1..K` (K ≤ 16). `0` is air. There is **no** special infill id: cavity fill assigns real bucket ids directly.

## 1. Sparse grid
- Slicer-space block dims: `Bx = sizeX`, `By = sizeZ`, `Bz = sizeY` (see `docs/01 §1`).
- A cell chunk that is all one value is stored as that number. Writing a different value into a numeric chunk promotes it to a `Uint16Array(4096)`; a chunk that becomes uniform may be demoted.
- Out-of-range neighbor lookups return 0 (air), which is how the model boundary produces exterior faces.
- Populate from palette boxes: for each block, transform each box via the §1 mapping in `docs/01`, fill `[min,max)` lattice cells with the palette entry's bucket id. Overlapping boxes: later boxes win; ties are irrelevant because boxes within a block share one bucket.

## 2. Preset passes

**Filtering.** Skip `fluid` unless `includeFluids`; skip `foliage` unless `includeFoliage`.

**FDM minimum-feature dilation** (`dilateThinFeatures`, inside `buildSparseGrid`):
`minSub = ceil((minNozzleWallMm / scaleMmPerBlock) * 16)`. For any box with `maxX−minX < minSub` or `maxZ−minZ < minSub`, expand symmetrically about the box center on the offending axis, clamp to `[0,16]`; if clamping blocks one side, shift the remainder to the other side so the width reaches `minSub` (a box at a block edge must still end up thick enough). Y extents are untouched. At 4 mm/block, 0.8 mm → 4 sub-voxels.

**Resin:** no dilation, no fill. Native proportions preserved.

## 2b. Surface relief (`relief.ts`, optional)

`MeshingOptions.reliefDepth` (0 = off, 1, 2 or 3 texels) and `reliefInvert`. Runs after the grid is built and before cavity fill and repair, so both still see and guarantee the final geometry.

- Applies to palette entries that carry `relief`, are a full cube, are included by the filters, and map to a bucket.
- **Tonal depth map.** For each 16×16 face map, depth is scaled continuously with brightness: the darkest texels are carved `reliefDepth` deep, the lightest not at all, and everything between gets the proportional whole number of sub-voxels (`round(t × depth)`). `reliefInvert` flips it. The brightness range runs between the face's 10th and 90th percentile, or its full min..max when those are closer than `MIN_RANGE` (32), so a single dark pixel still counts; a face narrower than that is flat and carves nothing. (An earlier version carved only the darkest ~16% texels as on/off pits. It looked nothing like the texture on a real build; the continuous mapping reproduces log rings and bark.)
- A texel is carved only if the cell just outside it is air, so faces shared with solid neighbours stay whole. Decisions use the pre-carve grid, so the result does not depend on iteration order.
- Carving only turns solid cells of the block into air. Dimensions, bed fit and block-to-block contacts never change.
- **Budget:** each carved texel adds roughly 5 triangles. If the requested depth would carve more than `MAX_CARVED_CELLS` (600,000) cells, relief steps down to a shallower depth until it fits and reports the depth used (`reliefUsedDepth`). If even depth 1 does not fit it is skipped entirely (never partial) and the result says so (`reliefSkipped`).
- One texel is `scaleMmPerBlock / 16` mm wide and deep (0.25 mm at 4 mm per block), so FDM needs about 6.4 mm per block before relief can exceed a 0.4 mm nozzle.

## 3. Exterior flood-fill (FDM interior solidification) — `fillInteriorCavities`
Runs only when `fillInteriorCavities`.
1. Conceptually pad the grid by one air layer; BFS over air from the outside using 6-connectivity.
2. **Chunk-aware:** a numeric-air chunk reached by BFS is marked exterior as a whole and expands to its 6 neighboring chunks without visiting 4096 cells. Only mixed chunks are traversed cell by cell. An enclosed air chunk (never reached) is filled wholesale.
3. Every air cell not reached is an enclosed cavity. Assign each cavity connected component the lowest bucket id among the solid cells that touch it (6-neighborhood); tie-break deterministic. Cavities touching no solid cannot exist (they would be reachable).
4. A cavity with a 1-sub-voxel leak to the outside is not enclosed and must stay open (a test fixture covers this).

## 4. Non-manifold repair — `repairNonManifold`
Run **after** cavity fill, **before** extraction, iterating to fixpoint (max 4 passes).

The rule is **per bucket**, not "solid vs air": each bucket becomes its own mesh, so a bucket-A mesh is non-manifold wherever two A cells touch only along an edge or at a vertex, even if the cells that separate them are another bucket.

**Edge contacts.** For each axis and each 2×2 neighborhood in the perpendicular plane with cells `a=(0,0), b=(1,0), c=(0,1), d=(1,1)`:
- If `a == d == A (>0)` and `b != A` and `c != A`: resolve.
- If `b == c == B (>0)` and `a != B` and `d != B`: resolve (symmetric).

Resolution (deterministic): prefer converting an **air** cell among the two "other" cells to the bucket (`b` first, then `c`). If both other cells are solid buckets, recolor `b` to A (one 0.25 mm cell; visually negligible). Count in `bridgesAdded` / `recolored`.

**Vertex contacts.** For each 2×2×2 neighborhood, if exactly two cells of bucket A occupy opposite corners and the other six cells are not A (after edge repair), fill the nearest connecting cell on the +Z-first path with A (air → A, else recolor).

Resin mode runs this pass too (it adds at most 0.25 mm); the cost of non-manifold geometry in a slicer is worse than a single sub-voxel bridge.

## 5. Hidden-face culling + greedy meshing — `extractMeshes`
For each of the 6 directions and each slice perpendicular to it, build a 2D mask: cell `A` has a visible face toward neighbor `B` iff `A > 0 && B !== A`.
- `B === 0`: exterior face for bucket A.
- `B > 0, B !== A`: interior color boundary. **Both** A and B emit the shared face (each with its own outward normal), so each bucket mesh is closed. In single-material mode the Lead maps every bucket to 1 *before* grid build, so internal boundaries vanish.
- Greedy-merge adjacent mask cells of the same bucket into maximal rectangles. Quads split `(v0,v1,v2),(v0,v2,v3)`; winding CCW viewed from outside.
- Vertices are `Int32` lattice coordinates, welded per bucket through a hash on `(x,y,z)`.
- Work on chunk boundaries correctly: neighbor lookups cross block chunks; uniform-solid chunks surrounded by solid emit nothing and are skipped without iteration.

## 6. T-junction healing — `healTJunctions`
Greedy rectangles of different sizes leave a vertex of one quad in the interior of a neighbor's edge (a crack). Slicers report these as open edges.
1. Build an index of every edge of every triangle.
2. For each mesh vertex, find axis-aligned edges whose interior contains that lattice point (spatial hash keyed on the edge's fixed axes).
3. Split such triangles by adding the vertex, re-triangulating as a fan; preserve CCW winding.
4. Repeat until no splits occur (usually 1–2 rounds).
Result must satisfy: every directed edge has exactly one opposite directed edge (`docs/06 §1`).

## 7. Performance budget
24³ blocks FDM < 3 s; 48³ Resin < 12 s; memory per `docs/00 §4`. Avoid per-cell object allocation; use typed arrays and index math. Measure in the test harness and print the timings.
