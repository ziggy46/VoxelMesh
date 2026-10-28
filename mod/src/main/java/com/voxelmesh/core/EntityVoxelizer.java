package com.voxelmesh.core;

import java.util.List;

/**
 * Turns the triangles an entity's renderer drew into solid, coloured cells (16 per block). Pure: no Minecraft types, so the
 * geometry is unit-tested; the client side only feeds it triangles and a texture lookup.
 *
 * <p>Method: every triangle is sampled densely and each sample marks the cell it lies in (the shell, coloured from the
 * texture times the vertex colour). Samples are nudged a hair inward (against the outward normal, and toward the triangle's
 * centre) so a model face lying exactly on a cell boundary lands in the cell inside it, not the one outside. Empty cells
 * that the outside cannot reach (6-connected flood fill) are then interior and take the nearest shell colour. A surface
 * that is not closed (a painting, a banner) simply stays a thin shell.
 */
public final class EntityVoxelizer {
    /** Colour lookup: texture coordinates 0..1 to 0xAARRGGBB; alpha below 128 means "no surface here". */
    public interface Texture {
        int argb(double u, double v);
    }

    /**
     * @param p   three vertices, x,y,z each, in cells (1 cell = 1/16 block)
     * @param uv  the same vertices' u,v (6 floats)
     * @param rgb the same vertices' colour multiplier, 0xRRGGBB (3 ints)
     * @param n   outward normal, or null when the renderer gave none
     * @param tex null means plain vertex colour
     */
    public record Tri(float[] p, float[] uv, int[] rgb, float[] n, Texture tex) {}

    /** Occupied cells of a box of space: `rgb[i]` is 0 for empty, else 0x01000000 | 0xRRGGBB. Index = x + nx*(y + ny*z). */
    public record Grid(int ox, int oy, int oz, int nx, int ny, int nz, int[] rgb) {
        public static final int SOLID = 0x01000000;

        public long cells() {
            long n = 0;
            for (int v : rgb) if (v != 0) n++;
            return n;
        }
    }

    /** Samples are at most this far apart, in cells, so no cell a surface passes through can be skipped. */
    private static final double STEP = 0.35;
    /** How far samples are pulled inside, in cells; larger than float noise, far smaller than a cell. */
    private static final double NUDGE = 0.005;

    /** How the empty space inside the shell becomes solid. */
    public enum Fill {
        /** Whatever the outside cannot reach (entities: closed models). */
        FLOOD,
        /**
         * Cells walled in along at least two axes and allowed by the mask. For block models, whose cuboids often omit hidden
         * faces: a box missing one face is still enclosed along two axes, a gap between fence rails is enclosed along one.
         */
        ENCLOSED
    }

    /** Which cells may be filled in {@link Fill#ENCLOSED} mode (cell coordinates, same space as the triangles). */
    public interface Mask {
        boolean allows(int x, int y, int z);
    }

    private EntityVoxelizer() {}

    /** @return the cells, or null when nothing was drawn or the bounding space would exceed `maxCells` */
    public static Grid voxelize(List<Tri> tris, long maxCells) {
        return voxelize(tris, maxCells, Fill.FLOOD, null);
    }

    public static Grid voxelize(List<Tri> tris, long maxCells, Fill fill, Mask mask) {
        if (tris.isEmpty()) return null;
        double minX = Double.MAX_VALUE, minY = minX, minZ = minX, maxX = -minX, maxY = maxX, maxZ = maxX;
        for (Tri t : tris)
            for (int i = 0; i < 3; i++) {
                minX = Math.min(minX, t.p[3 * i]); maxX = Math.max(maxX, t.p[3 * i]);
                minY = Math.min(minY, t.p[3 * i + 1]); maxY = Math.max(maxY, t.p[3 * i + 1]);
                minZ = Math.min(minZ, t.p[3 * i + 2]); maxZ = Math.max(maxZ, t.p[3 * i + 2]);
            }
        if (!(maxX - minX < 1e6) || !(maxY - minY < 1e6) || !(maxZ - minZ < 1e6)) return null; // NaN or runaway geometry
        // One empty cell of padding on every side so the flood fill can walk all the way round the shell.
        int ox = (int) Math.floor(minX) - 1, oy = (int) Math.floor(minY) - 1, oz = (int) Math.floor(minZ) - 1;
        int nx = (int) Math.floor(maxX) + 2 - ox, ny = (int) Math.floor(maxY) + 2 - oy, nz = (int) Math.floor(maxZ) + 2 - oz;
        if ((long) nx * ny * nz > maxCells) return null;
        int[] rgb = new int[nx * ny * nz];

        boolean any = false;
        for (Tri t : tris) any |= sample(t, rgb, ox, oy, oz, nx, ny, nz);
        if (!any) return null;
        if (fill == Fill.FLOOD) fillInterior(rgb, nx, ny, nz);
        else fillEnclosed(rgb, ox, oy, oz, nx, ny, nz, mask);
        return new Grid(ox, oy, oz, nx, ny, nz, rgb);
    }

    private static boolean sample(Tri t, int[] rgb, int ox, int oy, int oz, int nx, int ny, int nz) {
        double[] a = {t.p[0], t.p[1], t.p[2]}, b = {t.p[3], t.p[4], t.p[5]}, c = {t.p[6], t.p[7], t.p[8]};
        double longest = Math.max(dist(a, b), Math.max(dist(b, c), dist(c, a)));
        int steps = Math.max(1, (int) Math.ceil(longest / STEP));
        double[] centre = {(a[0] + b[0] + c[0]) / 3, (a[1] + b[1] + c[1]) / 3, (a[2] + b[2] + c[2]) / 3};
        double nxv = 0, nyv = 0, nzv = 0;
        if (t.n != null) {
            double len = Math.sqrt((double) t.n[0] * t.n[0] + (double) t.n[1] * t.n[1] + (double) t.n[2] * t.n[2]);
            if (len > 1e-6) { nxv = t.n[0] / len; nyv = t.n[1] / len; nzv = t.n[2] / len; }
        }
        boolean wrote = false;
        for (int i = 0; i <= steps; i++)
            for (int j = 0; j <= steps - i; j++) {
                double s = (double) i / steps, u = (double) j / steps, w = 1 - s - u;
                double x = w * a[0] + s * b[0] + u * c[0], y = w * a[1] + s * b[1] + u * c[1], z = w * a[2] + s * b[2] + u * c[2];
                // Pull the sample inside: toward the triangle's centre (its own edges) and against the outward normal.
                x += (centre[0] - x) * NUDGE - nxv * NUDGE;
                y += (centre[1] - y) * NUDGE - nyv * NUDGE;
                z += (centre[2] - z) * NUDGE - nzv * NUDGE;
                int cx = (int) Math.floor(x) - ox, cy = (int) Math.floor(y) - oy, cz = (int) Math.floor(z) - oz;
                if (cx < 0 || cy < 0 || cz < 0 || cx >= nx || cy >= ny || cz >= nz) continue;
                int color = colourAt(t, w, s, u);
                if (color < 0) continue; // transparent texel
                rgb[cx + nx * (cy + ny * cz)] = Grid.SOLID | color;
                wrote = true;
            }
        return wrote;
    }

    /** Texture times vertex colour at barycentric (w, s, u) for vertices (a, b, c); -1 where the texel is transparent. */
    private static int colourAt(Tri t, double w, double s, double u) {
        double vr = w * (t.rgb[0] >> 16 & 0xFF) + s * (t.rgb[1] >> 16 & 0xFF) + u * (t.rgb[2] >> 16 & 0xFF);
        double vg = w * (t.rgb[0] >> 8 & 0xFF) + s * (t.rgb[1] >> 8 & 0xFF) + u * (t.rgb[2] >> 8 & 0xFF);
        double vb = w * (t.rgb[0] & 0xFF) + s * (t.rgb[1] & 0xFF) + u * (t.rgb[2] & 0xFF);
        int tr = 255, tg = 255, tb = 255;
        if (t.tex != null) {
            double tu = w * t.uv[0] + s * t.uv[2] + u * t.uv[4], tv = w * t.uv[1] + s * t.uv[3] + u * t.uv[5];
            int argb = t.tex.argb(tu, tv);
            if ((argb >>> 24) < 128) return -1;
            tr = argb >> 16 & 0xFF; tg = argb >> 8 & 0xFF; tb = argb & 0xFF;
        }
        int r = clamp255(Math.round(tr * vr / 255)), g = clamp255(Math.round(tg * vg / 255)), b = clamp255(Math.round(tb * vb / 255));
        return r << 16 | g << 8 | b;
    }

    private static int clamp255(long v) { return (int) Math.max(0, Math.min(255, v)); }

    private static double dist(double[] a, double[] b) {
        return Math.sqrt((a[0] - b[0]) * (a[0] - b[0]) + (a[1] - b[1]) * (a[1] - b[1]) + (a[2] - b[2]) * (a[2] - b[2]));
    }

    /** Fill cells that have shell on both sides along at least two axes (and that the mask allows), from the nearest shell cell. */
    private static void fillEnclosed(int[] rgb, int ox, int oy, int oz, int nx, int ny, int nz, Mask mask) {
        int total = nx * ny * nz;
        int[][] lo = new int[3][total], hi = new int[3][total]; // nearest shell cell index at or before / at or after, per axis (-1 = none)
        int[] stride = {1, nx, nx * ny}, size = {nx, ny, nz};
        for (int axis = 0; axis < 3; axis++) {
            int s = stride[axis], n = size[axis];
            for (int i = 0; i < total; i++) {
                int pos = (i / s) % n;
                lo[axis][i] = rgb[i] != 0 ? i : pos > 0 ? lo[axis][i - s] : -1;
            }
            for (int i = total - 1; i >= 0; i--) {
                int pos = (i / s) % n;
                hi[axis][i] = rgb[i] != 0 ? i : pos < n - 1 ? hi[axis][i + s] : -1;
            }
        }
        int[] fillFrom = new int[total];
        java.util.Arrays.fill(fillFrom, -1);
        for (int i = 0; i < total; i++) {
            if (rgb[i] != 0) continue;
            int axes = 0, from = -1;
            for (int axis = 0; axis < 3; axis++)
                if (lo[axis][i] >= 0 && hi[axis][i] >= 0) {
                    axes++;
                    if (from < 0) from = lo[axis][i];
                }
            if (axes < 2) continue;
            if (mask != null && !mask.allows(ox + i % nx, oy + i / nx % ny, oz + i / (nx * ny))) continue;
            fillFrom[i] = from;
        }
        for (int i = 0; i < total; i++) if (fillFrom[i] >= 0) rgb[i] = rgb[fillFrom[i]];
    }

    /** Mark everything the outside cannot reach as interior and give it the colour of the nearest shell cell. */
    private static void fillInterior(int[] rgb, int nx, int ny, int nz) {
        int total = nx * ny * nz;
        boolean[] outside = new boolean[total];
        int[] queue = new int[total];
        int head = 0, tail = 0;
        queue[tail++] = 0; // the padding layer guarantees (0,0,0) is empty and touches all of the outside
        outside[0] = true;
        while (head < tail) {
            int i = queue[head++];
            int x = i % nx, y = i / nx % ny, z = i / (nx * ny);
            for (int d = 0; d < 6; d++) {
                int xx = x + (d == 0 ? 1 : d == 1 ? -1 : 0), yy = y + (d == 2 ? 1 : d == 3 ? -1 : 0), zz = z + (d == 4 ? 1 : d == 5 ? -1 : 0);
                if (xx < 0 || yy < 0 || zz < 0 || xx >= nx || yy >= ny || zz >= nz) continue;
                int j = xx + nx * (yy + ny * zz);
                if (outside[j] || rgb[j] != 0) continue;
                outside[j] = true;
                queue[tail++] = j;
            }
        }
        // Multi-source BFS from the shell into the interior (cells that are neither shell nor outside).
        head = 0;
        tail = 0;
        for (int i = 0; i < total; i++) if (rgb[i] != 0) queue[tail++] = i;
        while (head < tail) {
            int i = queue[head++];
            int x = i % nx, y = i / nx % ny, z = i / (nx * ny);
            for (int d = 0; d < 6; d++) {
                int xx = x + (d == 0 ? 1 : d == 1 ? -1 : 0), yy = y + (d == 2 ? 1 : d == 3 ? -1 : 0), zz = z + (d == 4 ? 1 : d == 5 ? -1 : 0);
                if (xx < 0 || yy < 0 || zz < 0 || xx >= nx || yy >= ny || zz >= nz) continue;
                int j = xx + nx * (yy + ny * zz);
                if (outside[j] || rgb[j] != 0) continue;
                rgb[j] = rgb[i];
                queue[tail++] = j;
            }
        }
    }
}
