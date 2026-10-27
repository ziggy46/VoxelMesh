package com.voxelmesh.core;

import java.util.List;

/** One palette entry; `color` is "#RRGGBB". Air (index 0) is added by {@link PayloadWriter}, never stored here. */
public record PaletteEntry(String id, String name, String color, Category category, List<int[]> boxes) {}
