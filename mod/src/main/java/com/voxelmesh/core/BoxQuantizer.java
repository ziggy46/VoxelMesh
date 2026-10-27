package com.voxelmesh.core;

import java.util.ArrayList;
import java.util.List;

/** Quantises VoxelShape boxes (block-local doubles, 0..1) to the 16-unit sub-voxel grid (docs/02 §4.1). */
public final class BoxQuantizer {
    public static final int SUB = 16;
    /** A box at most this many sub-voxels wide along X or Z is "thin" (docs/01 §4). */
    public static final int THIN_MAX = 4;

    private BoxQuantizer() {}

    private static int clamp(int v) {
        return Math.max(0, Math.min(SUB, v));
    }

    /** Round to integers in [0,16]; each max is forced to at least min + 1 so the box never collapses. */
    public static int[] quantize(double minX, double minY, double minZ, double maxX, double maxY, double maxZ) {
        int x0 = clamp((int) Math.round(minX * SUB));
        int y0 = clamp((int) Math.round(minY * SUB));
        int z0 = clamp((int) Math.round(minZ * SUB));
        // A box wholly on the far edge cannot be widened inwards past 16, so pull its min back instead.
        x0 = Math.min(x0, SUB - 1);
        y0 = Math.min(y0, SUB - 1);
        z0 = Math.min(z0, SUB - 1);
        int x1 = Math.max(x0 + 1, clamp((int) Math.round(maxX * SUB)));
        int y1 = Math.max(y0 + 1, clamp((int) Math.round(maxY * SUB)));
        int z1 = Math.max(z0 + 1, clamp((int) Math.round(maxZ * SUB)));
        return new int[] {x0, y0, z0, x1, y1, z1};
    }

    /** Drop exact duplicates, keeping first-seen order (deterministic). */
    public static List<int[]> dedupe(List<int[]> boxes) {
        List<int[]> out = new ArrayList<>();
        outer:
        for (int[] b : boxes) {
            for (int[] o : out) if (java.util.Arrays.equals(o, b)) continue outer;
            out.add(b);
        }
        return out;
    }

    public static boolean isFullCube(List<int[]> boxes) {
        return boxes.size() == 1 && java.util.Arrays.equals(boxes.get(0), new int[] {0, 0, 0, SUB, SUB, SUB});
    }

    public static boolean isThin(List<int[]> boxes) {
        for (int[] b : boxes) if (b[3] - b[0] <= THIN_MAX || b[5] - b[2] <= THIN_MAX) return true;
        return false;
    }

    /** SOLID / THIN / PARTIAL for a non-empty, non-foliage, non-fluid shape. */
    public static Category classify(List<int[]> boxes) {
        if (isFullCube(boxes)) return Category.SOLID;
        return isThin(boxes) ? Category.THIN : Category.PARTIAL;
    }
}
