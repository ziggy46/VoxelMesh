# 03 — Sub-Voxel Meshing, Manifold Repair & Culling Engine (`web/src/worker/meshingKernel/`)

Delegated as D1 (§1–§4) and D2 (§5–§6). Types below live in `web/src/types/mesh.ts` (Lead writes them first).

## 0. Contracts

```ts
export interface MeshingOptions {
  printerMode: "fdm" | "resin";   // a label only, derived by the UI from minNozzleWallMm > 0; no kernel reads it
  scaleMmPerBlock: number;        // default 4.0
  includeFluids: boolean;         // default false
  includeFoliage: boolean;        // default false
  faceColors?: boolean;           // default true; colour each face of blocks that carry `faces`
  exactShapes?: boolean;          // default true; print each block's drawn shape and colours (model) instead of its hitbox
  includeEntities?: boolean;      // default true; stamp captured entities into empty cells
  includeGlass?: boolean;         // default true; false drops palette entries tagged "glass"
  includeLeaves?: boolean;        // default true; false drops palette entries tagged "leaves"
  fillInteriorCavities: boolean;  // default: true; independent of minNozzleWallMm
  fixNonManifold: boolean;        // default true
  minNozzleWallMm: number;        // default 0.8 (safe for any printer); 0 keeps native detail
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

**Filtering** (`filters.ts`, `isIncluded`, shared by the grid, relief and pipeline counts). Air is always skipped. Skip `fluid` unless `includeFluids`; skip `foliage` unless `includeFoliage`; skip entries tagged `glass` when `includeGlass === false`; skip entries tagged `leaves` when `includeLeaves === false` (both default to included, so older payloads without tags are unchanged). Excluded entries get a voxel count of 0 so they never claim a filament slot.

**FDM minimum-feature dilation** (`dilateThinFeatures`, inside `buildSparseGrid`):
`minSub = ceil((minNozzleWallMm / scaleMmPerBlock) * 16)`. For any box with `maxX−minX < minSub` or `maxZ−minZ < minSub`, expand symmetrically about the box center on the offending axis, clamp to `[0,16]`; if clamping blocks one side, shift the remainder to the other side so the width reaches `minSub` (a box at a block edge must still end up thick enough). Y extents are untouched. At 4 mm/block, 0.8 mm → 4 sub-voxels.

**Resin:** no dilation, no fill. Native proportions preserved.

## 2d. Exact block shapes (`models.ts`, optional)

`MeshingOptions.exactShapes` (default true). For entries with a `model`:
1. **Plan** (`planModelColors`, before the clustering): the model colour covering the most cells becomes the block's own colour; every other distinct colour joins the clustering as an extra, weighted by the block count times its cells / 256 (at least 1).
2. **Templates** (`buildModelTemplates`, after the clustering): each block type gets a 16x16x16 chunk of slot numbers in slicer layout, thickened to the minimum wall like any thin part (runs along MC x and z shorter than the wall are widened inside the block, using the same `widen` as entities). `buildSparseGrid` copies the template per block instead of filling the hitbox boxes.
3. Relief and face skins skip entries that have a model. The slot list shows a block again in each other slot its colours reach.

## 2c. Entities (`entities.ts`, optional)

`MeshingOptions.includeEntities` (default true). Runs after relief and face skins, before fill and repair.
1. **Plan** (`planEntityColors`): every distinct entity colour joins the Lab K-means as an extra point weighted by its cells / 256 (at least one block), after the face-colour extras.
2. **Stamp** (`applyEntities`): each entity's boxes are written into a small local array, thin parts are widened to the minimum wall, then every cell whose grid cell is air is written with its slot. A real block always wins, so block geometry, relief pits and skins are never disturbed.
3. **Minimum wall:** runs along MC x and z (the horizontal axes, as for blocks) shorter than the wall are grown to it, half to each side; a side blocked by a wall or another part hands its share to the other, so a painting on a wall thickens outward. Colours come from the run end each new cell grows from. Y is never grown.
4. **Budget:** `MAX_ENTITY_CELLS` (2,000,000); over it the entities are skipped entirely and the result says so (`entitiesSkipped`).

## 2a. Surface colours (`faces.ts`, optional)

Entries with a `texture` (per-texel RGB, docs/01) skin every exposed texel in its own colour, so sand keeps its grain; entries with only `faces` get the six flat face colours as before. Both are read as a `TexelSource` (at most 32 distinct colours per block type: texels are grouped at 4 bits a channel and rarer groups fold into the nearest). The core colour of a textured block is the mean of its texels. Extras are weighted by the share of the block's cells that wear them, and the clustering uses the square root of every weight (`colorQuantizer`), so a rare colour keeps a slot instead of folding into a large neighbour. The skin budget is `MAX_SKIN_CELLS` = 4,000,000. The rest of this section describes the six-face case, which the texel pass generalises.

`MeshingOptions.faceColors` (default on). Entries with `faces` (full cubes only) get per-face colour skins:

1. **Plan** (`planFaceColors`, before the clustering). The block's own colour becomes its *core*: the face colour closest to the other five (grass: dirt, log: bark). Every other distinct face colour joins the Lab K-means as an extra point weighted like its block type, so skins share slots with everything else. Entries the filters drop add nothing. With the option off or no `faces` in the payload this is the palette unchanged.
2. **Skin** (`applyFaceSkins`, after relief and before fill/repair). For each block face with its own bucket (a face that clustered into the block's slot needs none), every column whose outside cell is air is recoloured for `skinDepth` cells starting at the first solid cell (at most `reliefDepth` cells down, so a face follows its own relief pits). `skinDepth` = round(0.8 mm / cell size), 1 to 6. Faces are applied sides, then bottom, then top, so a grass block keeps a green rim. Only colours change, never solidity, so bed fit and contacts are untouched. Faces covered by a solid neighbour block are skipped.
3. **Budget.** `MAX_SKIN_CELLS` (4,000,000). Over it, skins are skipped entirely and the result says so (`facesSkipped`).

Manual slot reassignment moves a block's core only; its skins keep their own slots. Mono (one slot) therefore has no skins.

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
