package com.voxelmesh.net;

import com.google.gson.JsonObject;
import com.google.gson.JsonParser;
import java.io.IOException;
import java.net.URI;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.nio.charset.StandardCharsets;
import java.time.Duration;
import java.util.concurrent.CompletableFuture;

/** Posts the gzipped payload to the localhost relay. No telemetry, no other hosts (docs/02 §5). */
public final class CompanionUploader {
    private static final HttpClient HTTP = HttpClient.newBuilder().connectTimeout(Duration.ofSeconds(10)).build();

    private CompanionUploader() {}

    /** @return the relay's build id (32 hex chars); the caller builds the browser URL from its own configured origin */
    public static CompletableFuture<String> post(URI relay, byte[] gzipped) {
        HttpRequest req = HttpRequest.newBuilder(relay)
            .timeout(Duration.ofSeconds(30))
            .header("Content-Type", "application/gzip")
            .POST(HttpRequest.BodyPublishers.ofByteArray(gzipped))
            .build();
        return HTTP.sendAsync(req, HttpResponse.BodyHandlers.ofString(StandardCharsets.UTF_8)).thenApply(res -> {
            if (res.statusCode() != 201) throw new RuntimeException(new IOException("relay answered " + res.statusCode() + ": " + res.body()));
            JsonObject o = JsonParser.parseString(res.body()).getAsJsonObject();
            return o.get("id").getAsString();
        });
    }
}
