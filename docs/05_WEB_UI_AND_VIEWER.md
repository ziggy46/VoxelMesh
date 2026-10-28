# 05 — Web Companion UI & Three.js Viewer (`web/`)

## 1. Stack
Vite + React 19 + TypeScript; `three`, `@react-three/fiber`, `@react-three/drei`; `zustand`; Tailwind CSS (compiled locally); `jszip`. **No CDNs, no Google Fonts, no analytics**; use a system font stack or a self-hosted `@fontsource` package. Gzip via native `DecompressionStream('gzip')`.

## 2. Layout (dark, industrial slicer aesthetic)

### Left sidebar — Import & presets (`PrinterModePanel.tsx`)
- Source: sample dropdown (Medieval Watchtower, Redstone Contraption, Floating Sky Island), drag-and-drop `.vxm.json` / `.vxm.json.gz`, automatic `?build=<id>` load from the relay.
- Printability (there is no printer-type picker): a **Thicken thin parts** slider (minimum wall, 0 to 1.2 mm, default 0.8, 0 = off, with a live "N sub-voxels at this scale" note) and a **Fill hollow interiors** switch (default on). Defaults are safe for any printer; fine resin lowers the wall to about 0.2 to 0.3 mm or 0.
- Scale slider 1.0–15.0 mm/block (default 4.0) with live bounding box readout (`96.0 × 96.0 × 72.0 mm`) and a warning when it exceeds the bed.
- Filters: include fluids, include foliage, include glass, include leaves, fix non-manifold edges. The glass and leaves switches are disabled with a note ("No glass in this build") when the payload has no entries with that tag, including builds from an older mod.
- Block shapes: an "Exact shapes and colours" switch (default on, disabled with a note when the build has no `model` data) and a note with how many block types are drawn from the game's model.
- Entities: an "Include entities" switch in Filters (disabled with a note when the build has none), a notice with the cells added, and a warning when the budget skipped them. Slots show them as one "Entities" row each, flagged "own colour".
- Face colours: one switch ("Colour each face", default on, disabled with a note when the build has no `faces`), a notice with the recoloured cell count, and a warning when the budget skipped them. Slot member lists show such a block again, flagged "own colour", in each slot its faces use.
- Surface relief: depth Off / 1 / 2 / 3 texels (a depth map: darker areas carve deeper), an Invert toggle, a live "1 texel = x mm · depth y mm" readout, a warning when a texel is finer than a 0.4 mm nozzle on FDM, and a message when the carve budget skipped relief. Disabled with an explanation when the build carries no `relief` data (older mod).

### Center — Viewport (`Viewport3D.tsx`)
- Build plate: a picker with six common sizes in one list (130×80, 192×120, 218×123 resin-vat sizes, then 220×220, 256×256 and 350×350 FDM-bed sizes; 256×256 is the default) and a custom width × depth (20 to 1000 mm, whole millimetres, clamped on blur). The size draws the grid in the viewport and drives the "fits the plate" check; it does not change the geometry, so changing it never re-meshes.
- One `THREE.BufferGeometry` per `ColorBucketMesh`, `meshStandardMaterial` in the bucket color. Positions converted from lattice via `scaleMmPerBlock/16` on the main thread.
- Modes: shaded, wireframe (inspect greedy meshing and bridges), section cut (Z clipping slider to confirm filled vs. hollow interiors).
- Large meshes: transfer typed arrays from the worker (transferables); no copies.

### Right sidebar — Slots & export (`FilamentSlotMapper.tsx`, `ExportToolbar.tsx`)
- Slot count: 1 (mono) | 4 | 8 | 16. Each slot shows its swatch (color picker override) and an expandable list of member blocks, with reassignment to another slot.
- Telemetry badge: vertices, triangles, **manifold status from the validator** (open edges / non-manifold edges / flipped volume), estimated volume (cm³) and PLA grams (1.24 g/cm³).
- Export: **Download Multi-Color .3MF** and **Download Binary .STL**. If validation reports errors, the buttons show the failure count and require an explicit "export anyway" confirmation.

## 3. State & worker bus
- `usePrintStore`: payload, options, slot count, overrides, mesh results, validation report, progress.
- `meshWorker.ts` messages: `load(payload)`, `run(options, slotOverrides)`, `cancel()`; replies `progress(stage, pct)`, `result(buckets, report)`, `error`. A newer `run` cancels the older one; stale results are dropped by sequence number.
- Debounce option changes (250 ms). Stages reported: decode → quantize → grid → fill → repair → mesh → heal → validate.

## 4. Accessibility & UX
Keyboard-operable sidebars, visible focus rings, ≥ 4.5:1 text contrast, never rely on color alone for status (icon + text for manifold state), reduced-motion respected.
