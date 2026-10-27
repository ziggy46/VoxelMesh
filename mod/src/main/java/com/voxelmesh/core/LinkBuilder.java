package com.voxelmesh.core;

import java.net.URI;
import java.util.Base64;
import java.util.Optional;

/**
 * Builds `https://site/#data=<base64url gzip>` links (docs/00 §3, transport 3). The payload sits in the URL fragment, which
 * browsers never send to a server, so the hosted site sees nothing: it decodes the fragment in the page itself.
 */
public final class LinkBuilder {
    private LinkBuilder() {}

    /**
     * @param site     the hosted app, https (or http on loopback); any query or fragment on it is dropped
     * @param maxChars longest link to emit. Operating systems cap the command line used to open a browser (about 32k
     *                 characters on Windows), so the default is conservative and anything larger is not attempted.
     * @return the link, or empty when the payload does not fit
     */
    public static Optional<URI> build(URI site, byte[] gzipped, int maxChars) {
        String scheme = site.getScheme();
        boolean ok = site.getHost() != null
            && ("https".equalsIgnoreCase(scheme) || ("http".equalsIgnoreCase(scheme) && RelayConfig.isLoopback(site)));
        if (!ok) throw new IllegalArgumentException("siteUrl must be https (or http on localhost): " + site);
        String path = site.getRawPath() == null || site.getRawPath().isEmpty() ? "/" : site.getRawPath();
        String head = scheme + "://" + site.getRawAuthority() + path + "#data=";
        // Cheap length check before encoding: base64 without padding is ceil(4n/3) characters.
        long encoded = (gzipped.length * 4L + 2) / 3;
        if (head.length() + encoded > maxChars) return Optional.empty();
        String b64 = Base64.getUrlEncoder().withoutPadding().encodeToString(gzipped);
        return Optional.of(URI.create(head + b64));
    }
}
