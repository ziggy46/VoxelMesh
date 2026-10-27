package com.voxelmesh;

import com.voxelmesh.command.VmCommands;
import com.voxelmesh.payload.ExportController;
import com.voxelmesh.render.SelectionBoxRenderer;
import com.voxelmesh.render.SelectionHud;
import net.fabricmc.api.ClientModInitializer;
import net.fabricmc.fabric.api.client.command.v2.ClientCommandRegistrationCallback;
import net.fabricmc.fabric.api.client.event.lifecycle.v1.ClientTickEvents;
import net.fabricmc.fabric.api.client.keybinding.v1.KeyBindingHelper;
import net.fabricmc.fabric.api.client.rendering.v1.HudRenderCallback;
import net.fabricmc.fabric.api.client.rendering.v1.WorldRenderEvents;
import net.minecraft.client.MinecraftClient;
import net.minecraft.client.option.KeyBinding;
import net.minecraft.client.util.InputUtil;
import net.minecraft.util.math.BlockPos;
import org.lwjgl.glfw.GLFW;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;

/** Client entrypoint: keybinds `[` and `]`, `/vm` commands, selection box, HUD, tick-sliced capture (docs/02). */
public final class VoxelMeshClientMod implements ClientModInitializer {
    public static final String MOD_ID = "voxelmesh";
    public static final Logger LOGGER = LoggerFactory.getLogger(MOD_ID);

    private static final String CATEGORY = "key.categories.voxelmesh";

    @Override
    public void onInitializeClient() {
        KeyBinding pos1 = KeyBindingHelper.registerKeyBinding(
            new KeyBinding("key.voxelmesh.pos1", InputUtil.Type.KEYSYM, GLFW.GLFW_KEY_LEFT_BRACKET, CATEGORY));
        KeyBinding pos2 = KeyBindingHelper.registerKeyBinding(
            new KeyBinding("key.voxelmesh.pos2", InputUtil.Type.KEYSYM, GLFW.GLFW_KEY_RIGHT_BRACKET, CATEGORY));

        ClientTickEvents.END_CLIENT_TICK.register(client -> {
            while (pos1.wasPressed()) corner(client, 1);
            while (pos2.wasPressed()) corner(client, 2);
            ExportController.tick(client);
        });
        ClientCommandRegistrationCallback.EVENT.register((dispatcher, registryAccess) -> VmCommands.register(dispatcher));
        WorldRenderEvents.LAST.register(SelectionBoxRenderer::render);
        HudRenderCallback.EVENT.register(SelectionHud::render);
        LOGGER.info("VoxelMesh client mod loaded: [ and ] set corners, /vm export sends the build to the local app");
    }

    private static void corner(MinecraftClient client, int which) {
        if (client.world == null) return;
        BlockPos p = VmCommands.targetedOrFeet(client);
        if (p == null) return;
        VmCommands.set(client, which, p);
    }
}
