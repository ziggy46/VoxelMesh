package com.voxelmesh;

import net.minecraft.client.MinecraftClient;
import net.minecraft.text.Text;
import net.minecraft.util.Formatting;

/** Chat feedback. Always called on the client thread. */
public final class Chat {
    private Chat() {}

    private static void send(MinecraftClient client, Text body) {
        if (client.player == null) return;
        client.player.sendMessage(Text.literal("[VoxelMesh] ").formatted(Formatting.AQUA).append(body), false);
    }

    public static void info(MinecraftClient client, String msg) { send(client, Text.literal(msg).formatted(Formatting.WHITE)); }
    public static void warn(MinecraftClient client, String msg) { send(client, Text.literal(msg).formatted(Formatting.YELLOW)); }
    public static void error(MinecraftClient client, String msg) { send(client, Text.literal(msg).formatted(Formatting.RED)); }
}
