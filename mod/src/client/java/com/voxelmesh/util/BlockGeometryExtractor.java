package com.voxelmesh.util;

import com.voxelmesh.core.BoxQuantizer;
import com.voxelmesh.core.Category;
import com.voxelmesh.core.ColorMath;
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
import net.minecraft.client.texture.NativeImage;
import net.minecraft.client.texture.Sprite;
import net.minecraft.client.texture.SpriteContents;
import net.minecraft.client.world.ClientWorld;
import net.minecraft.registry.tag.BlockTags;
import net.minecraft.util.math.BlockPos;
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

    public record StateInfo(Category category, List<int[]> boxes, int rgb) {}

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
        return new StateInfo(category, boxes, baseColor(state, world, pos));
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

    private int averageSpriteColor(BlockState state) {
        try {
            BakedModel model = client.getBlockRenderManager().getModels().getModel(state);
            Sprite sprite = model.getParticleSprite();
            SpriteContents contents = sprite.getContents();
            NativeImage image = ((SpriteContentsAccessor) contents).voxelmesh$getImage();
            int w = contents.getWidth(), h = contents.getHeight(); // one frame; animated strips stack frames vertically
            int[] pixels = new int[w * h];
            for (int y = 0; y < h; y++)
                for (int x = 0; x < w; x++) pixels[x + y * w] = image.getColor(x, y);
            return ColorMath.averageAbgr(pixels);
        } catch (RuntimeException e) {
            return -1; // closed or non-RGBA image: fall back to the map colour
        }
    }
}
