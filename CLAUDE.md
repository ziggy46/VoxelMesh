# CLAUDE.md — VoxelMesh Master Build Guide

## 1. Project Identity

**VoxelMesh** turns a Minecraft build into a 3D-print-ready model with true block geometry and multi-color support, running entirely on the user's machine.

1. **`mod/` — Fabric client mod (Java 21, MC 1.21.1).** The player selects two corners. The mod reads each block's real `VoxelShape` (quantized to a 16×16×16 sub-voxel grid) and its average texture color (vanilla and modded blocks, resource packs included), gzips the result, hands it to the web app on localhost, and opens the browser.
2. **`web/` — Web companion (Vite + React 19 + TypeScript + Three.js).** A Web Worker builds a sparse sub-voxel grid, applies the minimum-wall and cavity-fill options, repairs non-manifold geometry, culls hidden faces, quantizes colors to filament slots, previews in 3D, and exports watertight multi-color `.3MF` or binary `.STL`.

### Scope
**Fabric on Minecraft 1.21.1 only** (Java 21, Yarn mappings). Other loaders (NeoForge) and other Minecraft versions are later ports, not goals. Keep Fabric API calls in a small package and write the extractor and payload builder against vanilla classes, so a port has a clear seam. The web app and payload format are loader- and version-independent.

### What makes VoxelMesh different from cube-exporters and cloud converters
- **Real geometry**: stairs, slabs, fences, chains, lanterns and modded shapes keep their sub-voxel form.
- **Printer-aware without a mode**: thickening thin parts and filling hollow interiors are independent options. The defaults (0.8 mm minimum wall, fill on) are safe for any printer; a wall of 0 and fill off keep resin-grade detail.
- **Provably watertight**: every export passes an in-app manifold validator (`docs/06`). If validation fails the UI says so; no silent bad exports.
- **Local-first**: the shipped app makes no third-party network calls. Builds never leave the user's machine.
- **Deterministic**: same payload + options → byte-identical output.

---

## 2. Orchestration: Claude Lead + Gemini via `agy`, cross-verified

Two models, deliberately split so each checks the other:

| Role | Who | Why |
|---|---|---|
| **Lead / Integrator** — contracts, tests, scaffolding, state, UI, glue, verification | **Claude (you)** | Owns correctness and the whole-system view |
| **Kernel author** — isolated, spec-dense algorithms | **Gemini via `agy`** | Parallel throughput on well-specified math |
| **Adversarial verifier** — fuzz/golden/property tests against Gemini's code | **Claude subagent `voxelmesh-verifier`** | A different model attacking the code finds different bugs |
| **Fallback author** | **Claude subagent `voxelmesh-kernel-fallback`** | Used if `agy` fails twice on a task or isn't available |

Read `.claude/DELEGATION_PLAYBOOK.md` before the first delegation.

### The loop for every `[AGY]` task
1. **Contract + failing tests first** (Lead). Gemini gets the spec section, exact signatures, and the tests it must satisfy.
2. **Delegate** with `agy`. Output goes to `.agy-out/`, never straight into `src/` (a failed run or stray markdown fence must not clobber real files).
3. **Inspect and install** (Lead): strip fences/prose, confirm only the owned paths are touched, move into `src/`.
4. **Verify**: `npm run typecheck && npm test`.
5. **Adversarial pass**: run `voxelmesh-verifier` on the new code. Feed its reproducers back to Gemini (or fix directly if small).
6. **Check off** `docs/BUILD_STATUS.md` only after steps 4 and 5 pass.

### Data policy for `agy`
Only specs, interface files and source code go to Gemini. Never pipe real player builds, coordinates, usernames, API keys or `.env` files. The shipped app has zero Gemini/Google calls; delegation is a build-time development aid only.

---

## 3. Invariants (never violate)

1. **No cube assumption.** Every block is its `VoxelShape` boxes in integer `[0..16]` units. Only full opaque blocks are `[0,0,0,16,16,16]`.
2. **Sparse, never dense.** A 128³-block selection is 2048³ sub-voxels; a dense array is impossible. The grid is chunked per block (`docs/03 §1`); uniform chunks are one number. No kernel may allocate O(total sub-voxels).
3. **Thickening and filling are independent, explicit options.** A minimum wall of 0 keeps native 16³ detail (no dilation); a positive value dilates features thinner than it (X and Z only). Enclosed cavities are filled only when asked. Neither option implies the other and there is no printer-type mode that bundles them. (Formerly "Resin ≠ FDM": the same two behaviours, now chosen separately.)
4. **Every color bucket is a closed 2-manifold**, including faces shared between two touching buckets (both sides emit the face). Diagonal edge/vertex contacts are checked *per bucket* (`docs/03 §4`).
5. **3MF hierarchy.** All per-color `<object>`s are wrapped in one parent `<object>` via `<components>`; `<build>` has exactly one `<item>` pointing at the parent.
6. **Integer lattice.** Mesh vertices are integer sub-voxel coordinates (`Int32Array`). Millimeter scaling happens only at export, so welding and edge matching are exact.
7. **Proper rotation, no mirroring.** MC `(x,y,z)` → slicer `(x, -z, y)` has determinant +1; winding is preserved. Never "fix" orientation by flipping one axis.
8. **Local-only runtime I/O.** The relay binds `127.0.0.1`, rejects bodies > 64 MB, uses unguessable ids with a 1-hour TTL, no CORS `*`. No external hosts, fonts, CDNs or analytics in the shipped app.
9. **Determinism.** No `Math.random`, no `Date.now()` in output, no unordered map iteration without sorting.

---

## 4. Execution order
1. Read `docs/BUILD_STATUS.md`, then `docs/00_ARCHITECTURE_OVERVIEW.md`.
2. Run the `agy` pre-flight in the playbook and record the working invocation in `.claude/AGY_USAGE.md`.
3. Execute phase by phase. Gates `G1`…`G5` in `BUILD_STATUS.md` are hard stops.
4. After each task: `npm run typecheck && npm test` in `web/` or `./gradlew build` in `mod/`, then tick the checkbox.
5. Commit per task. Don't commit generated `.3mf`/`.stl` fixtures over 1 MB or the `.agy-out/` directory.

## 5. Definition of done
- `web/`: typecheck clean, all Vitest suites green (including fuzz + adversarial), `npm run build` succeeds, validator reports 0 open/non-manifold edges on every golden fixture in both modes.
- `mod/`: `./gradlew build` succeeds; in-game smoke test exports a build that loads in the web app.
- Sample castle imported into Bambu Studio / OrcaSlicer / PrusaSlicer shows correct colors at correct Z heights with zero repair warnings (manual; record in `docs/BUILD_STATUS.md`).
