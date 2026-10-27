package com.voxelmesh.core;

import static org.junit.jupiter.api.Assertions.*;

import org.junit.jupiter.api.Test;

class ColorMathTest {
    private static int abgr(int a, int r, int g, int b) {
        return a << 24 | b << 16 | g << 8 | r;
    }

    @Test
    void averagesOpaquePixels() {
        int avg = ColorMath.averageAbgr(new int[] {abgr(255, 200, 0, 0), abgr(255, 0, 100, 0)});
        assertEquals(0x643200, avg & 0xFFFFFF, "mean of (200,0,0) and (0,100,0) is (100,50,0)");
    }

    @Test
    void weightsByAlphaAndIgnoresTransparent() {
        // opaque red + fully transparent blue: the blue must not contribute at all
        assertEquals(0xFF0000, ColorMath.averageAbgr(new int[] {abgr(255, 255, 0, 0), abgr(0, 0, 0, 255)}));
        // alpha 255 vs 85 -> red weighted 3:1 against green
        int avg = ColorMath.averageAbgr(new int[] {abgr(255, 240, 0, 0), abgr(85, 0, 240, 0)});
        assertEquals(180, (avg >> 16) & 0xFF);
        assertEquals(60, (avg >> 8) & 0xFF);
    }

    @Test
    void fullyTransparentTextureReturnsMinusOne() {
        assertEquals(-1, ColorMath.averageAbgr(new int[] {abgr(0, 1, 2, 3), abgr(0, 9, 9, 9)}));
        assertEquals(-1, ColorMath.averageAbgr(new int[0]));
    }

    @Test
    void channelOrderIsAbgr() {
        // red lives in the LOW byte of a NativeImage pixel
        assertEquals(0x0000FF, ColorMath.averageAbgr(new int[] {0xFFFF0000})); // A=FF B=FF -> blue
        assertEquals(0xFF0000, ColorMath.averageAbgr(new int[] {0xFF0000FF})); // A=FF R=FF -> red
    }

    @Test
    void tintMultipliesChannels() {
        assertEquals(0x808080, ColorMath.tint(0xFFFFFF, 0x808080));
        assertEquals(0x000000, ColorMath.tint(0xFFFFFF, 0x000000));
        assertEquals(0x7A2E10 & 0xFFFFFF, ColorMath.tint(0x7A2E10, 0xFFFFFF));
        assertEquals("#0A0B0C", ColorMath.hex(0x0A0B0C));
    }
}
