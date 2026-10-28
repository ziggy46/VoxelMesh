package com.voxelmesh.entity;

import com.voxelmesh.core.EntityVoxelizer;
import com.voxelmesh.mixin.MultiPhaseAccessor;
import com.voxelmesh.mixin.MultiPhaseParametersAccessor;
import com.voxelmesh.mixin.SpriteAtlasAccessor;
import com.voxelmesh.mixin.SpriteContentsAccessor;
import com.voxelmesh.mixin.TextureBaseInvoker;
import java.io.InputStream;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.IdentityHashMap;
import java.util.List;
import java.util.Map;
import java.util.Optional;
import net.minecraft.client.MinecraftClient;
import net.minecraft.client.render.RenderLayer;
import net.minecraft.client.render.RenderPhase;
import net.minecraft.client.texture.AbstractTexture;
import net.minecraft.client.texture.NativeImage;
import net.minecraft.client.texture.Sprite;
import net.minecraft.client.texture.SpriteAtlasTexture;
import net.minecraft.client.texture.SpriteContents;
import net.minecraft.resource.Resource;
import net.minecraft.util.Identifier;

/**
 * Finds the pixels behind a render layer's texture so a texture coordinate can be turned into a colour: a plain image from the
 * resource packs for most entities, or one of the game's sprite atlases (items, paintings, armor trims). Textures that exist
 * only on the GPU (player skins, maps) cannot be read and make the layer unusable.
 */
final class EntityTextures {
    /** A layer's usable texture: `tex` is null for a layer drawn in plain vertex colour. */
    record Resolved(EntityVoxelizer.Texture tex) {}

    private static final int GRID = 64;

    private final MinecraftClient client = MinecraftClient.getInstance();
    private final Map<Identifier, Optional<EntityVoxelizer.Texture>> byId = new HashMap<>();
    private final Map<SpriteContents, int[]> spritePixels = new IdentityHashMap<>();

    /** @return null when the layer's texture cannot be read; `new Resolved(null)` when it has none */
    Resolved resolve(RenderLayer layer) {
        Optional<Identifier> id = textureId(layer);
        if (id.isEmpty()) return new Resolved(null);
        Optional<EntityVoxelizer.Texture> tex = byId.computeIfAbsent(id.get(), this::load);
        return tex.map(Resolved::new).orElse(null);
    }

    static Optional<Identifier> textureId(RenderLayer layer) {
        if (!((Object) layer instanceof MultiPhaseAccessor multi)) return Optional.empty();
        RenderPhase.TextureBase base = ((MultiPhaseParametersAccessor) (Object) multi.voxelmesh$phases()).voxelmesh$texture();
        return base == null ? Optional.empty() : ((TextureBaseInvoker) base).voxelmesh$id();
    }

    private Optional<EntityVoxelizer.Texture> load(Identifier id) {
        try {
            if (id.getPath().startsWith("textures/atlas/")) return atlas(id);
            Optional<Resource> res = client.getResourceManager().getResource(id);
            if (res.isEmpty()) return Optional.empty();
            try (InputStream in = res.get().getInputStream(); NativeImage image = NativeImage.read(in)) {
                int w = image.getWidth(), h = image.getHeight();
                int[] argb = new int[w * h];
                for (int y = 0; y < h; y++)
                    for (int x = 0; x < w; x++) argb[x + y * w] = abgrToArgb(image.getColor(x, y));
                return Optional.of((u, v) -> argb[clamp((int) Math.floor(u * w), w) + clamp((int) Math.floor(v * h), h) * w]);
            }
        } catch (Exception | LinkageError e) {
            return Optional.empty();
        }
    }

    private Optional<EntityVoxelizer.Texture> atlas(Identifier id) {
        AbstractTexture t = client.getTextureManager().getTexture(id);
        if (!(t instanceof SpriteAtlasTexture atlas)) return Optional.empty();
        List<Sprite> sprites = new ArrayList<>(((SpriteAtlasAccessor) atlas).voxelmesh$sprites().values());
        List<List<Sprite>> grid = new ArrayList<>(GRID * GRID);
        for (int i = 0; i < GRID * GRID; i++) grid.add(null);
        for (Sprite s : sprites) {
            if (s.getMaxU() <= s.getMinU() || s.getMaxV() <= s.getMinV()) continue;
            int u0 = cell(s.getMinU()), u1 = cell(s.getMaxU()), v0 = cell(s.getMinV()), v1 = cell(s.getMaxV());
            for (int gv = v0; gv <= v1; gv++)
                for (int gu = u0; gu <= u1; gu++) {
                    List<Sprite> l = grid.get(gu + gv * GRID);
                    if (l == null) grid.set(gu + gv * GRID, l = new ArrayList<>(2));
                    l.add(s);
                }
        }
        return Optional.of((u, v) -> {
            List<Sprite> l = grid.get(cell(u) + cell(v) * GRID);
            if (l == null) return 0;
            for (Sprite s : l) {
                if (u < s.getMinU() || u > s.getMaxU() || v < s.getMinV() || v > s.getMaxV()) continue;
                SpriteContents c = s.getContents();
                int[] px = spritePixels.computeIfAbsent(c, EntityTextures::pixelsOf);
                int w = c.getWidth(), h = c.getHeight();
                int x = clamp((int) Math.floor((u - s.getMinU()) / (s.getMaxU() - s.getMinU()) * w), w);
                int y = clamp((int) Math.floor((v - s.getMinV()) / (s.getMaxV() - s.getMinV()) * h), h);
                return px[x + y * w];
            }
            return 0;
        });
    }

    private static int[] pixelsOf(SpriteContents contents) {
        NativeImage image = ((SpriteContentsAccessor) contents).voxelmesh$getImage();
        int w = contents.getWidth(), h = contents.getHeight();
        int[] argb = new int[w * h];
        for (int y = 0; y < h; y++)
            for (int x = 0; x < w; x++) argb[x + y * w] = abgrToArgb(image.getColor(x, y));
        return argb;
    }

    private static int cell(double uv) { return Math.max(0, Math.min(GRID - 1, (int) (uv * GRID))); }
    private static int clamp(int v, int size) { return Math.max(0, Math.min(size - 1, v)); }

    /** NativeImage stores ABGR (red in the low byte); the voxelizer wants ARGB. */
    private static int abgrToArgb(int abgr) {
        return (abgr & 0xFF00FF00) | (abgr >> 16 & 0xFF) | (abgr & 0xFF) << 16;
    }
}
