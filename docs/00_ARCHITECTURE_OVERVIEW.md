# 00 — Architecture Overview

## 1. Pipeline

```
┌───────────────────────────────────────────────────────────────────┐
│ 1. MINECRAFT CLIENT MOD (Fabric / Java 21)                        │
│  - Keybinds [ and ] (or /vm pos1, /vm pos2) select a region       │
│  - Tick-sliced scan of BlockPos in the selection (no freeze)      │
│  - Per BlockState: VoxelShape boxes [0..16] + average RGB         │
│  - Palette + Uint16 voxel index array -> gzip JSON (.vxm.json.gz) │
│  - POST to 127.0.0.1 relay, open browser; save local backup       │
└───────────────────────────────────┬───────────────────────────────┘
                                    │ gzipped JSON
┌───────────────────────────────────▼───────────────────────────────┐
│ 2. WEB COMPANION (Vite + React 19 + Three.js + Web Worker)        │
│  [Worker] decode payload, count voxels per palette entry          │
│  [Worker] CIE L*a*b* K-Means -> palette -> bucket map (1/4/8/16)  │
│  [Worker] sparse sub-voxel grid (per-block 16^3 chunks)           │
│  [Worker] FDM: dilate thin boxes + fill sealed cavities           │
│  [Worker] non-manifold repair (per bucket, to fixpoint)           │
│  [Worker] hidden-face cull + greedy mesh + T-junction healing     │
│  [Worker] manifold validation (hard gate for export)              │
│  [Main]   Three.js preview, slot mapper, export                   │
│  [Export] Multi-color .3MF  |  Binary .STL                        │
└───────────────────────────────────────────────────────────────────┘
```

Build-time only (not part of the shipped app): Claude Lead ⇄ Gemini (`agy`) ⇄ Claude verifier. See `CLAUDE.md §2`.

## 2. Monorepo

```
voxelmesh/
├── CLAUDE.md
├── .claude/
│   ├── DELEGATION_PLAYBOOK.md
│   ├── AGY_USAGE.md                    # created in pre-flight
│   └── agents/ voxelmesh-verifier.md, voxelmesh-kernel-fallback.md
├── .agy-out/                           # gitignored scratch for Gemini output
├── docs/ 00..06, BUILD_STATUS.md
├── mod/                                # Fabric 1.21.1 client mod
│   └── src/client/java/com/voxelmesh/
│       ├── VoxelMeshClientMod.java
│       ├── selection/SelectionManager.java
│       ├── render/SelectionBoxRenderer.java
│       ├── util/BlockGeometryExtractor.java      # [AGY] D5
│       ├── mixin/SpriteContentsAccessor.java     # [AGY] D5
│       ├── payload/PayloadBuilder.java
│       └── net/CompanionUploader.java
└── web/
    ├── package.json, tsconfig.json, vite.config.ts
    └── src/
        ├── types/ voxelPayload.ts, mesh.ts, color.ts
        ├── samples/ sampleCastlePayload.ts, fixtures.ts
        ├── worker/
        │   ├── meshWorker.ts                     # Lead
        │   ├── pipeline.ts                       # Lead: orchestrates kernel calls
        │   ├── meshingKernel/ grid.ts dilate.ts fill.ts repair.ts   # [AGY] D1
        │   │                  extract.ts tjunction.ts index.ts      # [AGY] D2
        │   └── colorQuantizer.ts                 # [AGY] D3
        ├── exporters/slicerExporters.ts          # [AGY] D4
        ├── validate/manifold.ts                  # [AGY] D4
        ├── store/usePrintStore.ts
        ├── components/ Viewport3D, PrinterModePanel, FilamentSlotMapper, ExportToolbar
        └── __tests__/ meshing/ color/ export/ validate/ adversarial/
```

## 3. Transport modes (mod → web)

1. **Localhost relay (default).** Vite dev middleware (`POST /api/builds`, `GET /api/builds/:id`) binds to `127.0.0.1`, caps bodies at 64 MB, issues a 128-bit random id, keeps builds in memory for 1 hour, and sends no wildcard CORS. Returns `{ "id", "url": "http://127.0.0.1:5173/?build=<id>" }`. The mod opens the URL with `Util.getOperatingSystem().open(URI)`.
2. **File fallback.** `/vm save <name>` writes `.minecraft/voxelmesh/<name>.vxm.json.gz`; drag it onto the web app.
3. **URL fragment (tiny builds).** Selections up to 16×16×16 blocks encode to `#data=<base64url_gzip>`; no relay needed. The fragment is never sent to a server.

## 4. Performance budgets (enforced by tests)

| Selection | Mode | Budget (worker, desktop CPU) |
|---|---|---|
| 24×24×24 blocks | FDM | < 3 s end-to-end, < 400 MB peak |
| 48×48×48 blocks | Resin | < 12 s, < 1 GB peak |
| 128×128×128 | either | Must not crash; warn up front, process in a degraded "preview-only" path, export gated behind confirmation |

## 5. Why sparse, in one line
A dense 16³-per-block grid for 48³ blocks is 768³ ≈ 452 M cells (0.9 GB as Uint16). Most blocks are uniform air or uniform solid, so storing uniform chunks as a number makes memory proportional to the number of *interesting* blocks.
