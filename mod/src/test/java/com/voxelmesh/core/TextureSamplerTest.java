package com.voxelmesh.core;

import static org.junit.jupiter.api.Assertions.*;

import java.util.List;
import org.junit.jupiter.api.Test;

class TextureSamplerTest {
    private static final float[] UP_XYZ = {0, 1, 0, 1, 1, 0, 1, 1, 1, 0, 1, 1};
    private static final float[] IDENTITY_UV = {0, 0, 1, 0, 1, 1, 0, 1};

    /** 16x16 ABGR texture whose pixel (x,y) has red = x*16, green = y*16, blue = 7. */
    private static int[] ramp() {
        int[] px = new int[256];
        for (int y = 0; y < 16; y++)
            for (int x = 0; x < 16; x++) px[x + y * 16] = 0xFF000000 | 7 << 16 | (y * 16) << 8 | (x * 16);
        return px;
    }

    @Test
    void upFaceReadsTexelsPixelForPixel() {
        int[] t = TextureSampler.sampleFace(1, UP_XYZ, IDENTITY_UV, ramp(), 16, 16);
        assertNotNull(t);
        assertEquals(0x000007, t[0]);
        assertEquals((5 * 16) << 16 | (9 * 16) << 8 | 7, t[5 + 9 * 16]);
    }

    @Test
    void aQuadThatDoesNotCoverTheFaceGivesNothing() {
        float[] half = {0, 1, 0, 0.5f, 1, 0, 0.5f, 1, 1, 0, 1, 1};
        assertNull(TextureSampler.sampleFace(1, half, IDENTITY_UV, ramp(), 16, 16));
    }

    @Test
    void transparentTexelsAreMarkedAndHighResTexturesAreAveraged() {
        int[] px = ramp();
        px[3] = 0x00FFFFFF;
        assertEquals(-1, TextureSampler.sampleFace(1, UP_XYZ, IDENTITY_UV, px, 16, 16)[3]);
        // 32x32: each texel covers a 2x2 block of pixels, here two black and two white
        int[] big = new int[32 * 32];
        java.util.Arrays.fill(big, 0xFF000000);
        big[0] = big[1] = 0xFFFFFFFF;
        assertEquals(0x808080, TextureSampler.sampleFace(1, UP_XYZ, IDENTITY_UV, big, 32, 32)[0]);
    }

    @Test
    void combinePacksRgbAppliesTintAndFallbacks() {
        int[][] faces = new int[6][];
        faces[1] = new int[256];
        java.util.Arrays.fill(faces[1], 0x808080);
        faces[1][0] = -1;
        byte[] out = TextureSampler.combine(faces, 1 << 1, 0x00FF00, 0x112233);
        assertNotNull(out);
        assertEquals(TextureSampler.TOTAL_BYTES, out.length);
        int up = 256 * 3; // face 1 starts here
        assertEquals(0, out[up + 3] & 0xFF); // tinted grey: red 0
        assertEquals(0x80, out[up + 4] & 0xFF);
        assertEquals(0, out[up + 5] & 0xFF);
        assertEquals(0x11, out[up] & 0xFF); // transparent texel takes the fallback (untinted)
        assertEquals(0x11, out[0] & 0xFF); // a face with no map is all fallback
    }

    @Test
    void aFlatTextureProducesNoMap() {
        int[][] faces = new int[6][];
        for (int f = 0; f < 6; f++) {
            faces[f] = new int[256];
            java.util.Arrays.fill(faces[f], 0x808080);
        }
        assertNull(TextureSampler.combine(faces, 0, -1, 0x808080));
    }

    @Test
    void textureIsPartOfTheContentKeyAndWrittenToThePayload() {
        byte[] a = new byte[TextureSampler.TOTAL_BYTES], b = new byte[TextureSampler.TOTAL_BYTES];
        b[10] = 1;
        PaletteEntry ea = new PaletteEntry("x", "n", "#808080", Category.SOLID, List.of(new int[] {0, 0, 0, 16, 16, 16}), null, List.of(), List.of(), null, a);
        PaletteEntry eb = new PaletteEntry("x", "n", "#808080", Category.SOLID, List.of(new int[] {0, 0, 0, 16, 16, 16}), null, List.of(), List.of(), null, b);
        assertNotEquals(ea.contentKey(), eb.contentKey());
        assertThrows(IllegalArgumentException.class, () -> new PaletteEntry("x", "n", "#808080", Category.SOLID, List.of(new int[] {0, 0, 0, 16, 16, 16}), null, List.of(), List.of(), null, new byte[5]));
    }
}
