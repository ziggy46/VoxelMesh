package com.voxelmesh;

import com.voxelmesh.core.RelayConfig;
import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import net.fabricmc.loader.api.FabricLoader;

/** Loads `config/voxelmesh.json`, writing the defaults on first run. */
public final class ConfigStore {
    private static RelayConfig cached;

    private ConfigStore() {}

    public static synchronized RelayConfig get() {
        if (cached != null) return cached;
        Path file = FabricLoader.getInstance().getConfigDir().resolve("voxelmesh.json");
        try {
            if (Files.exists(file)) {
                cached = RelayConfig.fromJson(Files.readString(file, StandardCharsets.UTF_8));
            } else {
                cached = new RelayConfig();
                Files.writeString(file, cached.toJson(), StandardCharsets.UTF_8);
            }
        } catch (IOException | RuntimeException e) {
            VoxelMeshClientMod.LOGGER.warn("Could not read {}: {}. Using defaults.", file, e.toString());
            cached = new RelayConfig();
        }
        return cached;
    }

    public static Path exportDir() {
        return FabricLoader.getInstance().getGameDir().resolve("voxelmesh");
    }
}
