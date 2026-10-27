package com.voxelmesh.core;

/** Two-corner selection in block coordinates; both corners are inclusive. Pure maths. */
public final class Selection {
    public final int x1, y1, z1, x2, y2, z2;

    public Selection(int ax, int ay, int az, int bx, int by, int bz) {
        x1 = Math.min(ax, bx);
        y1 = Math.min(ay, by);
        z1 = Math.min(az, bz);
        x2 = Math.max(ax, bx);
        y2 = Math.max(ay, by);
        z2 = Math.max(az, bz);
    }

    public int sizeX() { return x2 - x1 + 1; }
    public int sizeY() { return y2 - y1 + 1; }
    public int sizeZ() { return z2 - z1 + 1; }

    public long blocks() {
        return (long) sizeX() * sizeY() * sizeZ();
    }

    public String describe() {
        return sizeX() + "×" + sizeY() + "×" + sizeZ() + " (" + blocks() + " blocks)";
    }
}
