# Delegation Playbook — Claude Lead ⇄ Gemini (`agy`) ⇄ Claude Verifier

## 0. Pre-flight (do once, before the first delegation)

```bash
which agy && agy --help
```

The original plan guessed at `agy` flags; **do not trust any flag below until `--help` confirms it.** Find the non-interactive way to (a) pass a prompt, (b) attach context files, (c) print to stdout. Then record the working invocation in `.claude/AGY_USAGE.md` (one example command, known quirks) and use that everywhere.

If `agy` is missing or can't run non-interactively, use the fallback agent (§5) and note it in `docs/BUILD_STATUS.md`.

## 1. Safe invocation pattern

Never redirect directly into `src/`. A failed run, rate-limit message, or markdown fence would overwrite real code.

```bash
mkdir -p .agy-out
# Generic shape; adapt flags to what AGY_USAGE.md says works:
agy "<PROMPT>" < <(cat docs/03_VOXEL_MESHING_ENGINE.md web/src/types/mesh.ts) > .agy-out/<name>.raw.txt
```

Then the Lead:
1. Strips a wrapping ```ts fence and any leading/trailing prose.
2. Confirms the file exports exactly the contract names.
3. Moves it to the owned path, runs `npm run typecheck`.

Always append this tail to every prompt: `Output ONLY the complete file contents. No markdown fences, no commentary, no TODOs or placeholders. Strict TypeScript, no dependencies unless stated.`

## 2. Prompt anatomy (golden rule)

Every delegation prompt contains, in order:
1. **Task + target path** (one file per delegation where possible).
2. **Spec pointer**: the doc section, piped in or attached.
3. **Exact exported signatures** (copied from `web/src/types/*.ts`).
4. **Already-decided constraints** (integer lattice, sparse chunks, determinism, per-bucket manifold rule).
5. **Acceptance tests**: path of the failing Vitest file, and one line on how it will be run.
6. **Output tail** (above).

Smaller tasks beat big ones. Meshing is split into two delegations.

## 3. Delegations

### D1 — Sparse grid, FDM dilation, flood-fill, non-manifold repair (Phase 2.1a)
- Targets: `web/src/worker/meshingKernel/{grid,dilate,fill,repair}.ts`
- Spec: `docs/03` §1–§4. Tests: `web/src/__tests__/meshing/{grid,fill,repair}.test.ts`
- Signatures: `buildSparseGrid`, `dilateThinFeatures`, `fillInteriorCavities`, `repairNonManifold`.
- Prompt core:
```
Implement the four modules for the VoxelMesh sparse sub-voxel grid as specified.
Grid is per-block chunks: Array<number | Uint16Array(4096)>; a number means the whole block is that bucket id.
Never allocate memory proportional to total sub-voxels. FDM: thicken boxes below minSubVoxels symmetrically;
flood-fill exterior air with a chunk-aware BFS and assign enclosed air to the lowest-id adjacent bucket.
repairNonManifold must apply the PER-BUCKET diagonal rule in section 4 until fixpoint (max 4 passes).
Deterministic. Resin mode must not dilate or fill.
```

### D2 — Greedy culling + T-junction healing (Phase 2.1b)
- Targets: `web/src/worker/meshingKernel/{extract,tjunction}.ts`
- Spec: `docs/03` §5–§6. Tests: `web/src/__tests__/meshing/{extract,tjunction}.test.ts`
- Prompt core:
```
Implement extractMeshes and healTJunctions. For each of the 6 directions emit faces where cell A>0 and neighbor B!==A,
for BOTH buckets when A,B>0 (each bucket's mesh must be closed). Greedy-merge coplanar same-bucket rectangles,
CCW outward winding, integer Int32 vertex positions. healTJunctions splits triangles at lattice vertices lying
in the interior of another triangle's edge so every directed edge has exactly one opposite.
```

### D3 — CIE L*a*b* weighted K-Means++ (Phase 2.2)
- Target: `web/src/worker/colorQuantizer.ts`. Spec: `docs/04` §1. Tests: `__tests__/color/*`.
- Deterministic seeding (highest count first, then max `w·ΔE²`), ≤30 iterations, `ΔE` = CIE76 in Lab, D65 white point, sRGB gamma decode.

### D4 — 3MF, STL, validator (Phase 2.3)
- Targets: `web/src/exporters/slicerExporters.ts`, `web/src/validate/manifold.ts`
- Spec: `docs/04` §2–§3, `docs/06` §1. Tests: `__tests__/export/*`, `__tests__/validate/*`. Uses `jszip` for 3MF only.

### D5 — Fabric extractor (Phase 4.2)
- Target: `mod/src/client/java/com/voxelmesh/util/BlockGeometryExtractor.java` (+ `mixin/SpriteContentsAccessor.java`)
- Spec: `docs/02` §3, `docs/01` §3. Acceptance: `./gradlew compileClientJava`.
- Warn Gemini that Minecraft/Yarn names change between versions; the compiler on 1.21.1 is the arbiter, and any uncertain symbol must be flagged in a comment so the Lead can check it.

## 4. Verification loop (Claude, after every delegation)

1. `git diff --stat`: only owned paths changed.
2. No prose, fences or placeholder bodies in source.
3. `npm run typecheck` / `./gradlew compileClientJava`.
4. Acceptance tests green.
5. **Launch `voxelmesh-verifier`** against the new module (fuzz, golden, diagonal lattices, both printer modes). It writes tests only under `web/src/__tests__/adversarial/`.
6. Failing adversarial case → send the minimal reproducer back to `agy` once. Second failure → the Lead fixes it or uses the fallback agent.
7. Look at it: open the viewport wireframe and check greedy artifacts and bridges.

## 5. Fallback: `voxelmesh-kernel-fallback`

Launch with the Agent tool (`subagent_type: voxelmesh-kernel-fallback`) and the same prompt body you would have given `agy`, plus the owned path. Use it when `agy` is unavailable, fails the same acceptance test twice, or rate-limits. It follows identical rules and never edits outside its target.

## 6. Parallelism
D1/D3/D4/D5 touch disjoint files and may run at the same time (run several `agy` jobs in background shells, or the fallback agents in one message). D2 can start once D1's `grid.ts` types are stable. The verifier runs only after its target is installed.
