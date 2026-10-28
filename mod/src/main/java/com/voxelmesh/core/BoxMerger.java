package com.voxelmesh.core;

import java.util.ArrayList;
import java.util.HashMap;
import java.util.List;
import java.util.Map;

/** Greedily merges voxelized cells of one colour into boxes, clipped to the selection. Pure. */
public final class BoxMerger {
    /** Cap per entity so one huge or noisy model cannot bloat the payload. */
    public static final int MAX_BOXES = 20_000;

    private BoxMerger() {}

    /** Colours are reduced to 16 levels per channel: the web app clusters them into a few filament slots anyway. */
    static int quantize(int rgb) {
        int r = q(rgb >> 16 & 0xFF), g = q(rgb >> 8 & 0xFF), b = q(rgb & 0xFF);
        return r << 16 | g << 8 | b;
    }

    private static int q(int v) { return Math.min(15, (v + 8) / 17) * 17; }

    /**
     * @param g     voxelized cells, in cells relative to the selection's minimum corner
     * @param clip  selection size in cells (x, y, z); cells outside [0, clip) are dropped
     * @return the record, or null when no cell is inside the selection
     */
    public static EntityRecord merge(String kind, EntityVoxelizer.Grid g, int clipX, int clipY, int clipZ) {
        int x0 = Math.max(0, g.ox()), y0 = Math.max(0, g.oy()), z0 = Math.max(0, g.oz());
        int x1 = Math.min(clipX, g.ox() + g.nx()), y1 = Math.min(clipY, g.oy() + g.ny()), z1 = Math.min(clipZ, g.oz() + g.nz());
        if (x0 >= x1 || y0 >= y1 || z0 >= z1) return null;
        int w = x1 - x0, h = y1 - y0, d = z1 - z0;

        // Quantized colour per cell inside the clip, 0 = empty.
        int[] cell = new int[w * h * d];
        boolean any = false;
        for (int z = 0; z < d; z++)
            for (int y = 0; y < h; y++)
                for (int x = 0; x < w; x++) {
                    int v = g.rgb()[(x + x0 - g.ox()) + g.nx() * ((y + y0 - g.oy()) + g.ny() * (z + z0 - g.oz()))];
                    if (v == 0) continue;
                    cell[x + w * (y + h * z)] = EntityVoxelizer.Grid.SOLID | quantize(v & 0xFFFFFF);
                    any = true;
                }
        if (!any) return null;

        Map<Integer, Integer> index = new HashMap<>();
        List<String> palette = new ArrayList<>();
        List<int[]> boxes = new ArrayList<>();
        boolean[] done = new boolean[cell.length];
        outer:
        for (int z = 0; z < d; z++)
            for (int y = 0; y < h; y++)
                for (int x = 0; x < w; x++) {
                    int i = x + w * (y + h * z);
                    int c = cell[i];
                    if (c == 0 || done[i]) continue;
                    int ex = x + 1;
                    while (ex < w && cell[ex + w * (y + h * z)] == c && !done[ex + w * (y + h * z)]) ex++;
                    int ey = y + 1;
                    while (ey < h && rowMatches(cell, done, w, h, x, ex, ey, z, c)) ey++;
                    int ez = z + 1;
                    while (ez < d && layerMatches(cell, done, w, h, x, ex, y, ey, ez, c)) ez++;
                    for (int zz = z; zz < ez; zz++)
                        for (int yy = y; yy < ey; yy++)
                            for (int xx = x; xx < ex; xx++) done[xx + w * (yy + h * zz)] = true;
                    int ci = index.computeIfAbsent(c, k -> {
                        palette.add(ColorMath.hex(k & 0xFFFFFF));
                        return palette.size() - 1;
                    });
                    boxes.add(new int[] {x0 + x, y0 + y, z0 + z, x0 + ex, y0 + ey, z0 + ez, ci});
                    if (boxes.size() >= MAX_BOXES) break outer;
                }
        return new EntityRecord(kind, palette, boxes);
    }

    private static boolean rowMatches(int[] cell, boolean[] done, int w, int h, int xa, int xb, int y, int z, int c) {
        for (int x = xa; x < xb; x++) {
            int i = x + w * (y + h * z);
            if (cell[i] != c || done[i]) return false;
        }
        return true;
    }

    private static boolean layerMatches(int[] cell, boolean[] done, int w, int h, int xa, int xb, int ya, int yb, int z, int c) {
        for (int y = ya; y < yb; y++) if (!rowMatches(cell, done, w, h, xa, xb, y, z, c)) return false;
        return true;
    }
}
