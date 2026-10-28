package com.voxelmesh.core;

import java.util.List;

/** Voxelizes the triangles of one block state's model into a {@link BlockModel}. Pure: no Minecraft types. */
public final class BlockModelBuilder {
    private BlockModelBuilder() {}

    /**
     * @param tris    the model's triangles in cells (0..16 per axis, Minecraft axes)
     * @param outline the block's hitbox boxes; only cells inside them are filled (so a cauldron stays hollow), while the
     *                surface the model draws is always kept
     * @return the model, or null when nothing was drawn inside the block
     */
    public static BlockModel build(List<EntityVoxelizer.Tri> tris, List<int[]> outline) {
        EntityVoxelizer.Grid g = EntityVoxelizer.voxelize(tris, 1_000_000, EntityVoxelizer.Fill.ENCLOSED, (x, y, z) -> inside(outline, x, y, z));
        if (g == null) return null;
        EntityRecord r = BoxMerger.merge("block", g, 16, 16, 16);
        return r == null ? null : new BlockModel(r.palette(), r.boxes());
    }

    private static boolean inside(List<int[]> boxes, int x, int y, int z) {
        for (int[] b : boxes) if (x >= b[0] && x < b[3] && y >= b[1] && y < b[4] && z >= b[2] && z < b[5]) return true;
        return false;
    }
}
