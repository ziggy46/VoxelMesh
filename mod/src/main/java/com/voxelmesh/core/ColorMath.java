package com.voxelmesh.core;

/** Colour helpers. Texture pixels are Minecraft NativeImage ABGR ints (red in the low byte). */
public final class ColorMath {
    private ColorMath() {}

    /**
     * Alpha-weighted mean RGB over the pixels with alpha &gt; 0 (docs/02 §4.2 step 4).
     *
     * @return 0xRRGGBB, or -1 when every pixel is fully transparent (caller falls back to the map colour)
     */
    public static int averageAbgr(int[] abgr) {
        long r = 0, g = 0, b = 0, a = 0;
        for (int p : abgr) {
            int alpha = (p >>> 24) & 0xFF;
            if (alpha == 0) continue;
            r += (long) (p & 0xFF) * alpha;
            g += (long) ((p >>> 8) & 0xFF) * alpha;
            b += (long) ((p >>> 16) & 0xFF) * alpha;
            a += alpha;
        }
        if (a == 0) return -1;
        return (int) (((r + a / 2) / a) << 16 | ((g + a / 2) / a) << 8 | ((b + a / 2) / a));
    }

    /** Multiply each channel of `rgb` by the matching channel of `tint` (both 0xRRGGBB), as Minecraft does for grass and leaves. */
    public static int tint(int rgb, int tint) {
        int r = ((rgb >> 16) & 0xFF) * ((tint >> 16) & 0xFF) / 255;
        int g = ((rgb >> 8) & 0xFF) * ((tint >> 8) & 0xFF) / 255;
        int b = (rgb & 0xFF) * (tint & 0xFF) / 255;
        return r << 16 | g << 8 | b;
    }

    public static String hex(int rgb) {
        return String.format("#%06X", rgb & 0xFFFFFF);
    }
}
