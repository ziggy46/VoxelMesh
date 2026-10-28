package com.voxelmesh.mixin;

import net.minecraft.client.render.RenderLayer;
import org.spongepowered.asm.mixin.Mixin;
import org.spongepowered.asm.mixin.gen.Invoker;

/** Reads which texture a render layer draws with (entity capture). `MultiPhase` is package-private, hence the string target. */
@Mixin(targets = "net.minecraft.client.render.RenderLayer$MultiPhase")
public interface MultiPhaseAccessor {
    @Invoker("getPhases")
    RenderLayer.MultiPhaseParameters voxelmesh$phases();
}
