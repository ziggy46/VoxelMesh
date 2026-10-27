package com.voxelmesh.command;

import static net.fabricmc.fabric.api.client.command.v2.ClientCommandManager.argument;
import static net.fabricmc.fabric.api.client.command.v2.ClientCommandManager.literal;

import com.mojang.brigadier.Command;
import com.mojang.brigadier.CommandDispatcher;
import com.mojang.brigadier.arguments.IntegerArgumentType;
import com.mojang.brigadier.arguments.StringArgumentType;
import com.mojang.brigadier.context.CommandContext;
import com.voxelmesh.Chat;
import com.voxelmesh.payload.ExportController;
import com.voxelmesh.selection.SelectionManager;
import net.fabricmc.fabric.api.client.command.v2.FabricClientCommandSource;
import net.minecraft.client.MinecraftClient;
import net.minecraft.util.hit.BlockHitResult;
import net.minecraft.util.hit.HitResult;
import net.minecraft.util.math.BlockPos;

/** `/vm pos1 [x y z]`, `pos2`, `export [title]`, `save [name]`, `clear` (docs/02 §2). */
public final class VmCommands {
    private VmCommands() {}

    public static void register(CommandDispatcher<FabricClientCommandSource> d) {
        d.register(literal("vm")
            .executes(c -> help(c))
            .then(corner("pos1", 1))
            .then(corner("pos2", 2))
            .then(literal("export")
                .executes(c -> run(ExportController.Mode.EXPORT, null))
                .then(argument("title", StringArgumentType.greedyString())
                    .executes(c -> run(ExportController.Mode.EXPORT, StringArgumentType.getString(c, "title")))))
            .then(literal("save")
                .executes(c -> run(ExportController.Mode.SAVE, null))
                .then(argument("name", StringArgumentType.greedyString())
                    .executes(c -> run(ExportController.Mode.SAVE, StringArgumentType.getString(c, "name")))))
            .then(literal("clear").executes(VmCommands::clear)));
    }

    private static com.mojang.brigadier.builder.LiteralArgumentBuilder<FabricClientCommandSource> corner(String name, int which) {
        return literal(name)
            .executes(c -> {
                MinecraftClient client = c.getSource().getClient();
                BlockPos p = targetedOrFeet(client);
                if (p == null) {
                    Chat.error(client, "Look at a block or stand somewhere first.");
                    return 0;
                }
                return set(client, which, p);
            })
            .then(argument("x", IntegerArgumentType.integer())
                .then(argument("y", IntegerArgumentType.integer())
                    .then(argument("z", IntegerArgumentType.integer())
                        .executes(c -> set(c.getSource().getClient(), which, new BlockPos(
                            IntegerArgumentType.getInteger(c, "x"), IntegerArgumentType.getInteger(c, "y"), IntegerArgumentType.getInteger(c, "z")))))));
    }

    /** The block under the crosshair, else the player's feet. */
    public static BlockPos targetedOrFeet(MinecraftClient client) {
        if (client.crosshairTarget instanceof BlockHitResult hit && hit.getType() == HitResult.Type.BLOCK) return hit.getBlockPos();
        return client.player == null ? null : client.player.getBlockPos();
    }

    public static int set(MinecraftClient client, int which, BlockPos p) {
        if (which == 1) SelectionManager.setPos1(p);
        else SelectionManager.setPos2(p);
        String size = SelectionManager.selection().map(s -> " Selection: " + s.describe() + ".").orElse("");
        Chat.info(client, "Corner " + which + " set to " + p.getX() + ", " + p.getY() + ", " + p.getZ() + "." + size);
        return Command.SINGLE_SUCCESS;
    }

    private static int run(ExportController.Mode mode, String name) {
        ExportController.start(MinecraftClient.getInstance(), mode, name);
        return Command.SINGLE_SUCCESS;
    }

    private static int clear(CommandContext<FabricClientCommandSource> c) {
        MinecraftClient client = c.getSource().getClient();
        ExportController.cancel(client);
        SelectionManager.clear();
        Chat.info(client, "Selection cleared.");
        return Command.SINGLE_SUCCESS;
    }

    private static int help(CommandContext<FabricClientCommandSource> c) {
        MinecraftClient client = c.getSource().getClient();
        Chat.info(client, "[ and ] set corners at the block you look at. Commands: /vm pos1|pos2 [x y z], /vm export [title], /vm save [name], /vm clear");
        return Command.SINGLE_SUCCESS;
    }
}
