# VoxelMesh Build Status

Tags: **[LEAD]** = Claude main session. **[AGY]** = Gemini via `agy` (D#, see playbook). **[VERIFY]** = `voxelmesh-verifier`. Fallback for any [AGY]: `voxelmesh-kernel-fallback`.
Tick a box only after typecheck + tests (and for [AGY], the verifier pass) are green.

**Scope:** Fabric, Minecraft 1.21.1 only. Other loaders and versions are later ports (see CLAUDE.md §1).

## Phase 0 — Pre-flight
- [x] [LEAD] 0.1 `which agy && agy --help`; record the working non-interactive invocation in `.claude/AGY_USAGE.md` (or note "using fallback agents"). _agy works (`agy -p`), but the user ruled it out: all [AGY] tasks use `voxelmesh-kernel-fallback`._
- [x] [LEAD] 0.2 Create `.gitignore` (include `.agy-out/`, `node_modules`, `build/`, `*.3mf` over 1 MB).

## Phase 1 — Monorepo & contracts
- [x] [LEAD] 1.1 Scaffold `web/` (Vite, React 19, TS strict, Vitest, Tailwind local) and `mod/` skeleton. _web/: typecheck, vitest, `npm run build`. mod/: `./gradlew build` passes (JDK 21 Temurin, Gradle 9.8.2, Loom 1.17.21, 2026-10-27). Build with `JAVA_HOME=$(/usr/libexec/java_home -v 21)`: brew's default JDK is 27._
- [x] [LEAD] 1.2 `web/src/types/{voxelPayload,mesh,color}.ts` exactly from docs 01, 03 §0, 04.
- [x] [LEAD] 1.3 Payload loader/validator (docs/01 §3), gzip + CRC.
- [x] [LEAD] 1.4 `samples/sampleCastlePayload.ts` + `fixtures.ts` (docs/06 §2). _Fixtures build and load through the validator. Their expected volumes are hand-derived and unproven until G2._
- [x] [LEAD] 1.5 Failing tests for every kernel: `__tests__/{meshing,color,export,validate}/`.
- **G1:** typecheck passes; kernel tests exist and fail for the right reason.

## Phase 2 — Kernels
- [x] [AGY D1] 2.1 `meshingKernel/{grid,dilate,fill,repair}.ts` _Lead-written (no agents, per user). 36 tests green._
- [x] [AGY D2] 2.2 `meshingKernel/{extract,tjunction}.ts` + `index.ts` (after D1 types are stable) _Lead-written; `index.ts` was written at G1._
- [x] [AGY D3] 2.3 `colorQuantizer.ts` _Lead-written._
- [x] [AGY D4] 2.4 `slicerExporters.ts` + `validate/manifold.ts` _Lead-written._
- [ ] [VERIFY] 2.5 Adversarial pass on 2.1–2.4; reproducers fixed _NOT done as specified: no verifier agent (user ruled agents out). Lead wrote `__tests__/adversarial/pipelineFuzz.test.ts` (cell-level fuzz, exporters on real output); it found the repair non-convergence below. The author also wrote the tests, so this is weaker than an independent pass._
- [x] [LEAD] 2.6 `worker/pipeline.ts` wiring (quantize → grid → fill → repair → extract → heal → validate), perf budgets from docs/00 §4 measured and recorded here _`worker/pipeline.ts` + `__tests__/meshing/pipeline.test.ts`. Budgets measured: see notes._
- **G2:** all golden fixtures validate clean in both modes; determinism test green; budgets met.

## Phase 3 — Web UI
- [x] [LEAD] 3.1 `meshWorker.ts` + `usePrintStore.ts` (docs/05 §3) _Worker bus with per-kind queues, seq-based stale drop, 250 ms debounce; `ui/derive.ts` has 12 unit tests. Worker and store checked in a real browser._
- [x] [LEAD] 3.2 `Viewport3D.tsx` (plate, wireframe, section cut) _Plate, shaded, unlit wireframe, section cut; checked in a real browser (FDM and Resin plates)._
- [x] [LEAD] 3.3 `PrinterModePanel.tsx` (presets, scale, filters, dropzone, samples) _Sample dropdown has 2 of the 3 docs/05 samples (castle, terrain). Drag-drop and the file chooser are written but NOT exercised in a browser._
- [x] [LEAD] 3.4 `FilamentSlotMapper.tsx` + `ExportToolbar.tsx` (validator-gated export) _3MF blob verified in the page (valid zip); STL mono re-run verified. The "export anyway" confirm UI is not exercised in a browser (no invalid mesh available); the `skipValidation` path is unit-tested._
- [x] [LEAD] 3.5 Vite relay middleware: loopback only, 64 MB cap, random ids, 1 h TTL _7 unit tests plus live curl: 201 with id, 403 for foreign Origin and Host._
- **G3:** castle loads, previews, exports `.3mf`/`.stl`; manual slicer import recorded (docs/06 §6).

## Phase 4 — Fabric mod
- [x] [LEAD] 4.1 Scaffold Gradle project, `fabric.mod.json`, keybinds, `/vm` commands _Compiles; `[` and `]` keybinds, `/vm pos1|pos2|export|save|clear`, lang file. Mod loads in the dev client. Keybinds and commands NOT exercised in-game._
- [x] [AGY D5] 4.2 `BlockGeometryExtractor.java` + `SpriteContentsAccessor` mixin (compiler on 1.21.1 is the arbiter) _Lead-written (no agents). Compiles against real Yarn sources; accessor remaps to `class_7764.field_40539` (= `SpriteContents.image`, checked in the mappings) and applies at startup. Extractor NOT run on real blocks._
- [x] [LEAD] 4.3 `SelectionManager`, `SelectionBoxRenderer`, tick-sliced `PayloadBuilder`, `CompanionUploader` _Selection, box renderer, HUD, tick-sliced builder, uploader, export controller. Pure parts (`core/`) have 21 JUnit tests. Rendering, scanning and upload NOT exercised in-game._
- [x] [LEAD] 4.4 Fix any 1.21.1 mapping mismatches from 4.2 _No mismatches: API names were read from the generated Yarn sources before writing code, and the first compile passed._
- **G4:** `./gradlew build` passes.

## Phase 5 — End-to-end
- [x] [LEAD] 5.1 In-game: select a build, `/vm export`, browser opens with the build loaded _Run by the user: corners, selection box, `/vm export` and the browser hand-off all worked in-game. Details of what was checked (shapes, tints, the relay-down fallback) were not itemised in the report._
- [x] [LEAD] 5.2 `npm run build && npm test` in `web/`, `./gradlew build` in `mod/` _`npm run build` ok; 21 files / 244 web tests; `./gradlew clean build` ok with 21 Java tests (2026-10-27)._
- [x] [VERIFY] 5.3 Final adversarial sweep on the full pipeline (random payloads through worker) _Lead-written, not an independent verifier (agents ruled out): `__tests__/adversarial/endToEndSweep.test.ts` runs 120 random payloads (random boxes, categories, dimensions, filters, modes, slot counts) plus 40 override cases through `runPipeline`: all buckets valid, slot limit respected, byte-identical on repeat._
- **G5:** Definition of Done in `CLAUDE.md §5` met.

## Notes / deviations log
_(Record agy quirks, fallback usage, perf numbers, and slicer results here.)_

### G1 (2026-10-27)
- **agy:** works non-interactively as `agy -p "<prompt>" --print-timeout 90s`; piped stdin is ignored when a prompt arg is given. Not used, by user decision. Every [AGY] task goes to `voxelmesh-kernel-fallback`.
- **Toolchain:** Node 26 / npm 11 present. No JDK and no Gradle, so `mod/` is unbuilt (Phase 4 / G4 needs `brew install --cask temurin@21 gradle`). Fabric versions in `mod/gradle.properties` were looked up on maven.fabricmc.net but never resolved by a build.
- **Contract decisions made while writing tests (the docs are silent):**
  - `extractMeshes` returns one mesh per non-empty bucket, ascending `bucketId`.
  - `quantizePaletteToSlots` numbers buckets by descending voxelCount (ties: lowest member palette index); `hexColor` is uppercase.
  - 3MF parent object id = max bucket id + 1; output is byte-deterministic (zip timestamps must be fixed).
  - `runMeshingPipeline` (`meshingKernel/index.ts`) is Lead-written glue instead of part of D2; D2 owns `extract.ts` and `tjunction.ts` only.
  - Size limits are on total blocks (64^3 warn, 128^3 hard), not per axis.
- **Spec gap for the verifier:** `validateMesh` as specified accepts vertex-only contacts (shared vertex, all edges paired), so a pinched vertex passes `ok`. Raise this in the adversarial pass.

### Phase 2 (2026-10-27)
- **Process:** agy ruled out, then all agents ruled out by the user. Four fallback agents were started and stopped; only `dilate.ts` came from one (re-tested by me: 7/7). Everything else in Phase 2 is Lead-written.
- **Deviation from docs/03 §4 (repair):** the spec's "max 4 passes" leaves contacts on random fields (seed 4 needed about 16 passes) and the spec's "recolor b to A" can ping-pong forever. `repair.ts` now caps at 128 passes and only ever (a) turns air into solid or (b) lowers a cell's bucket id, so it must terminate. When A < b the behaviour equals the spec; otherwise it lowers c or a. The vertex rule prefers an air cell, then a cell above A, else lowers the corner. Dirty-chunk tracking keeps later passes cheap.
- **Other contract notes:** extract skips uniform interiors and merges greedily across chunk boundaries; T-junction healing splits axis-aligned edges at any vertex lying inside them (fan from the opposite corner) until none remain.
- **Perf (desktop, this machine, worker code only, `generateTerrain` fixture):** 24^3 FDM 1.05 s total (repair 731, mesh 271, fill 24); budget 3 s. 48^3 Resin 7.5 s (repair 5951, mesh 1399); budget 12 s. RSS sampled at stage boundaries only: 24^3 FDM 102 MB, 48^3 Resin 236 MB (budgets 400 MB / 1 GB); true peak not measured. 128^3 "preview-only" path is not built yet. Repair is the hotspot if the margin on 48^3 needs to grow.
- **Tests:** 17 files, 221 tests pass (`npm test`), `npm run build` ok.
- **G2 status:** golden fixtures validate clean in both modes (including 200 random seeds), determinism green, budgets met. Only 2.5 (independent verifier) is outstanding.

### Phase 3 (2026-10-27)
- **Verified in the built-in browser (dev server, Chromium):** `?build=<id>` relay load; sample castle loads, meshes in 0.5 s, validator reports watertight; shaded / wireframe / section-cut; FDM <-> Resin (plate and volume change: 145.5 vs 131.6 cm3); slot reassignment re-runs and stays watertight; STL export (90 KB, mono re-run) and a valid `.3mf` zip (17.7 KB); 375 px width has no horizontal scroll; no console errors (one `THREE.Clock` deprecation warning from react-three-fiber).
- **Not verified:** drag-and-drop and the file chooser, the "export anyway" dialog, keyboard-only use of the 3D view (`listenToKeyEvents` is wired but untried), screen-reader pass, contrast measured only by choosing tokens (muted text is 6.9:1 by calculation).
- **G3 manual step (docs/06 §6) is still open:** import `web/fixtures-out/castle_*_4slot.3mf` into Bambu Studio, OrcaSlicer and PrusaSlicer and check colours, heights, slot order and repair warnings. Files are regenerated, not committed (`fixtures-out/` is gitignored).
- **Local-only audit:** the only `fetch` in the app is the same-origin relay call. The built bundle contains no third-party hosts that are fetched (only XML namespaces and doc-link strings). Dev and preview servers bind 127.0.0.1.
- **Known issues:** main bundle is 1.29 MB (358 KB gzip; three.js) so Vite warns about chunk size; 3MF and STL are built on the main thread (fine for the castle, will freeze the UI on very large builds); there is no preview-only path for 64^3 and larger yet (docs/00 §4); the viewport does not auto-frame the model.
- **Tests:** 19 files, 241 tests pass; `npm run build` ok.

### Phase 4 (2026-10-27)
- **G4:** `./gradlew build` passes (JDK 21, Gradle 9.8.2, Loom 1.17.21): compiles, 21 JUnit tests, remapJar. The web suite is 20 files / 242 tests green.
- **Structure:** Minecraft-free logic lives in `com.voxelmesh.core` (main source set, unit-tested: box quantiser, colour maths, payload writer, config, selection, limits). Everything that touches Minecraft is in the client source set.
- **Cross-language check:** the Java `PayloadWriter` output loads in the web validator with CRC and voxel indexing intact (`web/src/__tests__/payload/javaInterop.test.ts`, reads `mod/build/interop/sample.vxm.json.gz`, skipped if the mod has not been built). This caught a real bug: Gson dropped air's `"color": null`.
- **Runtime evidence:** `./gradlew runClient` started the dev client; log showed the mod entrypoint ran, the Mixin subsystem initialised with no error, and the block atlas was built (so `SpriteContents` loaded with the accessor applied). The window was then killed. No world was joined.
- **Still unverified (needs 5.1, in-game):** key presses, `/vm` commands, the selection box (drawn at `WorldRenderEvents.LAST` with explicit layer flushes: untested and the likeliest rendering risk), HUD text, scanning real blocks (shapes, colours, tints), the upload and browser open, the relay-unreachable fallback. Also untested: the production (non-dev) jar loading in a real launcher; only its remapping was inspected.
- **Deviations / decisions:**
  - Lanterns classify as `thin` (their top box is 4 wide, and docs/01 §4 lists lanterns under thin); the web sample palette calls them `partial`, which only matters for labels.
  - `BoxQuantizer` pulls a zero-width box on the far face back inside [0,16] instead of emitting max = 17 (the spec's literal formula would).
  - The URL-fragment transport (`#data=`) is decoded by the web app but the mod never sends it (no relay + tiny build fallback): on relay failure it saves the file and tells the player to drag it onto the app.
  - Upload request timeout is 30 s (docs say 10 s; 10 s is used for connect). The browser URL is built from the configured relay's origin plus the returned id, never from a URL in the response.
  - `metadata.author` is not written. Palette ids for tinted blocks get a `#tint=RRGGBB` suffix so ids stay unique.
  - Position-offset plants are cached at the first position seen; they become the stock foliage box anyway.
  - `/vm pos1|pos2` without coordinates use the block under the crosshair, else the player's feet.

### Phase 5 / G5 (2026-10-27)
- **Definition of done (CLAUDE.md §5):** `web/` typecheck clean, all suites green (including fuzz and adversarial), `npm run build` ok, validator clean on every golden fixture in both modes: met. `mod/` `./gradlew build` ok and in-game smoke test passed (user-reported): met.
- **Open:** the manual slicer import of the sample castle (Bambu Studio, OrcaSlicer, PrusaSlicer: colours, Z heights, slot order, repair warnings). Files are in `web/fixtures-out/` (regenerate with the emit snippet in the Phase 3 notes if missing). Until that is recorded here, G3 and G5 are not fully closed.
- **Weaker than the plan asked for:** 2.5 and 5.3 were done by the code's author, not an independent verifier. The validator still accepts vertex-only contacts (spec gap, mitigated by repair).
- **Known limits carried forward:** no 64^3+ preview-only path; exports build on the main thread; main bundle 1.29 MB; only 2 of 3 samples; mod targets Fabric 1.21.1 only.

### Slicer check (2026-10-27)
- **Bambu Studio:** the sample castle `.3mf` imported and worked (user-reported; version and the itemised checks (colours at heights, slot order, repair warnings) were not recorded).
- **Not yet checked:** OrcaSlicer and PrusaSlicer (`prusa-slicer --info` for 0 open edges), and the Resin variant and mono STLs. The G3 manual step is met for Bambu only; CLAUDE.md §5 names all three slicers.

### Surface relief (2026-10-27)
Feature request after G5: make a single-colour print look textured by carving block-texture brightness into the surface (carve-only, chosen over raising because it never leaves the block).
- **Mod:** `core/ReliefSampler` (pure; 8 new JUnit tests incl. non-mirrored NORTH face and rotated UVs) + extractor samples per-face quads for `solid` states; payload gains optional `relief`. `./gradlew build`: 29 Java tests pass.
- **Web:** `payload` validation of `relief`; `meshingKernel/relief.ts` (+ `reliefLevels`), new pipeline stage `relief` between grid and fill, `reliefDepth` / `reliefInvert` options, UI section with nozzle warning and skip message, synthetic sample textures (`samples/relief.ts`) on the castle's stone, cobble, planks, grass and dirt. 271 web tests pass, including exact carved-cell checks for all six faces and an 80-payload fuzz (all watertight, deterministic).
- **Measured:** castle at depth 1 is about 1.07 M triangles (from 1.9 k), 3.4 s, 3MF export 11.3 MB in 3.3 s on the main thread, STL 61 MB. 48^3 Resin terrain would carve 893 k texels, so the budget skips relief (7 s, as without relief) instead of the 28 s / 7 M triangles it cost before the budget. Thresholds were raised from 0.5/1.0 to 1.0/1.5 sigma after the first measurement.
- **Not verified:** real Minecraft textures. Tests use synthetic maps; the mod's per-face UV sampling is unit-tested against vanilla-style quads but has not run in a world. Re-export a build in game and check that bricks, logs etc. look right, and that no face comes out mirrored. Also not checked: how a slicer or a real print handles 1 M-triangle meshes, and whether 0.25 mm pits are visible on your resin printer.
- **Known limits:** full cubes only (no stairs/slabs/fences); first quad per face (no overlays); brightness is a proxy for height; the viewer is not adaptive, so very dense meshes may be slow on weak GPUs.

### Public repo and hosted site (2026-10-27)
- **Repo is public** (https://github.com/ziggy46/VoxelMesh, MIT). Before the flip, all commits were rewritten to the GitHub no-reply identity (`ziggy46`) and force-pushed while still private; a scan of the whole local history found no real name, email or personal path. A backup of the pre-rewrite `.git` is in the session scratchpad only. GitHub may keep the old unreachable commits fetchable by hash for a while; they were never public.
- **Site:** https://ziggy46.github.io/VoxelMesh/ , deployed by `.github/workflows/pages.yml` (typecheck, tests, build with `VITE_BASE=/VoxelMesh/`). Verified live: page, assets and worker load over HTTPS, and the exact `#data=` link emitted by the Java code loads as a watertight "Shared build" with no console errors. The production build carries a Content-Security-Policy meta tag (own origin only); an external fetch from the page is blocked.
- **Mod fallback:** if the local relay is unreachable and the build fits (`maxLinkChars`, default 30,000 characters because Windows caps the browser command line), the mod opens the hosted site with the build in the URL fragment (never sent to a server); otherwise it keeps the saved file. `siteUrl` in `config/voxelmesh.json` controls or disables it. Only the Java side's link construction is tested; the in-game open-browser step for this fallback has not been run.
- **CI lesson:** the first deploy failed only on wall-clock assertions (GitHub runners are 2-3x slower). Performance budgets and the relief timing limits now run locally only (`CI` set skips them); fuzz tests get a longer timeout in CI.
- **Limits:** GitHub Pages cannot set HTTP headers, so the CSP is a meta tag (weaker than a header: no `frame-ancestors`). The hosted site has no relay, so `?build=` links only work on a local run.

### In-game bug: export did nothing visible (2026-10-27)
- **Symptom (user, Prism Launcher, Fabric Loader 0.20.1):** after `/vm export` only the saved path was printed; no browser opened, even though the local app was running.
- **Root cause:** the JDK `HttpClient` asks a plain-`http://` server to upgrade to HTTP/2 (`Upgrade: h2c`). The Vite dev server has a websocket `upgrade` listener, so Node never routes such a request to the relay: it hangs. Reproduced with curl (`--http1.1` POST: 201 in 4 ms; `--http2` POST: no answer in 8 s). The mod waited out its 30 s timeout and then fell back. It was missed in the first in-game test and in unit tests because nothing exercised a real Vite server.
- **Fix:** `RelayClient` (moved from the client source set into `core`) forces HTTP/1.1; connect timeout 5 s, request timeout 15 s. `RelayClientTest` fails if an `Upgrade` or `HTTP2-Settings` header is ever sent. Verified against the real running dev server: 201 in 138 ms.
- **Second silent failure removed:** Minecraft's `Util.OperatingSystem.open` discards the OS command's result. New `BrowserOpener` runs the command, checks the exit status, only opens http(s), and the chat now says when the OS refused. Verified on macOS (accepted in 86 ms; `file:` URLs refused).
- **Also seen in the same log:** `/vm save` prints only the path by design; it now adds `[Open folder]` and `[Open VoxelMesh]` buttons.
- **Still unverified in game:** the new jar's whole chat flow. 43 Java tests pass; the pieces were run for real outside Minecraft, but not inside a game.
- **Not fixed (server side):** the relay itself still never answers an `Upgrade: h2c` request when run under Vite. Only the mod was changed. Any other HTTP/2-upgrading client would hit the same hang.

### Relief redesign after real-build feedback (2026-10-27)
- **Feedback:** on a real in-game house (oak logs, glass, door) the preview "doesn't even look close" to the game.
- **Checked first:** the mod's sampled relief maps match the true textures from the Minecraft jar with correlation 1.000 on every face of every log variant, including the rotated logs (the sampling and orientation are exact). Block colour (`#6D5533` oak log) is also right.
- **Cause:** my relief carved only the darkest ~16% of texels as on/off pits, which threw away almost all tonal information; log-end rings and glass frames vanished.
- **Fix:** relief is now a real tonal depth map (`reliefLevels`): carve depth scales continuously with darkness, depth 1 to 3 texels, with automatic step-down to a shallower depth when the 600k-cell budget would be exceeded (`reliefUsedDepth`). On the real house the rings, bark grain and glass frames now show. 275 web tests pass (275, or 273 plus 2 CI-skipped).
- **Cost on the real house:** 17k / 46k / 63k texels carved at depth 1 / 2 / 3, 59k / 90k / 120k triangles, about 0.26 s. The synthetic castle fits only depth 1 (390k texels, 1.4 M triangles, 4.3 s) and steps down from 2 and 3.
- **Not changed, and still different from the game:** the model is one flat colour per filament slot (no per-face colours, so bark vs ring tone is shape only); glass is a solid light-blue block, not transparent; the preview has no texture colours. Those are design limits, not bugs.

### UI redesign and relief default (2026-10-27)
- **Relief:** depth is fixed at 1 and on by default; the 4-way depth picker is gone. The panel has a single "Carve the textures" switch (disabled when a build carries no texture data) plus Invert. The kernel still supports depths 2 and 3; only the UI no longer offers them. Consequence: the sample castle and terrain now mesh with relief on load (about 4 s natively, 1.4 M triangles); real builds are far smaller.
- **Redesign:** frosted dark glass with an emerald accent (user's choice from three directions). Full-window viewport with floating glass panels, a view-mode pill, a real empty state, window-wide drag and drop, a drawn icon set, themed scrollbars, sliders and focus. Shared kit in `web/src/ui/kit.tsx`; tokens in `web/src/index.css`; record in `DESIGN.md`.
- **Verified in a browser:** 1024 x 768 desktop (empty, loading, loaded, scrolled panel), 375 px phone (no horizontal overflow), production build under the strict CSP (zero violations, no console errors, castle meshes in the worker). The design detector reported no findings. 275 web tests pass (273 plus 2 CI-skipped).
- **Not done / caveats:** the skill's subagent finish review and documenter were skipped because agents are ruled out for this project (disclosed; DESIGN.md was written by hand). Keyboard focus and contrast were checked by construction (2 px emerald focus ring, muted text 6:1) and the detector, not by a screen-reader or measured pass. Not tested on Safari or Firefox, where `backdrop-filter` and the range-slider styling differ; a solid fallback exists for glass.
- **Known visual limit:** at 1024 px the panels leave only about 350 px of clear viewport; wider windows give the model more room.

### Build plate picker and panel edge (2026-10-27)
- **Build plate:** three presets per printer type plus a custom width x depth (`web/src/ui/derive.ts`: `BED_PRESETS`, `bedFor`, `clampBedMm`), a new "Build plate" section, and the plate size now drives the viewport grid and the "fits the plate" message. No brand names in the UI. Changing the plate never re-meshes. 3 new unit tests (278 web tests pass).
- **Checked in a browser (1024 x 768):** presets render and select, custom inputs accept 300 and clamp an out-of-range 5 to 20 on blur, the readout and viewport plate update, the castle reports "Fits the 300 x 180 mm plate".
- **Panel edge:** scrolling panel bodies now fade at the bottom with matching padding (`.scroll-fade`) instead of being cut through a divider, and slider keyboard focus is drawn on the round thumb instead of a square outline.
- **Not done:** the resin presets (130x80, 192x120, 218x123) are my picks for common LCD sizes, not checked against a vendor list; mod and exporters are unchanged. Slicer names still appear in docs and one code comment as compatibility notes (for example the 3MF `model_settings.config` hint), not in the UI.

