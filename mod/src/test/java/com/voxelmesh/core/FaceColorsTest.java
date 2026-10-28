package com.voxelmesh.core;

import static org.junit.jupiter.api.Assertions.*;

import com.google.gson.JsonObject;
import com.google.gson.JsonParser;
import java.nio.charset.StandardCharsets;
import java.util.List;
import org.junit.jupiter.api.Test;

class FaceColorsTest {
    private static final int DIRT = 0x866043, GRASS_GREY = 0x8C8C8C, GREEN = 0x79C05A;

    private static int[] faces(int down, int up, int side) {
        return new int[] {down, up, side, side, side, side};
    }

    @Test
    void uniformBlocksStayOneColour() {
        assertTrue(FaceColors.resolve(faces(0x7D7D7D, 0x7D7D7D, 0x7D7D7D), 0, -1, 0x7D7D7D).isEmpty());
        // differences below the threshold (a slightly lighter top) are not worth a second filament
        assertTrue(FaceColors.resolve(faces(0x7D7D7D, 0x838383, 0x7D7D7D), 0, -1, 0x7D7D7D).isEmpty());
    }

    @Test
    void differentFacesAreListedInDirectionOrder() {
        List<String> f = FaceColors.resolve(faces(DIRT, 0x777777, DIRT), 0, -1, DIRT);
        assertEquals(List.of("#866043", "#777777", "#866043", "#866043", "#866043", "#866043"), f);
    }

    @Test
    void tintAppliesOnlyToTintedFacesAtThisPosition() {
        // grass block: the top sprite is grey and gets the biome colour; the dirt sides do not
        int[] rgb = faces(DIRT, GRASS_GREY, DIRT);
        List<String> f = FaceColors.resolve(rgb, 1 << 1, GREEN, DIRT);
        assertEquals(ColorMath.hex(ColorMath.tint(GRASS_GREY, GREEN)), f.get(1));
        assertEquals("#866043", f.get(0));
        assertEquals("#866043", f.get(2));
        // with no tint provider the same mask changes nothing
        assertEquals("#8C8C8C", FaceColors.resolve(rgb, 1 << 1, -1, DIRT).get(1));
    }

    @Test
    void facesWithoutDataUseTheBlockColour() {
        int[] rgb = {-1, 0xFFFFFF, 0x000000, -1, -1, -1};
        List<String> f = FaceColors.resolve(rgb, 0, -1, 0x445566);
        assertEquals("#445566", f.get(0));
        assertEquals("#FFFFFF", f.get(1));
        assertEquals("#445566", f.get(5));
        assertTrue(FaceColors.resolve(new int[] {-1, -1, -1, -1, -1, -1}, 0, -1, 0x445566).isEmpty());
    }

    @Test
    void facesParticipateInDedupeAndThePayload() {
        List<int[]> full = List.of(new int[] {0, 0, 0, 16, 16, 16});
        List<String> faces = List.of("#866043", "#5A8F3C", "#866043", "#866043", "#866043", "#866043");
        PaletteEntry a = new PaletteEntry("minecraft:grass_block", "Grass Block", "#866043", Category.SOLID, full, null, List.of(), faces);
        PaletteEntry b = new PaletteEntry("other", "Other", "#866043", Category.SOLID, full);
        assertNotEquals(a.contentKey(), b.contentKey());
        assertEquals(a.contentKey(), new PaletteEntry("x", "y", "#866043", Category.SOLID, full, null, List.of(), faces).contentKey());
        assertThrows(IllegalArgumentException.class, () -> new PaletteEntry("a", "A", "#000000", Category.SOLID, full, null, List.of(), List.of("#000000")));

        byte[] json = PayloadWriter.toJson(new PayloadWriter.Header("t", "1.21.1", "now", 0, 0, 0), 1, 1, 1, List.of(a, b), new char[] {1});
        JsonObject root = JsonParser.parseString(new String(json, StandardCharsets.UTF_8)).getAsJsonObject();
        assertEquals(6, root.getAsJsonArray("palette").get(1).getAsJsonObject().getAsJsonArray("faces").size());
        assertFalse(root.getAsJsonArray("palette").get(2).getAsJsonObject().has("faces"));
    }
}
