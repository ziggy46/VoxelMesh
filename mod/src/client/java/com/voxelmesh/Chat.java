package com.voxelmesh;

import net.minecraft.client.MinecraftClient;
import net.minecraft.text.ClickEvent;
import net.minecraft.text.Style;
import net.minecraft.text.Text;
import net.minecraft.util.Formatting;

/** Chat feedback. Always called on the client thread. */
public final class Chat {
    private Chat() {}

    private static void send(MinecraftClient client, Text body) {
        if (client.player == null) return;
        client.player.sendMessage(Text.literal("[VoxelMesh] ").formatted(Formatting.AQUA).append(body), false);
    }

    /** A chat line ending in a clickable label (opens a URL, or copies text), so a failed browser launch is never a dead end. */
    public static void link(MinecraftClient client, String msg, String label, ClickEvent.Action action, String value) {
        Text button = Text.literal("[" + label + "]")
            .setStyle(Style.EMPTY.withClickEvent(new ClickEvent(action, value)).withUnderline(true).withColor(Formatting.AQUA));
        send(client, Text.literal(msg + " ").formatted(Formatting.WHITE).append(button));
    }

    public record Button(String label, ClickEvent.Action action, String value) {}

    /** A chat line followed by several clickable buttons. */
    public static void links(MinecraftClient client, String msg, Button... buttons) {
        net.minecraft.text.MutableText line = Text.literal(msg).formatted(Formatting.WHITE);
        for (Button b : buttons) {
            line.append(Text.literal(" "));
            line.append(Text.literal("[" + b.label() + "]")
                .setStyle(Style.EMPTY.withClickEvent(new ClickEvent(b.action(), b.value())).withUnderline(true).withColor(Formatting.AQUA)));
        }
        send(client, line);
    }

    public static void info(MinecraftClient client, String msg) { send(client, Text.literal(msg).formatted(Formatting.WHITE)); }
    public static void warn(MinecraftClient client, String msg) { send(client, Text.literal(msg).formatted(Formatting.YELLOW)); }
    public static void error(MinecraftClient client, String msg) { send(client, Text.literal(msg).formatted(Formatting.RED)); }
}
