package com.voxelmesh.core;

import static org.junit.jupiter.api.Assertions.*;

import com.google.gson.JsonArray;
import com.google.gson.JsonObject;
import com.google.gson.JsonParser;
import java.io.ByteArrayInputStream;
import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.Base64;
import java.util.List;
import java.util.zip.GZIPInputStream;
import org.junit.jupiter.api.Test;

class PayloadWriterTest {
    private static final PayloadWriter.Header H = new PayloadWriter.Header("Test", "1.21.1", "2026-01-01T00:00:00Z", 10, 64, -5);

    private static List<PaletteEntry> palette() {
        return List.of(
            new PaletteEntry("minecraft:stone", "Stone", "#7D7D7D", Category.SOLID, List.of(new int[] {0, 0, 0, 16, 16, 16})),
            new PaletteEntry("minecraft:oak_slab[type=bottom]", "Oak Slab", "#A27F49", Category.PARTIAL, List.of(new int[] {0, 0, 0, 16, 8, 16})));
    }

    @Test
    void matchesTheDocs01Schema() {
        char[] voxels = {0, 1, 2, 1, 0, 0, 2, 2}; // 2x2x2: index = x + z*2 + y*4
        JsonObject o = JsonParser.parseString(new String(PayloadWriter.toJson(H, 2, 2, 2, palette(), voxels), StandardCharsets.UTF_8)).getAsJsonObject();
        assertEquals(1, o.get("version").getAsInt());
        assertEquals("Test", o.getAsJsonObject("metadata").get("title").getAsString());
        assertEquals("1.21.1", o.getAsJsonObject("metadata").get("mcVersion").getAsString());
        JsonArray origin = o.getAsJsonObject("metadata").getAsJsonArray("origin");
        assertEquals(-5, origin.get(2).getAsInt());
        assertEquals(3, o.getAsJsonArray("palette").size(), "air + 2 entries");
        JsonObject air = o.getAsJsonArray("palette").get(0).getAsJsonObject();
        assertEquals("minecraft:air", air.get("id").getAsString());
        assertTrue(air.get("color").isJsonNull());
        assertEquals("air", air.get("category").getAsString());
        assertEquals(0, air.getAsJsonArray("boxes").size());
        JsonObject slab = o.getAsJsonArray("palette").get(2).getAsJsonObject();
        assertEquals("partial", slab.get("category").getAsString());
        assertEquals(8, slab.getAsJsonArray("boxes").get(0).getAsJsonArray().get(4).getAsInt());
        assertEquals(3, o.getAsJsonArray("dimensions").size());
    }

    @Test
    void voxelsAreLittleEndianUint16WithMatchingCrc() {
        char[] voxels = {0, 1, 258, 2};
        byte[] bytes = PayloadWriter.voxelBytes(voxels);
        assertArrayEquals(new byte[] {0, 0, 1, 0, 2, 1, 2, 0}, bytes);
        assertEquals("cbf43926", PayloadWriter.crc32Hex("123456789".getBytes(StandardCharsets.US_ASCII)));
    }

    @Test
    void roundTripsThroughGzipAndBase64() throws IOException {
        char[] voxels = new char[27];
        for (int i = 0; i < voxels.length; i++) voxels[i] = (char) (i % 3);
        byte[] gz = PayloadWriter.gzip(PayloadWriter.toJson(H, 3, 3, 3, palette(), voxels));
        String json = new String(new GZIPInputStream(new ByteArrayInputStream(gz)).readAllBytes(), StandardCharsets.UTF_8);
        JsonObject o = JsonParser.parseString(json).getAsJsonObject();
        byte[] decoded = Base64.getDecoder().decode(o.get("voxelsBase64").getAsString());
        assertArrayEquals(PayloadWriter.voxelBytes(voxels), decoded);
        assertEquals(PayloadWriter.crc32Hex(decoded), o.get("voxelsCrc32").getAsString());
    }

    @Test
    void rejectsInconsistentInput() {
        assertThrows(IllegalArgumentException.class, () -> PayloadWriter.toJson(H, 2, 2, 2, palette(), new char[7]));
        assertThrows(IllegalArgumentException.class, () -> PayloadWriter.toJson(H, 1, 1, 1, palette(), new char[] {3}), "index 3 but only 2 entries");
    }

    /** Writes a payload for the web app's loader to read back (see web/src/__tests__/payload/javaInterop.test.ts). */
    @Test
    void writesInteropSample() throws IOException {
        char[] voxels = new char[4 * 3 * 5];
        for (int y = 0; y < 3; y++)
            for (int z = 0; z < 5; z++)
                for (int x = 0; x < 4; x++) voxels[x + z * 4 + y * 20] = (char) ((x + y + z) % 3);
        byte[] gz = PayloadWriter.gzip(PayloadWriter.toJson(H, 4, 3, 5, palette(), voxels));
        Path out = Path.of("build", "interop", "sample.vxm.json.gz");
        Files.createDirectories(out.getParent());
        Files.write(out, gz);
        assertTrue(Files.size(out) > 0);
    }
}
