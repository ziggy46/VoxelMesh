# 06 — Validation & Testing

## 1. Manifold validator (`web/src/validate/manifold.ts`, delegation D4)

```ts
export interface ManifoldReport {
  bucketId: number;
  triangles: number;
  openEdges: number;            // directed edges with no opposite
  nonManifoldEdges: number;     // directed edges used more than once / opposites used more than once
  degenerateTriangles: number;  // zero area
  signedVolume: number;         // lattice^3; must be > 0
  components: number;
  ok: boolean;
}
export function validateMesh(m: ColorBucketMesh): ManifoldReport;
export function validateAll(ms: ColorBucketMesh[]): ManifoldReport[];
```

Algorithm: key directed edges `(a,b)` by packed vertex indices (vertices are welded on the integer lattice). Each directed edge must appear exactly once and its reverse exactly once. Signed volume via divergence theorem; connected components via union-find over vertices. **`ok` requires zero open edges, zero non-manifold edges, zero degenerate triangles, positive volume.** The result is a hard gate for export (`docs/05 §2`).

## 2. Golden fixtures (`web/src/samples/fixtures.ts`)
Each runs in Resin and FDM and must validate clean:
1. Single full block.
2. Two blocks sharing a face; two blocks touching along an edge; two touching at a corner (expects bridges).
3. Per-bucket diagonal: checkerboard of two colors in a 2×2 plane.
4. Stair, slab, fence (thin → dilated in FDM, preserved in Resin), chain, lantern.
5. Hollow room with sealed interior (filled in FDM, kept in Resin) and the same room with a 1-sub-voxel leak (never filled).
6. The sample castle (all of the above).
7. Seeded random sparse fields (mulberry32), 8³ blocks, 200 seeds.

## 3. Property tests
- Determinism: two runs → identical `positions`/`indices` bytes.
- Volume conservation (solid-only input, no dilation): `Σ signedVolume` equals filled cell count, independent of greedy merging.
- Mode laws: Resin output never contains cells absent from the raw grid except repair bridges; FDM only adds dilation, fill and bridges.
- Mirror check: the transform has det +1, so a chiral fixture (an "L"-shaped staircase) must keep its handedness.

## 4. Exporter tests
- 3MF opens with JSZip; has exactly the required entries; `3dmodel.model` parses as XML; exactly one `<item>`; every `<component objectid>` resolves; `pindex` in range; ids unique.
- STL byte length `= 84 + 50 · triangles`; header ASCII; normals unit length.

## 5. Adversarial pass
`voxelmesh-verifier` (Claude) runs against every Gemini-authored module (see playbook §4). Its tests live in `web/src/__tests__/adversarial/` and stay in CI.

## 6. Manual slicer check (record results in BUILD_STATUS)
Import the sample castle `.3mf` into Bambu Studio, OrcaSlicer and PrusaSlicer. Confirm: each color appears at its real height, filament slots map in order, no "repair" warnings, slice succeeds. If PrusaSlicer's CLI is installed, `prusa-slicer --info castle.3mf` should report 0 open edges.
