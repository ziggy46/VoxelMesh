package com.voxelmesh.core;

import static org.junit.jupiter.api.Assertions.*;

import java.net.URI;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.Base64;
import java.util.List;
import org.junit.jupiter.api.Test;

class LinkBuilderTest {
    private static final URI SITE = URI.create("https://example.github.io/VoxelMesh/");

    @Test
    void buildsAFragmentLinkThatRoundTrips() {
        byte[] gz = new byte[] {31, (byte) 139, 8, 0, -1, -2, -3, 62, 63, 0, 5};
        URI link = LinkBuilder.build(SITE, gz, 30_000).orElseThrow();
        assertEquals("https", link.getScheme());
        assertEquals("example.github.io", link.getHost());
        assertEquals("/VoxelMesh/", link.getPath());
        String frag = link.getRawFragment();
        assertTrue(frag.startsWith("data="));
        String b64 = frag.substring(5);
        assertFalse(b64.contains("+") || b64.contains("/") || b64.contains("="), "must be base64url without padding");
        assertArrayEquals(gz, Base64.getUrlDecoder().decode(b64));
    }

    @Test
    void refusesWhatDoesNotFit() {
        byte[] gz = new byte[1000];
        assertTrue(LinkBuilder.build(SITE, gz, 30_000).isPresent());
        int len = LinkBuilder.build(SITE, gz, 30_000).orElseThrow().toString().length();
        assertTrue(LinkBuilder.build(SITE, gz, len).isPresent(), "exactly at the limit fits");
        assertTrue(LinkBuilder.build(SITE, gz, len - 1).isEmpty());
        assertTrue(LinkBuilder.build(SITE, new byte[100_000], 30_000).isEmpty());
    }

    @Test
    void dropsAnyQueryOrFragmentOnTheSiteUrl() {
        URI link = LinkBuilder.build(URI.create("https://example.com/app/?x=1#old"), new byte[] {1, 2, 3}, 30_000).orElseThrow();
        assertEquals("/app/", link.getPath());
        assertNull(link.getQuery());
        assertTrue(link.getRawFragment().startsWith("data="));
    }

    @Test
    void onlyHttpsOrLoopbackHttp() {
        assertThrows(IllegalArgumentException.class, () -> LinkBuilder.build(URI.create("http://example.com/"), new byte[1], 30_000));
        assertThrows(IllegalArgumentException.class, () -> LinkBuilder.build(URI.create("file:///etc/passwd"), new byte[1], 30_000));
        assertThrows(IllegalArgumentException.class, () -> LinkBuilder.build(URI.create("javascript:alert(1)"), new byte[1], 30_000));
        assertTrue(LinkBuilder.build(URI.create("http://127.0.0.1:5173/"), new byte[1], 30_000).isPresent());
        assertTrue(LinkBuilder.build(URI.create("http://localhost:5173/"), new byte[1], 30_000).isPresent());
    }

    @Test
    void configDefaultsAndValidation() {
        RelayConfig c = RelayConfig.fromJson("{}");
        assertTrue(c.siteUri().isPresent());
        assertEquals(30_000, c.maxLinkChars);
        assertTrue(RelayConfig.fromJson("{\"siteUrl\":\"\"}").siteUri().isEmpty(), "empty disables the hosted fallback");
        assertThrows(IllegalArgumentException.class, () -> RelayConfig.fromJson("{\"siteUrl\":\"http://evil.example/\"}").siteUri());
        assertEquals(2_000, RelayConfig.fromJson("{\"maxLinkChars\":5}").maxLinkChars);
        assertEquals(100_000, RelayConfig.fromJson("{\"maxLinkChars\":99999999}").maxLinkChars);
    }

    /** The web app must decode what the mod emits (see web/src/__tests__/payload/javaInterop.test.ts). */
    @Test
    void writesInteropLink() throws Exception {
        char[] voxels = new char[2 * 2 * 2];
        voxels[0] = 1;
        voxels[7] = 2;
        List<PaletteEntry> pal = List.of(
            new PaletteEntry("minecraft:stone", "Stone", "#7D7D7D", Category.SOLID, List.of(new int[] {0, 0, 0, 16, 16, 16})),
            new PaletteEntry("minecraft:dirt", "Dirt", "#866043", Category.SOLID, List.of(new int[] {0, 0, 0, 16, 16, 16})));
        byte[] gz = PayloadWriter.gzip(PayloadWriter.toJson(
            new PayloadWriter.Header("Link", "1.21.1", "2026-01-01T00:00:00Z", 0, 0, 0), 2, 2, 2, pal, voxels));
        URI link = LinkBuilder.build(SITE, gz, 30_000).orElseThrow();
        Path out = Path.of("build", "interop", "link.txt");
        Files.createDirectories(out.getParent());
        Files.writeString(out, "#" + link.getRawFragment(), StandardCharsets.UTF_8);
        assertTrue(link.toString().length() < 30_000);
    }
}
