package com.voxelmesh.core;

/** Selection size limits (docs/02 §2): warn above 64^3 blocks, refuse above 128^3. */
public final class Limits {
    public static final long WARN_BLOCKS = 64L * 64 * 64;
    public static final long MAX_BLOCKS = 128L * 128 * 128;
    /** Palette indices are uint16; 65535 is reserved (docs/01 §3), air is index 0. */
    public static final int MAX_PALETTE_ENTRIES = 65_534;

    public enum Verdict { OK, WARN, REFUSE }

    private Limits() {}

    public static Verdict check(long blocks) {
        if (blocks > MAX_BLOCKS) return Verdict.REFUSE;
        return blocks > WARN_BLOCKS ? Verdict.WARN : Verdict.OK;
    }
}
