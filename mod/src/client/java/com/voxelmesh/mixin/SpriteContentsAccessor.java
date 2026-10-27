package com.voxelmesh.mixin;

import net.minecraft.client.texture.NativeImage;
import net.minecraft.client.texture.SpriteContents;
import org.spongepowered.asm.mixin.Mixin;
import org.spongepowered.asm.mixin.gen.Accessor;

/** Reads the first-frame pixels of a block sprite; `image` is private in 1.21.1 (docs/02 §4.2). Accessor, never reflection. */
@Mixin(SpriteContents.class)
public interface SpriteContentsAccessor {
    @Accessor("image")
    NativeImage voxelmesh$getImage();
}
