package com.voxelmesh.core;

import java.net.URI;
import java.nio.charset.StandardCharsets;
import java.util.List;
import java.util.Locale;
import java.util.Optional;
import java.util.concurrent.CompletableFuture;
import java.util.concurrent.TimeUnit;

/**
 * Opens a URL in the default browser and, unlike Minecraft's own helper (which discards the command's result), reports
 * whether the operating system accepted it, so a silent failure becomes a chat message. Only http(s) URLs are opened.
 */
public final class BrowserOpener {
    private BrowserOpener() {}

    /** The command line for `os` (the value of the `os.name` property). */
    public static List<String> commandFor(String os, URI uri) {
        String n = os.toLowerCase(Locale.ROOT);
        String url = uri.toString();
        if (n.contains("win")) return List.of("rundll32", "url.dll,FileProtocolHandler", url);
        if (n.contains("mac") || n.contains("darwin")) return List.of("open", url);
        return List.of("xdg-open", url);
    }

    /** @return empty on success, else a short reason. Never throws. */
    static Optional<String> run(List<String> command) {
        try {
            Process p = new ProcessBuilder(command).redirectErrorStream(true).start();
            p.getOutputStream().close();
            if (!p.waitFor(8, TimeUnit.SECONDS)) {
                // Some launchers stay alive until the browser closes; that is fine, the URL was handed over.
                return Optional.empty();
            }
            if (p.exitValue() == 0) return Optional.empty();
            String out = new String(p.getInputStream().readAllBytes(), StandardCharsets.UTF_8).trim();
            return Optional.of("exit " + p.exitValue() + (out.isEmpty() ? "" : ": " + out.lines().findFirst().orElse("")));
        } catch (Exception e) {
            return Optional.of(e.getClass().getSimpleName() + (e.getMessage() == null ? "" : ": " + e.getMessage()));
        }
    }

    /** Runs on a background thread. Completes with empty on success, or a reason; never fails. */
    public static CompletableFuture<Optional<String>> openAsync(URI uri) {
        String scheme = uri.getScheme();
        if (scheme == null || !(scheme.equalsIgnoreCase("http") || scheme.equalsIgnoreCase("https"))) {
            return CompletableFuture.completedFuture(Optional.of("refusing to open a non-web URL"));
        }
        return CompletableFuture.supplyAsync(() -> run(commandFor(System.getProperty("os.name", ""), uri)));
    }
}
