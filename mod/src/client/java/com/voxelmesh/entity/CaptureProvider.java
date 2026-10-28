package com.voxelmesh.entity;

import com.voxelmesh.core.EntityVoxelizer;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import net.minecraft.client.render.RenderLayer;
import net.minecraft.client.render.VertexConsumer;
import net.minecraft.client.render.VertexConsumerProvider;
import net.minecraft.client.render.VertexFormat;

/**
 * Stands in for the game's vertex buffers while one entity is "rendered": instead of drawing, it records every textured quad
 * or triangle the renderer emits (body, armor, held items, paintings, modded entities alike) in cells relative to the origin
 * the entity was rendered at. Layers that are effects rather than geometry are ignored.
 */
final class CaptureProvider implements VertexConsumerProvider {
    /** Layers whose names mark them as effects or overlays that would only duplicate or pollute the model. */
    private static final String[] SKIP = {"glint", "eyes", "energy_swirl", "outline", "lines", "text", "crumbling", "shadow", "beacon", "lightning", "leash", "portal", "gateway"};

    private static final VertexConsumer DISCARD = new VertexConsumer() {
        @Override public VertexConsumer vertex(float x, float y, float z) { return this; }
        @Override public VertexConsumer color(int r, int g, int b, int a) { return this; }
        @Override public VertexConsumer texture(float u, float v) { return this; }
        @Override public VertexConsumer overlay(int u, int v) { return this; }
        @Override public VertexConsumer light(int u, int v) { return this; }
        @Override public VertexConsumer normal(float x, float y, float z) { return this; }
    };

    private final EntityTextures textures;
    private final Map<RenderLayer, Recorder> perLayer = new HashMap<>();
    private final List<EntityVoxelizer.Tri> tris = new ArrayList<>();

    CaptureProvider(EntityTextures textures) {
        this.textures = textures;
    }

    @Override
    public VertexConsumer getBuffer(RenderLayer layer) {
        Recorder r = perLayer.computeIfAbsent(layer, this::recorderFor);
        return r == null ? DISCARD : r;
    }

    private Recorder recorderFor(RenderLayer layer) {
        VertexFormat.DrawMode mode = layer.getDrawMode();
        int per = mode == VertexFormat.DrawMode.QUADS ? 4 : mode == VertexFormat.DrawMode.TRIANGLES ? 3 : 0;
        if (per == 0) return null;
        String name = layer.toString().toLowerCase();
        for (String s : SKIP) if (name.contains(s)) return null;
        EntityTextures.Resolved tex = textures.resolve(layer);
        return tex == null ? null : new Recorder(per, tex.tex(), tris);
    }

    /** The recorded triangles; call once the renderer is finished. */
    List<EntityVoxelizer.Tri> finish() {
        for (Recorder r : perLayer.values()) if (r != null) r.flush();
        return tris;
    }

    /** One layer's vertex stream. Attributes arrive after their vertex, so a primitive is complete when the next one starts. */
    private static final class Recorder implements VertexConsumer {
        private final int per;
        private final EntityVoxelizer.Texture tex;
        private final List<EntityVoxelizer.Tri> out;
        private final float[] pos = new float[12], uv = new float[8], nrm = new float[12];
        private final int[] rgb = new int[4];
        private boolean[] hasNormal = new boolean[4];
        private int n;

        Recorder(int per, EntityVoxelizer.Texture tex, List<EntityVoxelizer.Tri> out) {
            this.per = per;
            this.tex = tex;
            this.out = out;
        }

        @Override
        public VertexConsumer vertex(float x, float y, float z) {
            if (n == per) emit();
            pos[3 * n] = x * 16;
            pos[3 * n + 1] = y * 16;
            pos[3 * n + 2] = z * 16;
            rgb[n] = 0xFFFFFF;
            hasNormal[n] = false;
            n++;
            return this;
        }

        @Override public VertexConsumer color(int r, int g, int b, int a) { if (n > 0) rgb[n - 1] = (r & 0xFF) << 16 | (g & 0xFF) << 8 | (b & 0xFF); return this; }
        @Override public VertexConsumer texture(float u, float v) { if (n > 0) { uv[2 * (n - 1)] = u; uv[2 * (n - 1) + 1] = v; } return this; }
        @Override public VertexConsumer overlay(int u, int v) { return this; }
        @Override public VertexConsumer light(int u, int v) { return this; }
        @Override public VertexConsumer normal(float x, float y, float z) {
            if (n > 0) {
                nrm[3 * (n - 1)] = x;
                nrm[3 * (n - 1) + 1] = y;
                nrm[3 * (n - 1) + 2] = z;
                hasNormal[n - 1] = true;
            }
            return this;
        }

        void flush() {
            if (n == per) emit();
            n = 0;
        }

        private void emit() {
            n = 0;
            if (per == 4) {
                add(0, 1, 2);
                add(0, 2, 3);
            } else {
                add(0, 1, 2);
            }
        }

        private void add(int a, int b, int c) {
            float[] p = {pos[3 * a], pos[3 * a + 1], pos[3 * a + 2], pos[3 * b], pos[3 * b + 1], pos[3 * b + 2], pos[3 * c], pos[3 * c + 1], pos[3 * c + 2]};
            float[] t = {uv[2 * a], uv[2 * a + 1], uv[2 * b], uv[2 * b + 1], uv[2 * c], uv[2 * c + 1]};
            out.add(new EntityVoxelizer.Tri(p, t, new int[] {rgb[a], rgb[b], rgb[c]}, outward(p, a), tex));
        }

        /** The renderer's normal when it agrees with the triangle's plane, else the plane's own normal. */
        private float[] outward(float[] p, int vertex) {
            double ux = p[3] - p[0], uy = p[4] - p[1], uz = p[5] - p[2], vx = p[6] - p[0], vy = p[7] - p[1], vz = p[8] - p[2];
            double gx = uy * vz - uz * vy, gy = uz * vx - ux * vz, gz = ux * vy - uy * vx;
            double len = Math.sqrt(gx * gx + gy * gy + gz * gz);
            if (len < 1e-9) return null; // a sliver: leave it unshifted
            gx /= len; gy /= len; gz /= len;
            if (hasNormal[vertex]) {
                double d = nrm[3 * vertex] * gx + nrm[3 * vertex + 1] * gy + nrm[3 * vertex + 2] * gz;
                if (Math.abs(d) > 0.1) return d > 0 ? new float[] {(float) gx, (float) gy, (float) gz} : new float[] {(float) -gx, (float) -gy, (float) -gz};
            }
            return new float[] {(float) gx, (float) gy, (float) gz};
        }
    }
}
