package com.voxelmesh.render;

import com.voxelmesh.core.Selection;
import com.voxelmesh.payload.ExportController;
import com.voxelmesh.selection.SelectionManager;
import java.util.Optional;
import net.minecraft.client.MinecraftClient;
import net.minecraft.client.gui.DrawContext;
import net.minecraft.client.render.RenderTickCounter;

/** Selection size and scan progress, top-left (docs/02 §2). */
public final class SelectionHud {
    private SelectionHud() {}

    public static void render(DrawContext ctx, RenderTickCounter tick) {
        MinecraftClient client = MinecraftClient.getInstance();
        if (client.options.hudHidden) return;
        int y = 6;
        String scan = ExportController.status();
        if (scan != null) {
            ctx.drawTextWithShadow(client.textRenderer, scan, 6, y, 0xFFFFAA00);
            y += 11;
        }
        Optional<Selection> sel = SelectionManager.selection();
        if (sel.isPresent()) {
            ctx.drawTextWithShadow(client.textRenderer, "VoxelMesh selection: " + sel.get().describe(), 6, y, 0xFF55FFFF);
        } else if (SelectionManager.pos1() != null || SelectionManager.pos2() != null) {
            ctx.drawTextWithShadow(client.textRenderer, "VoxelMesh: set the other corner", 6, y, 0xFF55FFFF);
        }
    }
}
