package com.voxelmesh.core;

import java.util.List;

/**
 * One captured entity: the cells it occupies as boxes, in the same axes and units as block boxes (Minecraft x east, y up, z
 * south; 16 sub-voxels per block) but relative to the selection's minimum corner. Each box is {x0,y0,z0,x1,y1,z1,colourIndex}
 * with a half-open range and an index into `palette` ("#RRGGBB"). `kind` is the entity type id, for display only.
 */
public record EntityRecord(String kind, List<String> palette, List<int[]> boxes) {
    public EntityRecord {
        palette = List.copyOf(palette);
        boxes = List.copyOf(boxes);
    }

    public long cells() {
        long n = 0;
        for (int[] b : boxes) n += (long) (b[3] - b[0]) * (b[4] - b[1]) * (b[5] - b[2]);
        return n;
    }
}
