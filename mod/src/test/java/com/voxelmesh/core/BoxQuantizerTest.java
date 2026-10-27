package com.voxelmesh.core;

import static org.junit.jupiter.api.Assertions.*;

import java.util.List;
import org.junit.jupiter.api.Test;

class BoxQuantizerTest {
    @Test
    void fullCubeRoundTrips() {
        assertArrayEquals(new int[] {0, 0, 0, 16, 16, 16}, BoxQuantizer.quantize(0, 0, 0, 1, 1, 1));
    }

    @Test
    void roundsToNearestSubVoxelAndClamps() {
        // fence post 6..10 px, collision taller than a block (1.5): clamped to 16
        assertArrayEquals(new int[] {6, 0, 6, 10, 16, 10}, BoxQuantizer.quantize(0.375, 0, 0.375, 0.625, 1.5, 0.625));
        assertArrayEquals(new int[] {0, 0, 0, 16, 16, 16}, BoxQuantizer.quantize(-0.2, -1, -0.01, 1.3, 2, 1.01));
    }

    @Test
    void neverCollapsesAndNeverExceedsSixteen() {
        int[] sliver = BoxQuantizer.quantize(0.5, 0, 0, 0.5, 1, 1);
        assertEquals(1, sliver[3] - sliver[0]);
        int[] onFarEdge = BoxQuantizer.quantize(1.0, 0, 0, 1.0, 1, 1); // zero-width box at the far face
        assertTrue(onFarEdge[0] >= 0 && onFarEdge[3] <= 16 && onFarEdge[3] > onFarEdge[0]);
        for (int v : onFarEdge) assertTrue(v >= 0 && v <= 16);
    }

    @Test
    void dedupeKeepsFirstSeenOrder() {
        List<int[]> boxes = List.of(new int[] {0, 0, 0, 8, 8, 8}, new int[] {1, 1, 1, 2, 2, 2}, new int[] {0, 0, 0, 8, 8, 8});
        List<int[]> out = BoxQuantizer.dedupe(boxes);
        assertEquals(2, out.size());
        assertArrayEquals(new int[] {1, 1, 1, 2, 2, 2}, out.get(1));
    }

    @Test
    void classifiesPerDocs01() {
        assertEquals(Category.SOLID, BoxQuantizer.classify(List.of(new int[] {0, 0, 0, 16, 16, 16})));
        // slab and stairs are partial
        assertEquals(Category.PARTIAL, BoxQuantizer.classify(List.of(new int[] {0, 0, 0, 16, 8, 16})));
        assertEquals(Category.PARTIAL, BoxQuantizer.classify(List.of(new int[] {0, 0, 0, 16, 8, 16}, new int[] {0, 8, 8, 16, 16, 16})));
        // fence post (4 wide) and chain (2 wide) are thin; a lantern's top box is 4 wide, so it is thin too (docs/01 §4 lists lanterns)
        assertEquals(Category.THIN, BoxQuantizer.classify(List.of(new int[] {6, 0, 6, 10, 16, 10})));
        assertEquals(Category.THIN, BoxQuantizer.classify(List.of(new int[] {7, 0, 7, 9, 16, 9})));
        assertEquals(Category.THIN, BoxQuantizer.classify(List.of(new int[] {5, 0, 5, 11, 7, 11}, new int[] {6, 7, 6, 10, 9, 10})));
        // a 6-wide box alone is partial
        assertEquals(Category.PARTIAL, BoxQuantizer.classify(List.of(new int[] {5, 0, 5, 11, 7, 11})));
    }
}
