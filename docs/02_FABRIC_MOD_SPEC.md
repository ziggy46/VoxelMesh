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

### 4.2c Tags, duplicate merging and high-res packs
- **Tags.** Each palette entry gets `tags`: `leaves` when the block is in `BlockTags.LEAVES`; `glass` when it is in `c:glass_blocks` or `c:glass_panes`, or its id path contains "glass" (modded fallback). The web app uses them for the "Include glass" / "Include leaves" switches. The loader accepts at most 16 tags of at most 32 characters each.
- **Duplicate merging.** Block states that produce identical content (category, boxes, colour, relief, tags) share one palette entry (`PaletteEntry.contentKey`, which ignores id and name), so a palette no longer carries dozens of look-alike stairs or log axes.
- **High-res packs.** `ReliefSampler.footprintLuma` averages the `round(w/16) x round(h/16)` pixel footprint of each texel instead of a single pixel, so 32x or 64x resource packs give a smoothed map; at 16 px it is identical to the old behaviour.

### 4.2d Face colours
For `solid` states the extractor averages the sprite of each face's own full-face quad (first quad only, so overlays are ignored). Quads with colour index 0 are biome-tinted: the tint is applied per position in `PayloadBuilder` (like the block colour), not in the cached `StateInfo`. `core/FaceColors.resolve` returns six `#RRGGBB` strings, or an empty list when no two faces are at least 40 apart in RGB (so stone, dirt and leaves stay one colour). Faces with no readable quad use the block colour. `faces` is part of `PaletteEntry.contentKey`, so merging never mixes a grass block with a plain one.

### 4.2e Entity capture (`entity/`, `core/EntityVoxelizer`, `core/BoxMerger`)
After the block scan, entities in the selection (not players, XP orbs, effect clouds, bobbers, lightning, text displays; at most 400) are captured by asking the game to render each one into a recorder instead of the screen: `EntityRenderDispatcher.render` at (position - selection origin) with a `VertexConsumerProvider` that records every quad and triangle (`CaptureProvider`). Whatever the renderer draws is captured, including armor, held items, paintings and modded entities, and it follows resource packs. Effect layers (glint, eyes, energy swirl, outlines, lines, text, shadows, leash) are skipped.
- **Colour:** each vertex's texture coordinate is looked up in the layer's texture (`EntityTextures`): a plain image from the resource pack, or a sprite atlas (items, paintings, armor trims) mapped back to its sprite. Texture times vertex colour; texels under 50% alpha are dropped. Textures that exist only on the GPU (player skins, maps) make the layer unusable.
- **Voxelizing:** triangles are sampled finely and each sample marks its cell, nudged inward so faces on a cell boundary land inside. Empty cells the outside cannot reach become interior and take the nearest shell colour; open surfaces (paintings) stay a thin sheet. Space beyond 4M cells skips the entity. Cells are merged greedily into boxes (at most 20,000 per entity) and clipped to the selection.
- **Safety:** capture runs in one tick after the blocks, and any failure is a chat warning and an empty list, never a failed block export.
- **Access:** four mixin accessors (`MultiPhaseAccessor`, `MultiPhaseParametersAccessor`, `TextureBaseInvoker`, `SpriteAtlasAccessor`) read a layer's texture id and an atlas's sprite list.
- **Limits:** a pose is frozen at capture time; mobs on fire or wearing glinting armor show without the effect; the entity's own lighting and animation state are whatever the game had.

### 4.3 Stretch (v2, out of scope now)

## 5. `CompanionUploader`
Java 21 `HttpClient`, 10 s timeout, async; success → open browser; failure → local file fallback. No telemetry, no other hosts. The relay URL must be loopback unless the user edits the config explicitly; a non-loopback host triggers a one-time chat warning.
