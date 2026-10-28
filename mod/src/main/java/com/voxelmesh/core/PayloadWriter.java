package com.voxelmesh.core;

import com.google.gson.Gson;
import com.google.gson.GsonBuilder;
import com.google.gson.JsonArray;
import com.google.gson.JsonObject;
import java.io.ByteArrayOutputStream;
import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.util.Base64;
import java.util.List;
import java.util.zip.CRC32;
import java.util.zip.GZIPOutputStream;

/** Serialises a capture to the `.vxm.json` payload (docs/01 §2) and gzips it. Pure: no Minecraft types. */
public final class PayloadWriter {
    private static final Gson GSON = new GsonBuilder().disableHtmlEscaping().serializeNulls().create();

    private PayloadWriter() {}

    public record Header(String title, String mcVersion, String exportedAt, int originX, int originY, int originZ) {}

    /** Voxel palette indices as little-endian uint16 bytes (the wire format). */
    public static byte[] voxelBytes(char[] voxels) {
        byte[] out = new byte[voxels.length * 2];
        for (int i = 0; i < voxels.length; i++) {
            out[2 * i] = (byte) voxels[i];
            out[2 * i + 1] = (byte) (voxels[i] >>> 8);
        }
        return out;
    }

    public static String crc32Hex(byte[] bytes) {
        CRC32 crc = new CRC32();
        crc.update(bytes);
        return String.format("%08x", crc.getValue());
    }

    /**
     * @param palette entries from palette index 1 upward
     * @param voxels  index = x + z*sx + y*sx*sz, values are palette indices (0 = air)
     */
    public static byte[] toJson(Header h, int sx, int sy, int sz, List<PaletteEntry> palette, char[] voxels) {
        if ((long) sx * sy * sz != voxels.length) throw new IllegalArgumentException("voxel array does not match dimensions");
        if (palette.size() + 1 > Limits.MAX_PALETTE_ENTRIES) throw new IllegalArgumentException("palette too large: " + palette.size());
        for (char v : voxels) if (v > palette.size()) throw new IllegalArgumentException("voxel references a missing palette entry: " + (int) v);

        JsonObject root = new JsonObject();
        root.addProperty("version", 1);
        JsonObject md = new JsonObject();
        md.addProperty("title", h.title());
        md.addProperty("mcVersion", h.mcVersion());
        md.addProperty("exportedAt", h.exportedAt());
        JsonArray origin = new JsonArray();
        origin.add(h.originX());
        origin.add(h.originY());
        origin.add(h.originZ());
        md.add("origin", origin);
        root.add("metadata", md);
        JsonArray dims = new JsonArray();
        dims.add(sx);
        dims.add(sy);
        dims.add(sz);
        root.add("dimensions", dims);

        JsonArray pal = new JsonArray();
        JsonObject air = new JsonObject();
        air.addProperty("id", "minecraft:air");
        air.addProperty("name", "Air");
        air.add("color", com.google.gson.JsonNull.INSTANCE);
        air.addProperty("category", Category.AIR.json());
        air.add("boxes", new JsonArray());
        pal.add(air);
        for (PaletteEntry e : palette) {
            JsonObject o = new JsonObject();
            o.addProperty("id", e.id());
            o.addProperty("name", e.name());
            o.addProperty("color", e.color());
            o.addProperty("category", e.category().json());
            JsonArray boxes = new JsonArray();
            for (int[] b : e.boxes()) {
                JsonArray a = new JsonArray();
                for (int v : b) a.add(v);
                boxes.add(a);
            }
            o.add("boxes", boxes);
            if (!e.tags().isEmpty()) {
                JsonArray tags = new JsonArray();
                for (String t : e.tags()) tags.add(t);
                o.add("tags", tags);
            }
            if (e.relief() != null) {
                if (e.relief().length != ReliefSampler.TOTAL_BYTES) throw new IllegalArgumentException("relief must be " + ReliefSampler.TOTAL_BYTES + " bytes");
                o.addProperty("relief", Base64.getEncoder().encodeToString(e.relief()));
            }
            pal.add(o);
        }
        root.add("palette", pal);

        byte[] bytes = voxelBytes(voxels);
        root.addProperty("voxelsBase64", Base64.getEncoder().encodeToString(bytes));
        root.addProperty("voxelsCrc32", crc32Hex(bytes));
        return GSON.toJson(root).getBytes(StandardCharsets.UTF_8);
    }

    public static byte[] gzip(byte[] data) {
        try {
            ByteArrayOutputStream out = new ByteArrayOutputStream(data.length / 4 + 64);
            try (GZIPOutputStream gz = new GZIPOutputStream(out)) {
                gz.write(data);
            }
            return out.toByteArray();
        } catch (IOException e) {
            throw new IllegalStateException(e); // in-memory stream: cannot happen
        }
    }
}
