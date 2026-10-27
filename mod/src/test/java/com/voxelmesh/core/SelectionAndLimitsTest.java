package com.voxelmesh.core;

import static org.junit.jupiter.api.Assertions.*;

import org.junit.jupiter.api.Test;

class SelectionAndLimitsTest {
    @Test
    void normalisesCornersAndCountsInclusively() {
        Selection s = new Selection(5, 70, -3, 2, 64, 4);
        assertEquals(2, s.x1);
        assertEquals(5, s.x2);
        assertEquals(64, s.y1);
        assertEquals(-3, s.z1);
        assertEquals(4, s.sizeX());
        assertEquals(7, s.sizeY());
        assertEquals(8, s.sizeZ());
        assertEquals(4L * 7 * 8, s.blocks());
        assertEquals("4×7×8 (224 blocks)", s.describe());
        assertEquals(1, new Selection(3, 3, 3, 3, 3, 3).blocks());
    }

    @Test
    void limitsMatchDocs02() {
        assertEquals(Limits.Verdict.OK, Limits.check(64L * 64 * 64));
        assertEquals(Limits.Verdict.WARN, Limits.check(64L * 64 * 64 + 1));
        assertEquals(Limits.Verdict.WARN, Limits.check(2_097_152));
        assertEquals(Limits.Verdict.REFUSE, Limits.check(2_097_153));
        assertEquals(Limits.Verdict.REFUSE, Limits.check(129L * 129 * 129));
    }
}
