package com.voxelmesh.util;

import com.voxelmesh.core.BoxQuantizer;
import com.voxelmesh.core.Category;
import com.voxelmesh.core.ColorMath;
import com.voxelmesh.core.PaletteEntry;
import com.voxelmesh.core.ReliefSampler;
import com.voxelmesh.mixin.SpriteContentsAccessor;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.HashSet;
import java.util.List;
import java.util.Map;
import java.util.Set;
import net.minecraft.block.BlockState;
import net.minecraft.client.MinecraftClient;
import net.minecraft.client.render.model.BakedModel;
import net.minecraft.client.render.model.BakedQuad;
import net.minecraft.client.texture.NativeImage;
import net.minecraft.client.texture.Sprite;
import net.minecraft.client.texture.SpriteContents;
import net.minecraft.client.world.ClientWorld;
import net.minecraft.block.Block;
import net.minecraft.registry.Registries;
import net.minecraft.registry.RegistryKeys;
import net.minecraft.registry.tag.BlockTags;
import net.minecraft.registry.tag.TagKey;
import net.minecraft.util.Identifier;
import net.minecraft.util.math.BlockPos;
import net.minecraft.util.math.Direction;
import net.minecraft.util.math.random.Random;
import net.minecraft.util.math.Box;
import net.minecraft.util.shape.VoxelShape;

/**
 * Turns a BlockState into its sub-voxel boxes, category and average texture colour (docs/02 §4, docs/01 §4).
 * Results are cached per state: shapes and sprites depend on the state, not the position. The one exception is
 * position-offset plants, which are cached at the first position seen (they are foliage and replaced by a stock box anyway).
 */
public final class BlockGeometryExtractor {
    /** Stand-in boxes from docs/01 §4. */
    private static final List<int[]> FLUID_BOXES = List.of(new int[] {0, 0, 0, 16, 14, 16});
    private static final List<int[]> FOLIAGE_BOXES = List.of(new int[] {4, 0, 4, 12, 10, 12});

    /**
     * `relief` is 1536 luma bytes for full-cube blocks (see ReliefSampler), else null. `faceRgb` is each face's untinted average
     * colour (-1 = no data) and `faceTintMask` marks the biome-tinted faces; both are null for blocks that are not full cubes.
     */
    public record StateInfo(Category category, List<int[]> boxes, int rgb, byte[] relief, List<String> tags, int[] faceRgb, int faceTintMask) {}

    /** Fabric's convention tags for glass; mods that tag their glass this way are covered without knowing them. */
    private static final TagKey<Block> GLASS_BLOCKS = TagKey.of(RegistryKeys.BLOCK, Identifier.of("c", "glass_blocks"));
    private static final TagKey<Block> GLASS_PANES = TagKey.of(RegistryKeys.BLOCK, Identifier.of("c", "glass_panes"));

    private final Map<BlockState, StateInfo> cache = new HashMap<>();
    private final Set<BlockState> invisible = new HashSet<>();
    private final MinecraftClient client = MinecraftClient.getInstance();

    /** @return the geometry, or null when the state has no shape and no fluid (barriers, light blocks): treat as air */
    public StateInfo infoFor(BlockState state, ClientWorld world, BlockPos pos) {
        StateInfo hit = cache.get(state);
        if (hit != null) return hit;
        if (invisible.contains(state)) return null;
        StateInfo computed = compute(state, world, pos);
        if (computed == null) invisible.add(state);
        else cache.put(state, computed);
        return computed;
    }

    private StateInfo compute(BlockState state, ClientWorld world, BlockPos pos) {
        VoxelShape outline = state.getOutlineShape(world, pos);
        VoxelShape collision = state.getCollisionShape(world, pos);

        Category category;
        List<int[]> boxes;
        if (outline.isEmpty() && !state.getFluidState().isEmpty()) {
            category = Category.FLUID;
            boxes = FLUID_BOXES;
        } else {
            // A modded block with an empty outline but a real collision shape must not vanish from prints (docs/01 §4).
            VoxelShape shape = outline.isEmpty() ? collision : outline;
            if (shape.isEmpty()) return null;
            if (collision.isEmpty() && isPlantLike(state)) {
                category = Category.FOLIAGE;
                boxes = FOLIAGE_BOXES;
            } else {
                boxes = quantize(shape);
                category = BoxQuantizer.classify(boxes);
            }
        }
        byte[] relief = category == Category.SOLID ? sampleRelief(state) : null;
        int[] faceRgb = new int[ReliefSampler.FACES];
        int tintMask = category == Category.SOLID ? sampleFaceColors(state, faceRgb) : -1;
        return new StateInfo(category, boxes, baseColor(state, world, pos), relief, tagsFor(state), tintMask < 0 ? null : faceRgb, Math.max(tintMask, 0));
    }

    /** Labels the web app can filter on: leaves (solid cubes full of holes) and glass (windows). */
    private static List<String> tagsFor(BlockState state) {
        List<String> tags = new ArrayList<>(2);
        if (state.isIn(BlockTags.LEAVES)) tags.add(PaletteEntry.LEAVES);
        // Untagged modded glass is still caught by its id.
        if (state.isIn(GLASS_BLOCKS) || state.isIn(GLASS_PANES) || Registries.BLOCK.getId(state.getBlock()).getPath().contains("glass")) {
            tags.add(PaletteEntry.GLASS);
        }
        return tags;
    }

    private static boolean isPlantLike(BlockState state) {
        return state.isIn(BlockTags.FLOWERS) || state.isIn(BlockTags.CROPS) || state.isIn(BlockTags.SAPLINGS)
            || state.isIn(BlockTags.REPLACEABLE);
    }

    private static List<int[]> quantize(VoxelShape shape) {
        List<int[]> raw = new ArrayList<>();
        for (Box b : shape.getBoundingBoxes()) raw.add(BoxQuantizer.quantize(b.minX, b.minY, b.minZ, b.maxX, b.maxY, b.maxZ));
        return BoxQuantizer.dedupe(raw);
    }

    /** Average sprite colour (alpha-weighted, first frame), else the block's map colour. 0xRRGGBB, untinted. */
    private int baseColor(BlockState state, ClientWorld world, BlockPos pos) {
        int avg = averageSpriteColor(state);
        return avg >= 0 ? avg : state.getMapColor(world, pos).color;
    }

    private record Pixels(int[] abgr, int w, int h) {}

    /** First-frame RGBA pixels of a sprite (animated sprites stack frames vertically; only the first is read). */
    private static Pixels pixelsOf(Sprite sprite) {
        SpriteContents contents = sprite.getContents();
        NativeImage image = ((SpriteContentsAccessor) contents).voxelmesh$getImage();
        int w = contents.getWidth(), h = contents.getHeight();
        int[] pixels = new int[w * h];
        for (int y = 0; y < h; y++)
            for (int x = 0; x < w; x++) pixels[x + y * w] = image.getColor(x, y);
        return new Pixels(pixels, w, h);
    }

    private int averageSpriteColor(BlockState state) {
        try {
            BakedModel model = client.getBlockRenderManager().getModels().getModel(state);
            return ColorMath.averageAbgr(pixelsOf(model.getParticleSprite()).abgr());
        } catch (RuntimeException e) {
            return -1; // closed or non-RGBA image: fall back to the map colour
        }
    }

    /**
     * Average colour of each face's own full-face quad (first one only, so overlays such as the grass side tint are ignored).
     * Fills `out` with 0xRRGGBB or -1 and returns the mask of faces whose quad is biome-tinted, or -1 when no face was readable.
     */
    private int sampleFaceColors(BlockState state, int[] out) {
        java.util.Arrays.fill(out, -1);
        BakedModel model;
        try {
            model = client.getBlockRenderManager().getModels().getModel(state);
        } catch (RuntimeException e) {
            return -1;
        }
        int mask = 0;
        boolean any = false;
        for (int f = 0; f < ReliefSampler.FACES; f++) {
            try {
                for (BakedQuad quad : model.getQuads(state, Direction.byId(f), Random.create(42L))) {
                    int[] v = quad.getVertexData();
                    float[] xyz = new float[12];
                    for (int i = 0; i < 4; i++) {
                        xyz[3 * i] = Float.intBitsToFloat(v[i * 8]);
                        xyz[3 * i + 1] = Float.intBitsToFloat(v[i * 8 + 1]);
                        xyz[3 * i + 2] = Float.intBitsToFloat(v[i * 8 + 2]);
                    }
                    if (!ReliefSampler.coversFace(f, xyz)) continue;
                    out[f] = ColorMath.averageAbgr(pixelsOf(quad.getSprite()).abgr());
                    if (quad.getColorIndex() == 0) mask |= 1 << f;
                    any |= out[f] >= 0;
                    break;
                }
            } catch (RuntimeException e) {
                out[f] = -1;
            }
        }
        return any ? mask : -1;
    }

    /**
     * Six 16x16 brightness maps (DOWN, UP, NORTH, SOUTH, WEST, EAST) from each face's own quad and sprite. A face with no
     * full-face quad (or an unreadable sprite) stays flat, so it never produces relief. Only the first full-face quad is
     * used: overlay layers (grass side tint) are ignored.
     */
    private byte[] sampleRelief(BlockState state) {
        BakedModel model;
        try {
            model = client.getBlockRenderManager().getModels().getModel(state);
        } catch (RuntimeException e) {
            return null;
        }
        byte[][] faces = new byte[ReliefSampler.FACES][];
        boolean any = false;
        for (int f = 0; f < ReliefSampler.FACES; f++) {
            try {
                Direction dir = Direction.byId(f);
                for (BakedQuad quad : model.getQuads(state, dir, Random.create(42L))) {
                    int[] v = quad.getVertexData();
                    float[] xyz = new float[12];
                    float[] uv = new float[8];
                    Sprite sprite = quad.getSprite();
                    float du = sprite.getMaxU() - sprite.getMinU(), dv = sprite.getMaxV() - sprite.getMinV();
                    for (int i = 0; i < 4; i++) {
                        int o = i * 8; // x,y,z, colour, u, v, light, normal
                        xyz[3 * i] = Float.intBitsToFloat(v[o]);
                        xyz[3 * i + 1] = Float.intBitsToFloat(v[o + 1]);
                        xyz[3 * i + 2] = Float.intBitsToFloat(v[o + 2]);
                        uv[2 * i] = (Float.intBitsToFloat(v[o + 4]) - sprite.getMinU()) / du;
                        uv[2 * i + 1] = (Float.intBitsToFloat(v[o + 5]) - sprite.getMinV()) / dv;
                    }
                    if (!ReliefSampler.coversFace(f, xyz)) continue;
                    Pixels px = pixelsOf(sprite);
                    faces[f] = ReliefSampler.sampleFace(f, xyz, uv, px.abgr(), px.w(), px.h());
                    any |= faces[f] != null;
                    break;
                }
            } catch (RuntimeException e) {
                faces[f] = null;
            }
        }
        return any ? ReliefSampler.combine(faces) : null;
    }
}
