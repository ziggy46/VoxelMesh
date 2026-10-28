package com.voxelmesh.core;

import static org.junit.jupiter.api.Assertions.*;

import com.google.gson.JsonObject;
import com.google.gson.JsonParser;
import java.nio.charset.StandardCharsets;
import java.util.ArrayList;
import java.util.List;
import org.junit.jupiter.api.Test;

class BlockModelTest {
    private static final List<int[]> FULL = List.of(new int[] {0, 0, 0, 16, 16, 16});

    private static void quad(List<EntityVoxelizer.Tri> out, float[] a, float[] b, float[] c, float[] d, float[] n, int rgb) {
        float[] uv = new float[6];
        int[] col = {rgb, rgb, rgb};
        out.add(new EntityVoxelizer.Tri(new float[] {a[0], a[1], a[2], b[0], b[1], b[2], c[0], c[1], c[2]}, uv, col, n, null));
        out.add(new EntityVoxelizer.Tri(new float[] {a[0], a[1], a[2], c[0], c[1], c[2], d[0], d[1], d[2]}, uv, col, n, null));
    }

    /** A cuboid from the faces in `faces` (bit 0..5 = -z, +z, -x, +x, -y, +y). */
    private static List<EntityVoxelizer.Tri> cuboid(float x0, float y0, float z0, float x1, float y1, float z1, int rgb, int faces) {
        List<EntityVoxelizer.Tri> t = new ArrayList<>();
        if ((faces & 1) != 0) quad(t, new float[] {x0, y0, z0}, new float[] {x1, y0, z0}, new float[] {x1, y1, z0}, new float[] {x0, y1, z0}, new float[] {0, 0, -1}, rgb);
        if ((faces & 2) != 0) quad(t, new float[] {x0, y0, z1}, new float[] {x1, y0, z1}, new float[] {x1, y1, z1}, new float[] {x0, y1, z1}, new float[] {0, 0, 1}, rgb);
        if ((faces & 4) != 0) quad(t, new float[] {x0, y0, z0}, new float[] {x0, y1, z0}, new float[] {x0, y1, z1}, new float[] {x0, y0, z1}, new float[] {-1, 0, 0}, rgb);
        if ((faces & 8) != 0) quad(t, new float[] {x1, y0, z0}, new float[] {x1, y1, z0}, new float[] {x1, y1, z1}, new float[] {x1, y0, z1}, new float[] {1, 0, 0}, rgb);
        if ((faces & 16) != 0) quad(t, new float[] {x0, y0, z0}, new float[] {x1, y0, z0}, new float[] {x1, y0, z1}, new float[] {x0, y0, z1}, new float[] {0, -1, 0}, rgb);
        if ((faces & 32) != 0) quad(t, new float[] {x0, y1, z0}, new float[] {x1, y1, z0}, new float[] {x1, y1, z1}, new float[] {x0, y1, z1}, new float[] {0, 1, 0}, rgb);
        return t;
    }

    private static long cells(BlockModel m) {
        long n = 0;
        for (int[] b : m.boxes()) n += (long) (b[3] - b[0]) * (b[4] - b[1]) * (b[5] - b[2]);
        return n;
    }

    private static boolean has(BlockModel m, int x, int y, int z) {
        for (int[] b : m.boxes()) if (x >= b[0] && x < b[3] && y >= b[1] && y < b[4] && z >= b[2] && z < b[5]) return true;
        return false;
    }

    @Test
    void aCuboidMissingAHiddenFaceIsStillSolid() {
        BlockModel m = BlockModelBuilder.build(cuboid(6, 0, 6, 10, 12, 10, 0x804020, 63 & ~16), FULL); // no bottom face
        assertNotNull(m);
        assertEquals(4 * 12 * 4, cells(m));
        assertTrue(has(m, 7, 6, 7));
        assertFalse(has(m, 5, 6, 7));
    }

    @Test
    void gapsBetweenRailsStayOpen() {
        // two rails along x at heights 6..9 and 12..15, depth 7..9, as in a fence
        List<EntityVoxelizer.Tri> t = cuboid(0, 6, 7, 16, 9, 9, 0xE0B0A0, 63);
        t.addAll(cuboid(0, 12, 7, 16, 15, 9, 0xE0B0A0, 63));
        BlockModel m = BlockModelBuilder.build(t, FULL); // the hitbox is the whole block: the gap is inside it
        assertNotNull(m);
        assertEquals(2 * 16 * 3 * 2, cells(m));
        assertTrue(has(m, 8, 7, 8));
        assertFalse(has(m, 8, 10, 8), "the gap between the rails");
        assertFalse(has(m, 8, 5, 8));
    }

    @Test
    void aBowlStaysHollowWhenTheHitboxIsHollow() {
        // floor plus four walls, no top, like a cauldron; the hitbox excludes the inside
        List<EntityVoxelizer.Tri> t = new ArrayList<>();
        t.addAll(cuboid(0, 0, 0, 16, 2, 16, 0x333333, 63));
        t.addAll(cuboid(0, 2, 0, 16, 12, 2, 0x333333, 63));
        t.addAll(cuboid(0, 2, 14, 16, 12, 16, 0x333333, 63));
        t.addAll(cuboid(0, 2, 2, 2, 12, 14, 0x333333, 63));
        t.addAll(cuboid(14, 2, 2, 16, 12, 14, 0x333333, 63));
        List<int[]> hitbox = List.of(new int[] {0, 0, 0, 16, 2, 16}, new int[] {0, 2, 0, 16, 12, 2}, new int[] {0, 2, 14, 16, 12, 16},
            new int[] {0, 2, 2, 2, 12, 14}, new int[] {14, 2, 2, 16, 12, 14});
        BlockModel m = BlockModelBuilder.build(t, hitbox);
        assertNotNull(m);
        assertTrue(has(m, 1, 5, 8), "wall");
        assertFalse(has(m, 8, 6, 8), "inside the bowl");
    }

    @Test
    void aFlatSheetStaysASheet() {
        List<EntityVoxelizer.Tri> t = new ArrayList<>();
        quad(t, new float[] {2, 0, 8}, new float[] {14, 0, 8}, new float[] {14, 16, 8}, new float[] {2, 16, 8}, new float[] {0, 0, 1}, 0x44AA44);
        BlockModel m = BlockModelBuilder.build(t, FULL);
        assertNotNull(m);
        assertEquals(12 * 16, cells(m));
    }

    @Test
    void nothingDrawnGivesNoModel() {
        assertNull(BlockModelBuilder.build(List.of(), FULL));
    }

    @Test
    void theModelIsPartOfDedupeAndThePayload() {
        BlockModel m = new BlockModel(List.of("#E0B0A0"), List.of(new int[] {6, 0, 6, 10, 16, 10, 0}));
        List<int[]> box = List.of(new int[] {6, 0, 6, 10, 16, 10});
        PaletteEntry a = new PaletteEntry("minecraft:cherry_fence", "Cherry Fence", "#E3B3AD", Category.THIN, box, null, List.of(), List.of(), m);
        PaletteEntry b = new PaletteEntry("other", "Other", "#E3B3AD", Category.THIN, box);
        assertNotEquals(a.contentKey(), b.contentKey());
        assertEquals(a.contentKey(), new PaletteEntry("x", "y", "#E3B3AD", Category.THIN, box, null, List.of(), List.of(), m).contentKey());
        byte[] json = PayloadWriter.toJson(new PayloadWriter.Header("t", "1.21.1", "now", 0, 0, 0), 1, 1, 1, List.of(a, b), new char[] {1});
        JsonObject root = JsonParser.parseString(new String(json, StandardCharsets.UTF_8)).getAsJsonObject();
        JsonObject model = root.getAsJsonArray("palette").get(1).getAsJsonObject().getAsJsonObject("model");
        assertEquals("#E0B0A0", model.getAsJsonArray("palette").get(0).getAsString());
        assertEquals(7, model.getAsJsonArray("boxes").get(0).getAsJsonArray().size());
        assertFalse(root.getAsJsonArray("palette").get(2).getAsJsonObject().has("model"));
    }
}
