package com.voxelmesh.mixin;

import java.util.Map;
import net.minecraft.client.texture.Sprite;
import net.minecraft.client.texture.SpriteAtlasTexture;
import net.minecraft.util.Identifier;
import org.spongepowered.asm.mixin.Mixin;
import org.spongepowered.asm.mixin.gen.Accessor;

/** Lists an atlas's sprites so a texture coordinate can be mapped back to the sprite it came from (entity capture). */
@Mixin(SpriteAtlasTexture.class)
public interface SpriteAtlasAccessor {
    @Accessor("sprites")
    Map<Identifier, Sprite> voxelmesh$sprites();
}
