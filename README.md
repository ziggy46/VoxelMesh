# VoxelMesh

Turn a Minecraft build into a 3D-print-ready model with real block geometry and multi-colour support. Everything runs on your own machine or in your own browser: builds are never uploaded.

- **`mod/`**: a Fabric client mod for Minecraft **1.21.1** (Java 21). Select two corners, run `/vm export`, and the mod reads each block's real shape and its average texture colour.
- **`web/`**: the web app (Vite, React 19, TypeScript, Three.js). A Web Worker builds a sparse sub-voxel grid, applies FDM or Resin rules, repairs non-manifold geometry, previews the result in 3D, and exports a watertight multi-colour `.3MF` or a binary `.STL`.

## What makes it different

- **Real geometry.** Stairs, slabs, fences, chains and modded shapes keep their sub-voxel form (16×16×16 per block), not just cubes.
- **Printer-aware.** FDM thickens features below the nozzle wall and fills sealed cavities. Resin keeps native detail.
- **Provably watertight.** Every colour bucket must pass an in-app manifold check before export, and the UI says so if one does not.
- **Surface relief.** Optionally carves the block textures' brightness into the surface, so even a single-colour print looks textured.
- **Deterministic.** The same build and settings give byte-identical output.
- **Local-first.** The app makes no third-party requests. The hosted site ships a Content-Security-Policy that limits it to its own origin.

## Use it

**Web app** (needs Node 22+):

```bash
cd web
npm install
npm run dev        # http://127.0.0.1:5173
```

**Mod**: build with JDK 21, then put `mod/build/libs/voxelmesh-0.1.0.jar` and [Fabric API](https://modrinth.com/mod/fabric-api) in your `mods` folder (Minecraft 1.21.1, Fabric Loader 0.16+):

```bash
cd mod
JAVA_HOME=$(/usr/libexec/java_home -v 21) ./gradlew build
```

In game, look at a block and press `[`, look at the opposite corner and press `]`, then run `/vm export My Build`.

### How a build reaches the app

1. **Local app running** (`npm run dev`): the mod posts the build to a relay on `127.0.0.1` and opens your browser on it. Works for any size.
2. **Local app not running**: if the build is small enough, the mod opens the hosted site with the build inside the URL fragment (`#data=…`). Browsers never send a fragment to a server, so nothing is uploaded; the page decodes it itself.
3. **Too big for a link**: the build is saved to `.minecraft/voxelmesh/`. Drag the file onto the app.

Config lives in `config/voxelmesh.json` (`relayUrl`, `siteUrl`, `maxLinkChars`, `tickSliceBlocks`). Set `siteUrl` to `""` to disable the hosted fallback.

## Develop

```bash
cd web && npm test && npm run build      # Vitest, typecheck, production build
cd mod && ./gradlew build                # compile, JUnit, remapped jar
```

`CLAUDE.md` holds the project invariants and `docs/` the specs (payload format, meshing engine, colour and 3MF export, validation). `docs/BUILD_STATUS.md` records what has been verified and what has not.

## Status

Working end to end: capture in game, preview, FDM and Resin meshing, validated `.3MF` and `.STL` export. The sample castle imports into Bambu Studio. Not yet checked in other slicers. Known limits: Fabric 1.21.1 only; surface relief covers full-cube blocks only and is skipped on very large builds; very large selections (64³ blocks and up) have no reduced-quality preview path yet.

Licensed under the [MIT License](LICENSE). Minecraft is a trademark of Mojang AB. This project is not affiliated with or endorsed by Mojang or Microsoft, and contains no Minecraft code or assets.
