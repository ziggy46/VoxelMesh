package com.voxelmesh.core;

/** Block category, serialised lower-case (docs/01 §2). */
public enum Category {
    SOLID, PARTIAL, THIN, FOLIAGE, FLUID, AIR;

    public String json() {
        return name().toLowerCase(java.util.Locale.ROOT);
    }
}
