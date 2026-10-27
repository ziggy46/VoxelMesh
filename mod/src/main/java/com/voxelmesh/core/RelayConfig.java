package com.voxelmesh.core;

import com.google.gson.Gson;
import com.google.gson.GsonBuilder;
import java.net.URI;
import java.util.Locale;

/** User config (`config/voxelmesh.json`). The relay must be loopback unless the user edits it (docs/02 §5). */
public final class RelayConfig {
    private static final Gson GSON = new GsonBuilder().setPrettyPrinting().create();
    public static final String DEFAULT_RELAY = "http://127.0.0.1:5173/api/builds";

    public String relayUrl = DEFAULT_RELAY;
    /** Blocks scanned per client tick (docs/02 §3). */
    public int tickSliceBlocks = 20_000;

    public static RelayConfig fromJson(String json) {
        RelayConfig c = GSON.fromJson(json, RelayConfig.class);
        if (c == null) c = new RelayConfig();
        if (c.relayUrl == null || c.relayUrl.isBlank()) c.relayUrl = DEFAULT_RELAY;
        if (c.tickSliceBlocks < 1_000) c.tickSliceBlocks = 1_000;
        if (c.tickSliceBlocks > 200_000) c.tickSliceBlocks = 200_000;
        return c;
    }

    public String toJson() {
        return GSON.toJson(this);
    }

    public static boolean isLoopback(URI uri) {
        String host = uri.getHost();
        if (host == null) return false;
        host = host.toLowerCase(Locale.ROOT);
        return host.equals("127.0.0.1") || host.equals("localhost") || host.equals("[::1]") || host.equals("::1");
    }

    /** Parse and validate: http(s) with a host. Throws IllegalArgumentException otherwise. */
    public URI relayUri() {
        URI u = URI.create(relayUrl.trim());
        String s = u.getScheme();
        if (s == null || !(s.equalsIgnoreCase("http") || s.equalsIgnoreCase("https")) || u.getHost() == null) {
            throw new IllegalArgumentException("relayUrl must be an http(s) URL: " + relayUrl);
        }
        return u;
    }

    /** The page to open for a build id: the relay's own origin, never a URL supplied by the response. */
    public URI browserUri(String id) {
        if (!id.matches("[0-9a-f]{32}")) throw new IllegalArgumentException("unexpected build id");
        URI r = relayUri();
        return URI.create(r.getScheme() + "://" + r.getRawAuthority() + "/?build=" + id);
    }
}
