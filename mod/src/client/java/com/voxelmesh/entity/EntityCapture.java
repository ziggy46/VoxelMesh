package com.voxelmesh.entity;

import com.voxelmesh.VoxelMeshClientMod;
import com.voxelmesh.core.BoxMerger;
import com.voxelmesh.core.EntityRecord;
import com.voxelmesh.core.EntityVoxelizer;
import com.voxelmesh.core.Selection;
import java.util.ArrayList;
import java.util.Comparator;
import java.util.List;
import net.minecraft.client.MinecraftClient;
import net.minecraft.client.render.entity.EntityRenderDispatcher;
import net.minecraft.client.util.math.MatrixStack;
import net.minecraft.client.world.ClientWorld;
import net.minecraft.entity.AreaEffectCloudEntity;
import net.minecraft.entity.Entity;
import net.minecraft.entity.ExperienceOrbEntity;
import net.minecraft.entity.LightningEntity;
import net.minecraft.entity.decoration.DisplayEntity;
import net.minecraft.entity.player.PlayerEntity;
import net.minecraft.entity.projectile.FishingBobberEntity;
import net.minecraft.registry.Registries;
import net.minecraft.util.math.Box;

/**
 * Captures the entities in a selection (armor stands, item frames, paintings, mobs, boats, modded entities) by asking the game
 * to render each one into a recorder instead of the screen, then voxelizing what it drew. Whatever the renderer draws is what
 * is captured, so it follows resource packs and modded entities, but a pose is frozen at capture time and textures that
 * exist only on the GPU (player skins, maps) are skipped. Players are never captured. Main thread only.
 */
public final class EntityCapture {
    /** Upper bounds that keep one capture from freezing the game or bloating the payload. */
    public static final int MAX_ENTITIES = 400;
    private static final long MAX_CELLS_PER_ENTITY = 4_000_000;
    private static final long MAX_TOTAL_BOXES = 150_000;

    public record Result(List<EntityRecord> entities, int found, int skipped) {
        static final Result NONE = new Result(List.of(), 0, 0);
    }

    private EntityCapture() {}

    private static boolean wanted(Entity e) {
        return !e.isRemoved()
            && !(e instanceof PlayerEntity)
            && !(e instanceof ExperienceOrbEntity)
            && !(e instanceof AreaEffectCloudEntity)
            && !(e instanceof FishingBobberEntity)
            && !(e instanceof LightningEntity)
            && !(e instanceof DisplayEntity.TextDisplayEntity);
    }

    public static Result capture(MinecraftClient client, ClientWorld world, Selection sel) {
        Box box = new Box(sel.x1, sel.y1, sel.z1, sel.x2 + 1, sel.y2 + 1, sel.z2 + 1);
        List<Entity> found = new ArrayList<>(world.getEntitiesByClass(Entity.class, box, EntityCapture::wanted));
        if (found.isEmpty()) return Result.NONE;
        // A stable order keeps the payload the same for the same scene.
        found.sort(Comparator.comparing((Entity e) -> Registries.ENTITY_TYPE.getId(e.getType()).toString())
            .thenComparingDouble(Entity::getY).thenComparingDouble(Entity::getX).thenComparingDouble(Entity::getZ));

        EntityRenderDispatcher dispatcher = client.getEntityRenderDispatcher();
        boolean shadows = client.options.getEntityShadows().getValue();
        dispatcher.setRenderShadows(false);
        List<EntityRecord> out = new ArrayList<>();
        int skipped = 0;
        long boxes = 0;
        try {
            EntityTextures textures = new EntityTextures();
            for (Entity e : found) {
                if (out.size() >= MAX_ENTITIES || boxes >= MAX_TOTAL_BOXES) {
                    skipped++;
                    continue;
                }
                EntityRecord r = one(dispatcher, textures, e, sel);
                if (r == null) {
                    skipped++;
                    continue;
                }
                out.add(r);
                boxes += r.boxes().size();
            }
        } finally {
            dispatcher.setRenderShadows(shadows);
        }
        return new Result(out, found.size(), skipped);
    }

    private static EntityRecord one(EntityRenderDispatcher dispatcher, EntityTextures textures, Entity e, Selection sel) {
        try {
            CaptureProvider provider = new CaptureProvider(textures);
            // Rendering at (position - origin) puts every recorded vertex in selection-relative blocks.
            dispatcher.render(e, e.getX() - sel.x1, e.getY() - sel.y1, e.getZ() - sel.z1, e.getYaw(), 1.0f, new MatrixStack(), provider, 0xF000F0);
            java.util.List<EntityVoxelizer.Tri> tris = provider.finish();
            VoxelMeshClientMod.LOGGER.debug("entity {}: {} triangles from layers {}", Registries.ENTITY_TYPE.getId(e.getType()), tris.size(), provider.layerSummary());
            EntityVoxelizer.Grid grid = EntityVoxelizer.voxelize(tris, MAX_CELLS_PER_ENTITY);
            if (grid == null) return null;
            return BoxMerger.merge(Registries.ENTITY_TYPE.getId(e.getType()).toString(), grid, sel.sizeX() * 16, sel.sizeY() * 16, sel.sizeZ() * 16);
        } catch (RuntimeException | LinkageError ex) {
            VoxelMeshClientMod.LOGGER.warn("Could not capture {}: {}", Registries.ENTITY_TYPE.getId(e.getType()), ex.toString());
            return null;
        }
    }
}
