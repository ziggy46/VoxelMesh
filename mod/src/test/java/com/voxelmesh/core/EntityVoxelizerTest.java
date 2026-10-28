package com.voxelmesh.core;

import static org.junit.jupiter.api.Assertions.*;

import com.google.gson.JsonObject;
import com.google.gson.JsonParser;
import java.nio.charset.StandardCharsets;
import java.util.ArrayList;
import java.util.List;
import org.junit.jupiter.api.Test;

class EntityVoxelizerTest {
    private static final float[] NO_UV = new float[6];

    private static EntityVoxelizer.Tri tri(float[] a, float[] b, float[] c, float[] n, int rgb, EntityVoxelizer.Texture tex, float[] uv) {
        return new EntityVoxelizer.Tri(new float[] {a[0], a[1], a[2], b[0], b[1], b[2], c[0], c[1], c[2]}, uv, new int[] {rgb, rgb, rgb}, n, tex);
    }

    private static void quad(List<EntityVoxelizer.Tri> out, float[] a, float[] b, float[] c, float[] d, float[] n, int rgb) {
        out.add(tri(a, b, c, n, rgb, null, NO_UV));
        out.add(tri(a, c, d, n, rgb, null, NO_UV));
    }

    /** Six faces of the box [x0,x1) x [y0,y1) x [z0,z1) in cells, outward normals. */
    private static List<EntityVoxelizer.Tri> cuboid(float x0, float y0, float z0, float x1, float y1, float z1, int rgb) {
        List<EntityVoxelizer.Tri> t = new ArrayList<>();
        quad(t, new float[] {x0, y0, z0}, new float[] {x1, y0, z0}, new float[] {x1, y1, z0}, new float[] {x0, y1, z0}, new float[] {0, 0, -1}, rgb);
        quad(t, new float[] {x0, y0, z1}, new float[] {x1, y0, z1}, new float[] {x1, y1, z1}, new float[] {x0, y1, z1}, new float[] {0, 0, 1}, rgb);
        quad(t, new float[] {x0, y0, z0}, new float[] {x0, y1, z0}, new float[] {x0, y1, z1}, new float[] {x0, y0, z1}, new float[] {-1, 0, 0}, rgb);
        quad(t, new float[] {x1, y0, z0}, new float[] {x1, y1, z0}, new float[] {x1, y1, z1}, new float[] {x1, y0, z1}, new float[] {1, 0, 0}, rgb);
        quad(t, new float[] {x0, y0, z0}, new float[] {x1, y0, z0}, new float[] {x1, y0, z1}, new float[] {x0, y0, z1}, new float[] {0, -1, 0}, rgb);
        quad(t, new float[] {x0, y1, z0}, new float[] {x1, y1, z0}, new float[] {x1, y1, z1}, new float[] {x0, y1, z1}, new float[] {0, 1, 0}, rgb);
        return t;
    }

    private static boolean solid(EntityVoxelizer.Grid g, int x, int y, int z) {
        int i = (x - g.ox()) + g.nx() * ((y - g.oy()) + g.ny() * (z - g.oz()));
        return x >= g.ox() && y >= g.oy() && z >= g.oz() && x < g.ox() + g.nx() && y < g.oy() + g.ny() && z < g.oz() + g.nz() && g.rgb()[i] != 0;
    }

    @Test
    void aClosedBoxOnCellBoundariesFillsExactlyItsCells() {
        EntityVoxelizer.Grid g = EntityVoxelizer.voxelize(cuboid(2, 3, 4, 6, 9, 8, 0xAA5522), 1_000_000);
        assertNotNull(g);
        assertEquals(4 * 6 * 4, g.cells());
        assertTrue(solid(g, 2, 3, 4));
        assertTrue(solid(g, 5, 8, 7));
        assertFalse(solid(g, 6, 3, 4), "the max face belongs to the cell inside it");
        assertFalse(solid(g, 1, 3, 4));
        assertFalse(solid(g, 2, 9, 4));
    }

    @Test
    void theInteriorTakesTheShellColour() {
        EntityVoxelizer.Grid g = EntityVoxelizer.voxelize(cuboid(0, 0, 0, 5, 5, 5, 0x336699), 1_000_000);
        assertNotNull(g);
        assertEquals(125, g.cells());
        int centre = g.rgb()[(2 - g.ox()) + g.nx() * ((2 - g.oy()) + g.ny() * (2 - g.oz()))];
        assertEquals(EntityVoxelizer.Grid.SOLID | 0x336699, centre);
    }

    @Test
    void aFlatSheetIsOneCellThickAndStaysHollowFree() {
        List<EntityVoxelizer.Tri> t = new ArrayList<>();
        quad(t, new float[] {0, 0, 3}, new float[] {8, 0, 3}, new float[] {8, 8, 3}, new float[] {0, 8, 3}, new float[] {0, 0, 1}, 0xFFFFFF);
        EntityVoxelizer.Grid g = EntityVoxelizer.voxelize(t, 1_000_000);
        assertNotNull(g);
        assertEquals(64, g.cells());
        assertTrue(solid(g, 0, 0, 2), "a +z face on plane 3 sits in the cell just inside it");
        assertFalse(solid(g, 0, 0, 3));
    }

    @Test
    void textureTimesVertexColourGivesTheCellColourAndTransparentTexelsAreSkipped() {
        // left half of the sheet is red, right half transparent; vertex colour halves the brightness
        EntityVoxelizer.Texture tex = (u, v) -> u < 0.5 ? 0xFFFF0000 : 0x00FFFFFF;
        float[] uv = {0, 0, 1, 0, 1, 1};
        float[] uv2 = {0, 0, 1, 1, 0, 1};
        List<EntityVoxelizer.Tri> t = new ArrayList<>();
        float[] a = {0, 0, 1}, b = {8, 0, 1}, c = {8, 8, 1}, d = {0, 8, 1}, n = {0, 0, 1};
        t.add(tri(a, b, c, n, 0x808080, tex, uv));
        t.add(tri(a, c, d, n, 0x808080, tex, uv2));
        EntityVoxelizer.Grid g = EntityVoxelizer.voxelize(t, 1_000_000);
        assertNotNull(g);
        assertTrue(solid(g, 1, 4, 0));
        assertFalse(solid(g, 6, 4, 0), "transparent texel");
        int v = g.rgb()[(1 - g.ox()) + g.nx() * ((4 - g.oy()) + g.ny() * (0 - g.oz()))] & 0xFFFFFF;
        assertEquals(0x800000, v & 0xFF0000 | 0, "red channel halved");
        assertEquals(0, v & 0xFFFF, "no green or blue");
    }

    @Test
    void overlappingPartsUnionAndLaterColoursWin() {
        List<EntityVoxelizer.Tri> t = cuboid(0, 0, 0, 4, 4, 4, 0x111111);
        t.addAll(cuboid(2, 2, 2, 6, 6, 6, 0xEEEEEE));
        EntityVoxelizer.Grid g = EntityVoxelizer.voxelize(t, 1_000_000);
        assertNotNull(g);
        assertEquals(64 + 64 - 8, g.cells());
    }

    @Test
    void emptyOversizedOrAllTransparentInputGivesNothing() {
        assertNull(EntityVoxelizer.voxelize(List.of(), 1000));
        assertNull(EntityVoxelizer.voxelize(cuboid(0, 0, 0, 40, 40, 40, 0), 1000));
        List<EntityVoxelizer.Tri> t = new ArrayList<>();
        t.add(tri(new float[] {0, 0, 0}, new float[] {4, 0, 0}, new float[] {0, 4, 0}, null, 0xFFFFFF, (u, v) -> 0, new float[] {0, 0, 1, 0, 0, 1}));
        assertNull(EntityVoxelizer.voxelize(t, 1_000_000));
    }

    @Test
    void mergingCoversExactlyTheCellsWithFewBoxes() {
        EntityVoxelizer.Grid g = EntityVoxelizer.voxelize(cuboid(1, 1, 1, 5, 4, 6, 0xAA5522), 1_000_000);
        EntityRecord r = BoxMerger.merge("minecraft:pig", g, 16, 16, 16);
        assertNotNull(r);
        assertEquals("minecraft:pig", r.kind());
        assertEquals(1, r.boxes().size());
        assertArrayEquals(new int[] {1, 1, 1, 5, 4, 6, 0}, r.boxes().get(0));
        assertEquals(60, r.cells());
        assertEquals(List.of("#AA5522"), r.palette());
    }

    @Test
    void mergingKeepsDistinctColoursApartAndQuantisesNearOnes() {
        List<EntityVoxelizer.Tri> t = cuboid(0, 0, 0, 2, 2, 2, 0x000000);
        t.addAll(cuboid(2, 0, 0, 4, 2, 2, 0xFFFFFF));
        EntityRecord r = BoxMerger.merge("e", EntityVoxelizer.voxelize(t, 1_000_000), 16, 16, 16);
        assertNotNull(r);
        assertEquals(16, r.cells());
        assertEquals(2, r.boxes().size());
        assertEquals(2, r.palette().size());
        assertEquals(BoxMerger.quantize(0x7B7B7B), BoxMerger.quantize(0x7C7C7C) , "near colours share a level");
    }

    @Test
    void mergingClipsToTheSelectionAndDropsEntitiesOutsideIt() {
        EntityVoxelizer.Grid g = EntityVoxelizer.voxelize(cuboid(-3, 0, 0, 5, 4, 4, 0x808080), 1_000_000);
        EntityRecord r = BoxMerger.merge("e", g, 3, 16, 16); // selection is 3 cells wide
        assertNotNull(r);
        assertEquals(3 * 4 * 4, r.cells());
        assertTrue(r.boxes().stream().allMatch(b -> b[0] >= 0 && b[3] <= 3));
        assertNull(BoxMerger.merge("e", EntityVoxelizer.voxelize(cuboid(20, 0, 0, 24, 4, 4, 0x808080), 1_000_000), 16, 16, 16));
    }

    @Test
    void payloadCarriesEntitiesOnlyWhenThereAreAny() {
        List<int[]> full = List.of(new int[] {0, 0, 0, 16, 16, 16});
        PaletteEntry stone = new PaletteEntry("minecraft:stone", "Stone", "#7D7D7D", Category.SOLID, full);
        PayloadWriter.Header h = new PayloadWriter.Header("t", "1.21.1", "now", 0, 0, 0);
        JsonObject none = JsonParser.parseString(new String(PayloadWriter.toJson(h, 1, 1, 1, List.of(stone), new char[] {1}), StandardCharsets.UTF_8)).getAsJsonObject();
        assertFalse(none.has("entities"));
        EntityRecord e = new EntityRecord("minecraft:pig", List.of("#AA5522"), List.of(new int[] {0, 0, 0, 2, 2, 2, 0}));
        JsonObject with = JsonParser.parseString(new String(PayloadWriter.toJson(h, 1, 1, 1, List.of(stone), new char[] {1}, List.of(e)), StandardCharsets.UTF_8)).getAsJsonObject();
        JsonObject first = with.getAsJsonArray("entities").get(0).getAsJsonObject();
        assertEquals("minecraft:pig", first.get("kind").getAsString());
        assertEquals("#AA5522", first.getAsJsonArray("palette").get(0).getAsString());
        assertEquals(7, first.getAsJsonArray("boxes").get(0).getAsJsonArray().size());
    }
}
