package com.voxelmesh.core;

import static org.junit.jupiter.api.Assertions.*;
import static org.junit.jupiter.api.Assumptions.assumeTrue;

import java.io.File;
import java.net.URI;
import java.util.List;
import java.util.Optional;
import org.junit.jupiter.api.Test;

class BrowserOpenerTest {
    private static final URI URL = URI.create("https://example.com/a#data=abc");

    @Test
    void picksTheRightCommandPerOs() {
        assertEquals(List.of("open", URL.toString()), BrowserOpener.commandFor("Mac OS X", URL));
        assertEquals(List.of("rundll32", "url.dll,FileProtocolHandler", URL.toString()), BrowserOpener.commandFor("Windows 11", URL));
        assertEquals(List.of("xdg-open", URL.toString()), BrowserOpener.commandFor("Linux", URL));
    }

    @Test
    void reportsAFailingCommandAndASucceedingOne() {
        assumeTrue(new File("/usr/bin/true").exists() && new File("/usr/bin/false").exists());
        assertTrue(BrowserOpener.run(List.of("/usr/bin/true")).isEmpty());
        Optional<String> bad = BrowserOpener.run(List.of("/usr/bin/false"));
        assertTrue(bad.isPresent());
        assertTrue(bad.get().startsWith("exit 1"), bad.get());
    }

    @Test
    void reportsACommandThatCannotStart() {
        Optional<String> r = BrowserOpener.run(List.of("/definitely/not/a/real/binary"));
        assertTrue(r.isPresent());
    }

    @Test
    void refusesToOpenNonWebUrls() throws Exception {
        for (String u : new String[] {"file:///etc/passwd", "javascript:alert(1)", "ftp://example.com/x"}) {
            Optional<String> r = BrowserOpener.openAsync(URI.create(u)).get();
            assertTrue(r.isPresent(), u);
            assertTrue(r.get().contains("non-web"), r.get());
        }
    }
}
