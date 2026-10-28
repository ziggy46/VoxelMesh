package com.voxelmesh.core;

import java.util.ArrayList;
import java.util.List;

/**
 * Decides whether a full-cube block gets per-face colours (grass: green top, dirt sides; logs: rings vs bark) and resolves them
 * for one position. Pure: no Minecraft types. Face order is Minecraft's Direction ids: DOWN, UP, NORTH, SOUTH, WEST, EAST.
 */
public final class FaceColors {
    /** Two faces count as different colours when their RGB distance is at least this (0..441). Below it the block stays one colour. */
    public static final double MIN_DISTANCE = 40;

    private FaceColors() {}

    /**
     * @param faceRgb    average 0xRRGGBB of each face's texture, untinted; -1 where the face has no readable full-face quad
     * @param tintedMask bit f set when face f's quad is biome-tinted (grass top, leaves)
     * @param tint       the block colour provider's tint at this position as 0xRRGGBB, or -1 for none
     * @param fallback   colour for faces with no data (the block's single colour)
     * @return six "#RRGGBB" strings, or an empty list when the faces are not different enough to be worth printing separately
     */
    public static List<String> resolve(int[] faceRgb, int tintedMask, int tint, int fallback) {
        if (faceRgb.length != ReliefSampler.FACES) throw new IllegalArgumentException("need 6 faces");
        int[] c = new int[ReliefSampler.FACES];
        boolean any = false;
        for (int f = 0; f < c.length; f++) {
            int v = faceRgb[f];
            if (v < 0) {
                c[f] = fallback;
                continue;
            }
            any = true;
            c[f] = (tint != -1 && (tintedMask >> f & 1) != 0) ? ColorMath.tint(v, tint) : v;
        }
        if (!any) return List.of();
        double widest = 0;
        for (int i = 0; i < c.length; i++)
            for (int j = i + 1; j < c.length; j++) widest = Math.max(widest, distance(c[i], c[j]));
        if (widest < MIN_DISTANCE) return List.of();
        List<String> out = new ArrayList<>(c.length);
        for (int v : c) out.add(ColorMath.hex(v));
        return out;
    }

    static double distance(int a, int b) {
        int dr = (a >> 16 & 0xFF) - (b >> 16 & 0xFF), dg = (a >> 8 & 0xFF) - (b >> 8 & 0xFF), db = (a & 0xFF) - (b & 0xFF);
        return Math.sqrt(dr * dr + dg * dg + db * db);
    }
}
