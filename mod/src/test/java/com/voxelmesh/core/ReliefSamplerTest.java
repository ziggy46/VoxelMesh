package com.voxelmesh.core;

import static org.junit.jupiter.api.Assertions.*;

import com.google.gson.JsonObject;
import com.google.gson.JsonParser;
import java.nio.charset.StandardCharsets;
import java.util.Base64;
import java.util.List;
import org.junit.jupiter.api.Test;

class ReliefSamplerTest {
    /** 16x16 texture where pixel (x,y) has grey level x*16 + y (distinct per pixel, row-major). */
    private static int[] gradient() {
        int[] px = new int[256];
        for (int y = 0; y < 16; y++)
            for (int x = 0; x < 16; x++) {
                int g = (x * 16 + y) & 0xFF;
                px[x + y * 16] = 0xFF000000 | g << 16 | g << 8 | g;
            }
        return px;
    }

    private static int grey(int x, int y) { return (x * 16 + y) & 0xFF; }

    @Test
    void lumaMatchesRec709AndTreatsTransparentAsNeutral() {
        assertEquals(255, ReliefSampler.luma(0xFFFFFFFF));
        assertEquals(0, ReliefSampler.luma(0xFF000000));
        assertEquals(54, ReliefSampler.luma(0xFF0000FF)); // pure red (low byte)
        assertEquals(182, ReliefSampler.luma(0xFF00FF00)); // pure green
        assertEquals(18, ReliefSampler.luma(0xFFFF0000)); // pure blue
        assertEquals(128, ReliefSampler.luma(0x00FFFFFF));
    }

    @Test
    void upFaceWithIdentityUvReadsPixelForPixel() {
        // UP quad: x along u, z along v
        float[] xyz = {0, 1, 0, 1, 1, 0, 1, 1, 1, 0, 1, 1};
        float[] uv = {0, 0, 1, 0, 1, 1, 0, 1};
        byte[] out = ReliefSampler.sampleFace(1, xyz, uv, gradient(), 16, 16);
        assertNotNull(out);
        for (int b = 0; b < 16; b++)
            for (int a = 0; a < 16; a++) assertEquals(grey(a, b), out[a + b * 16] & 0xFF, "texel " + a + "," + b);
    }

    @Test
    void northFaceIsNotMirrored() {
        // Vanilla NORTH quad: viewed from outside (looking south) the texture's left edge is at +x.
        float[] xyz = {1, 0, 0, 0, 0, 0, 0, 1, 0, 1, 1, 0};
        float[] uv = {0, 1, 1, 1, 1, 0, 0, 0};
        byte[] out = ReliefSampler.sampleFace(2, xyz, uv, gradient(), 16, 16);
        assertNotNull(out);
        // texel (a=3 [x~0.2], b=2 [y~0.16]) -> u = 1 - x, v = 1 - y -> pixel (12, 13)
        assertEquals(grey(12, 13), out[3 + 2 * 16] & 0xFF);
        // texel (a=15, b=15) is the far +x / top corner -> pixel (0, 0)
        assertEquals(grey(0, 0), out[15 + 15 * 16] & 0xFF);
        assertEquals(grey(15, 15), out[0] & 0xFF); // (a=0,b=0): x~0, y~0 -> pixel (15,15)
    }

    @Test
    void rotatedUvTransposesTheSampling() {
        float[] xyz = {0, 1, 0, 1, 1, 0, 1, 1, 1, 0, 1, 1};
        float[] rotated = {0, 0, 0, 1, 1, 1, 1, 0}; // swap u and v
        byte[] out = ReliefSampler.sampleFace(1, xyz, rotated, gradient(), 16, 16);
        assertNotNull(out);
        for (int b = 0; b < 16; b++)
            for (int a = 0; a < 16; a++) assertEquals(grey(b, a), out[a + b * 16] & 0xFF, "texel " + a + "," + b);
    }

    @Test
    void rejectsQuadsThatDoNotCoverTheFace() {
        float[] half = {0, 1, 0, 0.5f, 1, 0, 0.5f, 1, 1, 0, 1, 1};
        assertNull(ReliefSampler.sampleFace(1, half, new float[8], gradient(), 16, 16));
        float[] wrongPlane = {0, 0.5f, 0, 1, 0.5f, 0, 1, 0.5f, 1, 0, 0.5f, 1};
        assertNull(ReliefSampler.sampleFace(1, wrongPlane, new float[8], gradient(), 16, 16));
        assertTrue(ReliefSampler.coversFace(1, new float[] {0, 1, 0, 1, 1, 0, 1, 1, 1, 0, 1, 1}));
    }

    @Test
    void texelCentresLieOnTheirFace() {
        assertArrayEquals(new double[] {0.5 / 16, 1, 3.5 / 16}, ReliefSampler.texelCentre(1, 0, 3), 1e-9);
        assertArrayEquals(new double[] {2.5 / 16, 7.5 / 16, 0}, ReliefSampler.texelCentre(2, 2, 7), 1e-9);
        assertArrayEquals(new double[] {1, 9.5 / 16, 4.5 / 16}, ReliefSampler.texelCentre(5, 4, 9), 1e-9);
        assertArrayEquals(new double[] {0, 9.5 / 16, 4.5 / 16}, ReliefSampler.texelCentre(4, 4, 9), 1e-9);
    }

    @Test
    void combineFillsMissingFacesWithFlat() {
        byte[][] faces = new byte[6][];
        faces[1] = new byte[256];
        java.util.Arrays.fill(faces[1], (byte) 7);
        byte[] all = ReliefSampler.combine(faces);
        assertEquals(1536, all.length);
        assertEquals(128, all[0] & 0xFF);
        assertEquals(7, all[256] & 0xFF);
        assertEquals(128, all[1535] & 0xFF);
        assertThrows(IllegalArgumentException.class, () -> ReliefSampler.combine(new byte[6][3]));
    }

    @Test
    void payloadWritesReliefAsBase64OnlyWhenPresent() {
        byte[] relief = new byte[1536];
        for (int i = 0; i < relief.length; i++) relief[i] = (byte) i;
        List<PaletteEntry> pal = List.of(
            new PaletteEntry("a", "A", "#112233", Category.SOLID, List.of(new int[] {0, 0, 0, 16, 16, 16}), relief),
            new PaletteEntry("b", "B", "#445566", Category.PARTIAL, List.of(new int[] {0, 0, 0, 16, 8, 16})));
        PayloadWriter.Header h = new PayloadWriter.Header("T", "1.21.1", "2026-01-01T00:00:00Z", 0, 0, 0);
        JsonObject o = JsonParser.parseString(new String(PayloadWriter.toJson(h, 1, 1, 1, pal, new char[] {1}), StandardCharsets.UTF_8)).getAsJsonObject();
        JsonObject a = o.getAsJsonArray("palette").get(1).getAsJsonObject();
        assertArrayEquals(relief, Base64.getDecoder().decode(a.get("relief").getAsString()));
        assertFalse(o.getAsJsonArray("palette").get(2).getAsJsonObject().has("relief"));
        assertFalse(o.getAsJsonArray("palette").get(0).getAsJsonObject().has("relief"));
        List<PaletteEntry> bad = List.of(new PaletteEntry("a", "A", "#112233", Category.SOLID, List.of(new int[] {0, 0, 0, 16, 16, 16}), new byte[10]));
        assertThrows(IllegalArgumentException.class, () -> PayloadWriter.toJson(h, 1, 1, 1, bad, new char[] {1}));
    }
}
