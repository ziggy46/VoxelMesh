package com.voxelmesh.core;

import java.util.HashSet;
import java.util.Set;

/**
 * Per-texel colour maps for full-cube blocks: six 16x16 grids of RGB, one texel per sub-voxel on that face, in the same face
 * order and frames as {@link ReliefSampler} (index = a + b*16). Texels are read through the quad's own UVs, so rotation and
 * mirroring are honoured, and a 32x or 64x resource pack is averaged down to the 16x16 lattice. Pure: no Minecraft types.
 */
public final class TextureSampler {
    public static final int TEXELS = ReliefSampler.FACES * ReliefSampler.FACE_BYTES;
    public static final int TOTAL_BYTES = TEXELS * 3;
    private static final int N = ReliefSampler.N;

    private TextureSampler() {}

    /**
     * @param xyz  4 quad vertices, block-local 0..1 (see {@link ReliefSampler#sampleFace})
     * @param uv   the same vertices' sprite-local texture coordinates
     * @param abgr first-frame sprite pixels, row-major
     * @return 256 colours (0xRRGGBB, -1 where the texture is transparent) in the face frame, or null when the quad does not cover the face
     */
    public static int[] sampleFace(int face, float[] xyz, float[] uv, int[] abgr, int w, int h) {
        if (!ReliefSampler.coversFace(face, xyz)) return null;
        double[] p0 = {xyz[0], xyz[1], xyz[2]};
        double[] e1 = {xyz[3] - xyz[0], xyz[4] - xyz[1], xyz[5] - xyz[2]};
        double[] e2 = {xyz[9] - xyz[0], xyz[10] - xyz[1], xyz[11] - xyz[2]};
        double l1 = dot(e1, e1), l2 = dot(e2, e2);
        if (l1 < 1e-3 || l2 < 1e-3) return null;
        int[] out = new int[ReliefSampler.FACE_BYTES];
        for (int b = 0; b < N; b++)
            for (int a = 0; a < N; a++) {
                double[] c = ReliefSampler.texelCentre(face, a, b);
                double[] d = {c[0] - p0[0], c[1] - p0[1], c[2] - p0[2]};
                double s = clamp01(dot(d, e1) / l1), t = clamp01(dot(d, e2) / l2);
                double u = uv[0] + s * (uv[2] - uv[0]) + t * (uv[6] - uv[0]);
                double v = uv[1] + s * (uv[3] - uv[1]) + t * (uv[7] - uv[1]);
                out[a + b * N] = footprintRgb(abgr, w, h, u * w, v * h);
            }
        return out;
    }

    /** Mean RGB of the opaque-ish pixels one texel covers (a plain lookup for a 16x16 texture); -1 when none are. */
    static int footprintRgb(int[] abgr, int w, int h, double cx, double cy) {
        int fx = Math.max(1, Math.round(w / (float) N)), fy = Math.max(1, Math.round(h / (float) N));
        int x0 = (int) Math.floor(cx - fx / 2.0 + 0.5), y0 = (int) Math.floor(cy - fy / 2.0 + 0.5);
        long r = 0, g = 0, b = 0, n = 0;
        for (int dy = 0; dy < fy; dy++)
            for (int dx = 0; dx < fx; dx++) {
                int px = Math.max(0, Math.min(w - 1, x0 + dx)), py = Math.max(0, Math.min(h - 1, y0 + dy));
                int p = abgr[px + py * w];
                if (((p >>> 24) & 0xFF) < 128) continue;
                r += p & 0xFF;
                g += (p >>> 8) & 0xFF;
                b += (p >>> 16) & 0xFF;
                n++;
            }
        if (n == 0) return -1;
        return (int) (((r + n / 2) / n) << 16 | ((g + n / 2) / n) << 8 | ((b + n / 2) / n));
    }

    /**
     * Pack six face maps into the payload field. A face with no map, or a transparent texel, takes `fallback`; biome-tinted faces
     * (bit f of `tintedMask`) are multiplied by `tint` (0xRRGGBB, -1 for none).
     *
     * @return 4608 bytes (RGB per texel), or null when every texel is practically one colour (the block's single colour already says it all)
     */
    public static byte[] combine(int[][] faces, int tintedMask, int tint, int fallback) {
        if (faces.length != ReliefSampler.FACES) throw new IllegalArgumentException("need 6 faces");
        byte[] out = new byte[TOTAL_BYTES];
        Set<Integer> coarse = new HashSet<>();
        for (int f = 0; f < ReliefSampler.FACES; f++) {
            boolean tinted = tint != -1 && (tintedMask >> f & 1) != 0;
            for (int i = 0; i < ReliefSampler.FACE_BYTES; i++) {
                int c = faces[f] == null ? fallback : faces[f][i];
                if (c < 0) c = fallback;
                else if (tinted) c = ColorMath.tint(c, tint);
                int at = (f * ReliefSampler.FACE_BYTES + i) * 3;
                out[at] = (byte) (c >> 16);
                out[at + 1] = (byte) (c >> 8);
                out[at + 2] = (byte) c;
                coarse.add((c >> 20 & 0xF) << 8 | (c >> 12 & 0xF) << 4 | (c >> 4 & 0xF));
            }
        }
        return coarse.size() <= 1 ? null : out;
    }

    private static double dot(double[] a, double[] b) { return a[0] * b[0] + a[1] * b[1] + a[2] * b[2]; }
    private static double clamp01(double v) { return v < 0 ? 0 : v > 1 ? 1 : v; }
}
