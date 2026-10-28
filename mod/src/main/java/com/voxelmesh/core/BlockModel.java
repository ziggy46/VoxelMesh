package com.voxelmesh.core;

import java.util.List;

/**
 * A block state's real shape and colours, taken from the model the game draws (docs/01 §3d), for blocks whose hitbox is not
 * what you see (fences, doors, anvils, flowers). Boxes are {x0,y0,z0,x1,y1,z1,colourIndex} in block-local sub-voxels
 * (0..16, Minecraft axes, half-open) with an index into `palette` ("#RRGGBB").
 */
public record BlockModel(List<String> palette, List<int[]> boxes) {
    public BlockModel {
        palette = List.copyOf(palette);
        boxes = List.copyOf(boxes);
    }

    public long cells() {
        long n = 0;
        for (int[] b : boxes) n += (long) (b[3] - b[0]) * (b[4] - b[1]) * (b[5] - b[2]);
        return n;
    }

    public String key() {
        StringBuilder b = new StringBuilder(String.join(",", palette)).append('#');
        for (int[] x : boxes) b.append(java.util.Arrays.toString(x));
        return b.toString();
    }
}
