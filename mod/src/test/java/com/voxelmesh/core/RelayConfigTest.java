package com.voxelmesh.core;

import static org.junit.jupiter.api.Assertions.*;

import java.net.URI;
import org.junit.jupiter.api.Test;

class RelayConfigTest {
    @Test
    void defaultsAreLoopback() {
        RelayConfig c = RelayConfig.fromJson("{}");
        assertEquals(RelayConfig.DEFAULT_RELAY, c.relayUrl);
        assertTrue(RelayConfig.isLoopback(c.relayUri()));
        assertEquals(20_000, c.tickSliceBlocks);
    }

    @Test
    void clampsSliceAndRejectsBadUrls() {
        assertEquals(1_000, RelayConfig.fromJson("{\"tickSliceBlocks\":5}").tickSliceBlocks);
        assertEquals(200_000, RelayConfig.fromJson("{\"tickSliceBlocks\":99999999}").tickSliceBlocks);
        assertThrows(IllegalArgumentException.class, () -> RelayConfig.fromJson("{\"relayUrl\":\"file:///etc/passwd\"}").relayUri());
        assertThrows(IllegalArgumentException.class, () -> RelayConfig.fromJson("{\"relayUrl\":\"javascript:alert(1)\"}").relayUri());
        assertEquals(RelayConfig.DEFAULT_RELAY, RelayConfig.fromJson("").relayUrl);
    }

    @Test
    void loopbackDetection() {
        assertTrue(RelayConfig.isLoopback(URI.create("http://localhost:5173/x")));
        assertTrue(RelayConfig.isLoopback(URI.create("http://127.0.0.1/x")));
        assertFalse(RelayConfig.isLoopback(URI.create("http://example.com/x")));
        assertFalse(RelayConfig.isLoopback(URI.create("http://127.0.0.1.evil.com/x")));
    }

    @Test
    void browserUriUsesTheRelayOriginAndRejectsOddIds() {
        RelayConfig c = RelayConfig.fromJson("{\"relayUrl\":\"http://127.0.0.1:5173/api/builds\"}");
        String id = "0123456789abcdef0123456789abcdef";
        assertEquals(URI.create("http://127.0.0.1:5173/?build=" + id), c.browserUri(id));
        assertThrows(IllegalArgumentException.class, () -> c.browserUri("../../evil"));
        assertThrows(IllegalArgumentException.class, () -> c.browserUri(id.toUpperCase()));
    }
}
