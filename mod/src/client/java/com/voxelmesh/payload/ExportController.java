package com.voxelmesh.payload;

import com.voxelmesh.Chat;
import com.voxelmesh.ConfigStore;
import com.voxelmesh.core.LinkBuilder;
import com.voxelmesh.core.Limits;
import com.voxelmesh.core.PayloadWriter;
import com.voxelmesh.core.RelayConfig;
import com.voxelmesh.core.Selection;
import com.voxelmesh.VoxelMeshClientMod;
import com.voxelmesh.core.BrowserOpener;
import com.voxelmesh.core.RelayClient;
import com.voxelmesh.selection.SelectionManager;
import java.io.IOException;
import java.net.URI;
import java.nio.file.Files;
import java.nio.file.Path;
import java.time.LocalDateTime;
import java.time.format.DateTimeFormatter;
import java.util.Optional;
import java.util.concurrent.CompletableFuture;
import net.minecraft.client.MinecraftClient;
import net.minecraft.text.ClickEvent;

/** Runs one capture at a time: scan in tick slices, serialise off-thread, save a backup, upload, open the browser. */
public final class ExportController {
    public enum Mode { EXPORT, SAVE }

    private record Output(byte[] gzipped, Path file) {}

    private static PayloadBuilder job;
    private static Mode mode;
    private static boolean warnedRemote;

    private ExportController() {}

    public static boolean busy() { return job != null; }

    /** HUD line while a scan runs, else null. */
    public static String status() {
        return job == null ? null : String.format("VoxelMesh: scanning %.0f%%", job.progress() * 100);
    }

    public static void start(MinecraftClient client, Mode m, String requestedName) {
        if (client.world == null) {
            Chat.error(client, "Join a world first.");
            return;
        }
        if (job != null) {
            Chat.error(client, "A capture is already running. Use /vm clear to cancel it.");
            return;
        }
        Optional<Selection> sel = SelectionManager.selection();
        if (sel.isEmpty()) {
            Chat.error(client, "Set both corners first: look at a block and press [ and ], or use /vm pos1 and /vm pos2.");
            return;
        }
        Selection s = sel.get();
        switch (Limits.check(s.blocks())) {
            case REFUSE -> {
                Chat.error(client, "Selection " + s.describe() + " is over the 128×128×128 limit. Shrink it.");
                return;
            }
            case WARN -> Chat.warn(client, "Large selection " + s.describe() + ". Scanning and meshing will be slow.");
            default -> { }
        }
        RelayConfig cfg = ConfigStore.get();
        if (m == Mode.EXPORT) {
            try {
                URI relay = cfg.relayUri();
                if (!RelayConfig.isLoopback(relay) && !warnedRemote) {
                    warnedRemote = true;
                    Chat.warn(client, "Your relayUrl (" + relay.getHost() + ") is not loopback. Builds will be sent to that host.");
                }
            } catch (IllegalArgumentException e) {
                Chat.error(client, e.getMessage());
                return;
            }
        }
        String title = requestedName == null || requestedName.isBlank() ? "Minecraft build" : requestedName.trim();
        try {
            job = new PayloadBuilder(client.world, s, title, cfg.tickSliceBlocks);
        } catch (IllegalArgumentException e) {
            Chat.error(client, e.getMessage());
            return;
        }
        mode = m;
        Chat.info(client, "Scanning " + s.describe() + "…");
    }

    public static void cancel(MinecraftClient client) {
        if (job != null) {
            job.cancel();
            job = null;
            Chat.info(client, "Capture cancelled.");
        }
    }

    /** Called every END_CLIENT_TICK. */
    public static void tick(MinecraftClient client) {
        PayloadBuilder b = job;
        if (b == null) return;
        if (client.world == null) { // left the world mid-scan
            job = null;
            return;
        }
        try {
            if (b.step()) finish(client, b);
        } catch (RuntimeException e) {
            job = null;
            Chat.error(client, "Capture failed: " + e.getMessage());
        }
    }

    private static void finish(MinecraftClient client, PayloadBuilder b) {
        PayloadBuilder.Result r = b.result();
        Mode m = mode;
        job = null;
        String note = r.unloadedBlocks() > 0 ? " " + r.unloadedBlocks() + " blocks were in unloaded chunks and were recorded as air." : "";
        Chat.info(client, "Captured " + r.nonAirBlocks() + " blocks, " + r.palette().size() + " block types." + note);

        String fileName = m == Mode.SAVE ? safe(r.header().title()) : safe(r.header().title()) + "-" + LocalDateTime.now().format(DateTimeFormatter.ofPattern("yyyyMMdd-HHmmss"));
        CompletableFuture
            .supplyAsync(() -> {
                byte[] gz = PayloadWriter.gzip(PayloadWriter.toJson(r.header(), r.sx(), r.sy(), r.sz(), r.palette(), r.voxels()));
                try {
                    Path dir = ConfigStore.exportDir();
                    Files.createDirectories(dir);
                    Path file = dir.resolve(fileName + ".vxm.json.gz");
                    Files.write(file, gz);
                    return new Output(gz, file);
                } catch (IOException e) {
                    throw new RuntimeException("could not write the backup file: " + e.getMessage(), e);
                }
            })
            .whenComplete((out, err) -> client.execute(() -> {
                if (err != null) {
                    Chat.error(client, "Capture failed: " + rootMessage(err));
                    return;
                }
                if (m == Mode.EXPORT) {
                    Chat.info(client, "Saved " + out.file());
                    upload(client, out);
                } else {
                    announceSaved(client, out);
                }
            }));
    }

    /** `/vm save` only writes the file, so say where it is and give one-click ways to use it. */
    private static void announceSaved(MinecraftClient client, Output out) {
        java.util.List<Chat.Button> buttons = new java.util.ArrayList<>();
        buttons.add(new Chat.Button("Open folder", ClickEvent.Action.OPEN_FILE, out.file().getParent().toString()));
        try {
            ConfigStore.get().siteUri().ifPresent(site -> buttons.add(new Chat.Button("Open VoxelMesh", ClickEvent.Action.OPEN_URL, site.toString())));
        } catch (RuntimeException e) {
            VoxelMeshClientMod.LOGGER.warn("siteUrl is not usable: {}", e.toString());
        }
        Chat.links(client, "Saved " + out.file() + ". Drag this file onto the app, or use /vm export to open it directly.",
            buttons.toArray(new Chat.Button[0]));
    }

    private static void upload(MinecraftClient client, Output out) {
        RelayConfig cfg = ConfigStore.get();
        RelayClient.post(cfg.relayUri(), out.gzipped()).whenComplete((id, err) -> client.execute(() -> {
            if (err != null) {
                fallBackToSite(client, out, rootMessage(err));
                return;
            }
            try {
                openAndReport(client, cfg.browserUri(id), "Opened VoxelMesh in your browser.", "Open VoxelMesh");
            } catch (RuntimeException e) {
                Chat.warn(client, "Uploaded, but could not build the link: " + e.getMessage());
            }
        }));
    }

    /**
     * The local app is not running. The hosted site takes the build in the URL fragment, which no browser sends to a server, so
     * nothing is uploaded. Three tiers by size: open it directly; else copy the link for the player to paste (no command-line
     * limit applies); else leave the saved file and say how to use it. Every tier prints something clickable or actionable.
     */
    private static void fallBackToSite(MinecraftClient client, Output out, String relayError) {
        RelayConfig cfg = ConfigStore.get();
        String file = out.file().getFileName().toString();
        try {
            var site = cfg.siteUri();
            if (site.isPresent()) {
                var direct = LinkBuilder.build(site.get(), out.gzipped(), cfg.maxLinkChars);
                if (direct.isPresent()) {
                    openAndReport(client, direct.get(),
                        "The local app is not running, so I opened " + site.get().getHost()
                            + " (your build travels inside the link and is not uploaded).", "Open VoxelMesh");
                    return;
                }
                var big = LinkBuilder.build(site.get(), out.gzipped(), cfg.maxClipboardChars);
                if (big.isPresent()) {
                    String url = big.get().toString();
                    client.keyboard.setClipboard(url);
                    Chat.link(client, "The local app is not running and this build is too big to open as a link directly. I copied the link to your clipboard: paste it into your browser's address bar.",
                        "Copy link again", ClickEvent.Action.COPY_TO_CLIPBOARD, url);
                    return;
                }
                Chat.warn(client, "The local app is not running (" + relayError + ") and this build is too big for a link. Start the app, "
                    + "or open " + site.get() + " and drag " + file + " onto it.");
                return;
            }
        } catch (RuntimeException e) {
            VoxelMeshClientMod.LOGGER.warn("Hosted-site fallback failed: {}", e.toString());
        }
        Chat.warn(client, "Could not reach the VoxelMesh app (" + relayError + "). Start it, then drag " + file + " onto it.");
    }

    /**
     * Ask the OS to open `uri`, then say what really happened. The operating system's answer is checked (Minecraft's own
     * helper drops it), and a clickable button is always printed so a failed launch is never a dead end.
     */
    private static void openAndReport(MinecraftClient client, URI uri, String okMessage, String label) {
        BrowserOpener.openAsync(uri).thenAccept(problem -> client.execute(() -> {
            String url = uri.toString();
            if (problem.isEmpty()) {
                Chat.link(client, okMessage + " If no tab appeared:", label, ClickEvent.Action.OPEN_URL, url);
            } else {
                VoxelMeshClientMod.LOGGER.warn("Could not open the browser: {}", problem.get());
                Chat.link(client, "Your system could not open the browser (" + problem.get() + "). Click here instead:", label,
                    ClickEvent.Action.OPEN_URL, url);
            }
        }));
    }

    private static String rootMessage(Throwable t) {
        while (t.getCause() != null && t.getCause() != t) t = t.getCause();
        return t.getMessage() == null ? t.getClass().getSimpleName() : t.getMessage();
    }

    static String safe(String s) {
        String t = s.replaceAll("[^A-Za-z0-9._-]+", "_").replaceAll("^_+|_+$", "");
        return t.isEmpty() ? "build" : t.length() > 80 ? t.substring(0, 80) : t;
    }
}
