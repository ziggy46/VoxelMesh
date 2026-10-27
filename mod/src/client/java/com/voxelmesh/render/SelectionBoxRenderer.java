package com.voxelmesh.render;

import com.voxelmesh.core.Selection;
import com.voxelmesh.selection.SelectionManager;
import java.util.Optional;
import net.fabricmc.fabric.api.client.rendering.v1.WorldRenderContext;
import net.minecraft.client.render.RenderLayer;
import net.minecraft.client.render.VertexConsumer;
import net.minecraft.client.render.VertexConsumerProvider;
import net.minecraft.client.render.WorldRenderer;
import net.minecraft.client.render.debug.DebugRenderer;
import net.minecraft.client.util.math.MatrixStack;
import net.minecraft.util.math.Box;
import net.minecraft.util.math.Vec3d;

/** Cyan outline plus a faint fill over [min, max+1] (docs/02 §2). Called from WorldRenderEvents.LAST. */
public final class SelectionBoxRenderer {
    private SelectionBoxRenderer() {}

    public static void render(WorldRenderContext ctx) {
        Optional<Selection> sel = SelectionManager.selection();
        VertexConsumerProvider consumers = ctx.consumers();
        if (sel.isEmpty() || consumers == null) return;
        Selection s = sel.get();
        Box box = new Box(s.x1, s.y1, s.z1, s.x2 + 1, s.y2 + 1, s.z2 + 1);
        Vec3d cam = ctx.camera().getPos();
        MatrixStack m = ctx.matrixStack();
        m.push();
        m.translate(-cam.x, -cam.y, -cam.z);
        VertexConsumer lines = consumers.getBuffer(RenderLayer.getLines());
        WorldRenderer.drawBox(m, lines, box, 0.1f, 0.9f, 1.0f, 1.0f);
        DebugRenderer.drawBox(m, consumers, box, 0.1f, 0.8f, 1.0f, 0.12f);
        m.pop();
        // LAST runs after the world's own flush, so push our two layers out ourselves.
        if (consumers instanceof VertexConsumerProvider.Immediate imm) {
            imm.draw(RenderLayer.getDebugFilledBox());
            imm.draw(RenderLayer.getLines());
        }
    }
}
