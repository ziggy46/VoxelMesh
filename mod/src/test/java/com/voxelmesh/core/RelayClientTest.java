package com.voxelmesh.core;

import static org.junit.jupiter.api.Assertions.*;

import com.sun.net.httpserver.HttpServer;
import java.net.InetAddress;
import java.net.InetSocketAddress;
import java.net.URI;
import java.nio.charset.StandardCharsets;
import java.util.concurrent.ExecutionException;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.atomic.AtomicReference;
import org.junit.jupiter.api.Test;

class RelayClientTest {
    private static HttpServer start(int status, String body, AtomicReference<com.sun.net.httpserver.Headers> seen, AtomicReference<byte[]> bodySeen) throws Exception {
        HttpServer s = HttpServer.create(new InetSocketAddress(InetAddress.getLoopbackAddress(), 0), 0);
        s.createContext("/api/builds", ex -> {
            seen.set(ex.getRequestHeaders());
            bodySeen.set(ex.getRequestBody().readAllBytes());
            byte[] out = body.getBytes(StandardCharsets.UTF_8);
            ex.sendResponseHeaders(status, out.length);
            ex.getResponseBody().write(out);
            ex.close();
        });
        s.start();
        return s;
    }

    private static URI uri(HttpServer s) {
        return URI.create("http://127.0.0.1:" + s.getAddress().getPort() + "/api/builds");
    }

    @Test
    void postsOverPlainHttp11WithoutAnUpgradeRequest() throws Exception {
        var headers = new AtomicReference<com.sun.net.httpserver.Headers>();
        var body = new AtomicReference<byte[]>();
        HttpServer s = start(201, "{\"id\":\"0123456789abcdef0123456789abcdef\",\"url\":\"x\"}", headers, body);
        try {
            byte[] data = {1, 2, 3, 4};
            String id = RelayClient.post(uri(s), data).get(10, TimeUnit.SECONDS);
            assertEquals("0123456789abcdef0123456789abcdef", id);
            assertArrayEquals(data, body.get());
            // The Vite dev server never answers a request that asks to upgrade to h2c, so the client must not ask.
            assertFalse(headers.get().containsKey("Upgrade"), "must not request an HTTP/2 upgrade");
            assertFalse(headers.get().containsKey("Http2-settings"), "must not send HTTP2-Settings");
            assertEquals("application/gzip", headers.get().getFirst("Content-Type"));
        } finally {
            s.stop(0);
        }
    }

    @Test
    void reportsANon201AsAnError() throws Exception {
        HttpServer s = start(413, "{\"error\":\"too big\"}", new AtomicReference<>(), new AtomicReference<>());
        try {
            var ex = assertThrows(ExecutionException.class, () -> RelayClient.post(uri(s), new byte[1]).get(10, TimeUnit.SECONDS));
            assertTrue(ex.getCause().getMessage().contains("413"), ex.getCause().getMessage());
        } finally {
            s.stop(0);
        }
    }

    @Test
    void anUnreachableRelayFailsFast() throws Exception {
        HttpServer s = start(201, "{}", new AtomicReference<>(), new AtomicReference<>());
        URI dead = uri(s);
        s.stop(0); // port now closed
        long t0 = System.nanoTime();
        assertThrows(ExecutionException.class, () -> RelayClient.post(dead, new byte[1]).get(10, TimeUnit.SECONDS));
        assertTrue((System.nanoTime() - t0) / 1_000_000 < 5_000, "a refused connection must fail quickly so the fallback runs");
    }
}
