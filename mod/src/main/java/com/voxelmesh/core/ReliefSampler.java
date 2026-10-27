package com.voxelmesh.core;

/**
 * Per-face brightness maps for surface relief. Each full-cube block type gets six 16x16 grids of 0..255 luma, one texel
 * per sub-voxel on that face. Face order is Minecraft's Direction ids: DOWN, UP, NORTH, SOUTH, WEST, EAST.
 *
 * <p>Face frames, in MC block-local axes (index = a + b*16):
 * DOWN/UP: a = x, b = z. NORTH/SOUTH: a = x, b = y. WEST/EAST: a = z, b = y.
 * Texels are sampled through the quad's own UVs, so texture rotation and mirroring are honoured. Pure: no Minecraft types.
 */
public final class ReliefSampler {
    public static final int FACES = 6;
    public static final int N = 16;
    public static final int FACE_BYTES = N * N;
    public static final int TOTAL_BYTES = FACES * FACE_BYTES;
    /** Neutral luma used where there is no data: flat, so it never produces relief. */
    public static final byte FLAT = (byte) 128;

    private static final double EPS = 1e-3;

    private ReliefSampler() {}

    /** Rec. 709 luma of an ABGR pixel; pixels that are mostly transparent count as neutral. */
    public static int luma(int abgr) {
        int a = (abgr >>> 24) & 0xFF;
        if (a < 128) return 128;
        int r = abgr & 0xFF, g = (abgr >>> 8) & 0xFF, b = (abgr >>> 16) & 0xFF;
        return (2126 * r + 7152 * g + 722 * b) / 10000;
    }

    /** Block-local (0..1) centre of texel (a,b) on `face`. */
    public static double[] texelCentre(int face, int a, int b) {
        double ca = (a + 0.5) / N, cb = (b + 0.5) / N;
        switch (face) {
            case 0: return new double[] {ca, 0, cb};
            case 1: return new double[] {ca, 1, cb};
            case 2: return new double[] {ca, cb, 0};
            case 3: return new double[] {ca, cb, 1};
            case 4: return new double[] {0, cb, ca};
            case 5: return new double[] {1, cb, ca};
            default: throw new IllegalArgumentException("face " + face);
        }
    }

    private static int normalAxis(int face) {
        return face < 2 ? 1 : face < 4 ? 2 : 0; // y, z, x
    }

    /** True when the 4 vertices (x,y,z each, 0..1) lie on the face's boundary plane and span the whole face. */
    public static boolean coversFace(int face, float[] xyz) {
        int n = normalAxis(face);
        double plane = (face % 2 == 0) ? 0 : 1;
        double[] min = {9, 9, 9}, max = {-9, -9, -9};
        for (int v = 0; v < 4; v++) {
            if (Math.abs(xyz[3 * v + n] - plane) > EPS) return false;
            for (int k = 0; k < 3; k++) {
                min[k] = Math.min(min[k], xyz[3 * v + k]);
                max[k] = Math.max(max[k], xyz[3 * v + k]);
            }
        }
        for (int k = 0; k < 3; k++) {
            if (k == n) continue;
            if (min[k] > EPS || max[k] < 1 - EPS) return false;
        }
        return true;
    }

    /**
     * @param xyz   4 quad vertices, block-local 0..1, in the quad's own order (p0,p1,p2,p3 around the rectangle)
     * @param uv    the same 4 vertices' sprite-local texture coordinates, 0..1 (u,v each)
     * @param abgr  first-frame sprite pixels, row-major, w*h
     * @return 256 luma bytes in the face frame, or null when the quad does not cover the face
     */
    public static byte[] sampleFace(int face, float[] xyz, float[] uv, int[] abgr, int w, int h) {
        if (!coversFace(face, xyz)) return null;
        double[] p0 = {xyz[0], xyz[1], xyz[2]};
        double[] e1 = {xyz[3] - xyz[0], xyz[4] - xyz[1], xyz[5] - xyz[2]}; // p0 -> p1
        double[] e2 = {xyz[9] - xyz[0], xyz[10] - xyz[1], xyz[11] - xyz[2]}; // p0 -> p3
        double l1 = dot(e1, e1), l2 = dot(e2, e2);
        if (l1 < EPS || l2 < EPS) return null;
        byte[] out = new byte[FACE_BYTES];
        for (int b = 0; b < N; b++)
            for (int a = 0; a < N; a++) {
                double[] c = texelCentre(face, a, b);
                double[] d = {c[0] - p0[0], c[1] - p0[1], c[2] - p0[2]};
                double s = clamp01(dot(d, e1) / l1), t = clamp01(dot(d, e2) / l2);
                double u = uv[0] + s * (uv[2] - uv[0]) + t * (uv[6] - uv[0]);
                double v = uv[1] + s * (uv[3] - uv[1]) + t * (uv[7] - uv[1]);
                int px = Math.max(0, Math.min(w - 1, (int) Math.floor(u * w)));
                int py = Math.max(0, Math.min(h - 1, (int) Math.floor(v * h)));
                out[a + b * N] = (byte) luma(abgr[px + py * w]);
            }
        return out;
    }

    /** Concatenate six face maps (null = flat) into the 1536-byte payload field. */
    public static byte[] combine(byte[][] faces) {
        if (faces.length != FACES) throw new IllegalArgumentException("need 6 faces");
        byte[] out = new byte[TOTAL_BYTES];
        for (int f = 0; f < FACES; f++) {
            if (faces[f] == null) java.util.Arrays.fill(out, f * FACE_BYTES, (f + 1) * FACE_BYTES, FLAT);
            else if (faces[f].length != FACE_BYTES) throw new IllegalArgumentException("face " + f + " has " + faces[f].length + " bytes");
            else System.arraycopy(faces[f], 0, out, f * FACE_BYTES, FACE_BYTES);
        }
        return out;
    }

    private static double dot(double[] a, double[] b) { return a[0] * b[0] + a[1] * b[1] + a[2] * b[2]; }
    private static double clamp01(double v) { return v < 0 ? 0 : v > 1 ? 1 : v; }
}
