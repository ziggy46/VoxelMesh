# 02 — Fabric Client Mod Specification (`mod/`)

## 1. Environment
- Minecraft 1.21.1, Fabric Loader ≥ 0.16.0, Fabric API, Java 21.
- Client-only (`"environment": "client"`), so it works on any server with no server install.
- Mod id `voxelmesh`, package `com.voxelmesh`. Mappings: Yarn for 1.21.1. **The compiler is the arbiter of symbol names**; anything uncertain is flagged in a comment.

## 2. Interaction
- Keybinds: `[` sets Pos1 and `]` sets Pos2 at the targeted block (`client.crosshairTarget`).
- Client commands (`ClientCommandRegistrationCallback`): `/vm pos1 [x y z]`, `/vm pos2 [x y z]`, `/vm export [title]`, `/vm save [name]`, `/vm clear`.
- `export`: captures the region, builds the payload, POSTs to the relay (URL in `config/voxelmesh.json`, default `http://127.0.0.1:5173/api/builds`), writes a local backup, opens the browser URL. Relay unreachable → falls back to save + chat message with the file path.
- Wireframe: `WorldRenderEvents.LAST` draws a translucent cyan box over `[min, max+1]`; HUD shows dimensions and block count.
- Safety: warn above 64³ blocks, refuse above 128³ (2,097,152 blocks).

## 3. Capture must not freeze the game
`PayloadBuilder` scans in **tick slices** (default 20,000 blocks per client tick via `ClientTickEvents.END_CLIENT_TICK`), showing progress on the HUD. Blocks in unloaded chunks are recorded as air and counted; the export summary reports "N blocks were in unloaded chunks". Cancel with `/vm clear`.

## 4. `BlockGeometryExtractor` (delegation D5)

### 4.1 Shape → boxes
```java
VoxelShape shape = state.getOutlineShape(world, pos);
if (shape.isEmpty()) shape = state.getCollisionShape(world, pos);   // modded blocks with odd outlines
for (Box b : shape.getBoundingBoxes()) {
    int minX = clamp(round(b.minX * 16), 0, 16);  // same for Y, Z
    int maxX = Math.max(minX + 1, clamp(round(b.maxX * 16), 0, 16));
    ...
}
```
Merge identical boxes. Results are cached per `BlockState` (palette entries are per state, not per position), but see color caveat below.

### 4.2 Average color (works with modded blocks and resource packs)
1. `BakedModel model = client.getBlockRenderManager().getModels().getModel(state);`
2. `Sprite sprite = model.getParticleSprite();`
3. Read pixels from the sprite's `SpriteContents` first frame. The `image` field is private, so use a **Mixin accessor** (`SpriteContentsAccessor#getImage()`); do not use reflection.
4. Alpha-weighted average RGB over pixels with alpha > 0; empty result → `state.getMapColor(world, pos).color`.
5. Tint: `client.getBlockColors().getColor(state, world, pos, 0)`; if ≠ −1, multiply channels (grass, leaves, vines, water).
6. Output `#RRGGBB`.

Caveat: tint depends on position (biome), so the palette key is `(state, tint)`, not just `state`. Use the palette id `"<state>"` plus a `#RRGGBB` suffix hash when tints differ across the selection; the web app only uses `color` and `boxes`, never parses the id.

### 4.2b Relief maps
For `solid` states the extractor also samples six 16×16 brightness maps (`docs/01 §3b`): for each face it takes the first model quad from `getQuads(state, direction, …)` whose vertices lie on that face and span all of it, maps each texel centre through the quad's own vertex positions and UVs to a sprite pixel (first animation frame), and stores Rec. 709 luma (mostly transparent pixels count as 128). Overlay layers (the grass side tint) are ignored. `core/ReliefSampler` holds the maths (no Minecraft types, unit-tested); the extractor only feeds it quad data.

### 4.3 Stretch (v2, out of scope now)
Per-face colors (grass top vs. side) by splitting multi-colored blocks into face-colored sub-boxes.

## 5. `CompanionUploader`
Java 21 `HttpClient`, 10 s timeout, async; success → open browser; failure → local file fallback. No telemetry, no other hosts. The relay URL must be loopback unless the user edits the config explicitly; a non-loopback host triggers a one-time chat warning.
