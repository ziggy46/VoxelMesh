package com.voxelmesh.core;

import java.util.List;

/**
 * One palette entry; `color` is "#RRGGBB". Air (index 0) is added by {@link PayloadWriter}, never stored here.
 * `relief` is optional: 1536 luma bytes (see {@link ReliefSampler}) for full-cube blocks, else null.
 */
public record PaletteEntry(String id, String name, String color, Category category, List<int[]> boxes, byte[] relief) {
    public PaletteEntry(String id, String name, String color, Category category, List<int[]> boxes) {
        this(id, name, color, category, boxes, null);
    }
}
