package com.voxelmesh.payload;

import com.voxelmesh.core.Category;
import com.voxelmesh.core.ColorMath;
import com.voxelmesh.core.Limits;
import com.voxelmesh.core.PaletteEntry;
import com.voxelmesh.core.PayloadWriter;
import com.voxelmesh.core.Selection;
import com.voxelmesh.util.BlockGeometryExtractor;
import java.time.Instant;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import net.minecraft.SharedConstants;
import net.minecraft.block.BlockState;
import net.minecraft.client.MinecraftClient;
import net.minecraft.client.world.ClientWorld;
import net.minecraft.command.argument.BlockArgumentParser;
import net.minecraft.util.math.BlockPos;

/**
 * Scans the selection in slices of N blocks per client tick so the game never freezes (docs/02 §3). Main thread only:
 * it reads the world. Blocks in unloaded chunks are recorded as air and counted.
 */
public final class PayloadBuilder {
    public record Result(PayloadWriter.Header header, int sx, int sy, int sz, List<PaletteEntry> palette, char[] voxels,
                         long unloadedBlocks, long nonAirBlocks) {}

    private record Key(BlockState state, int tint) {}

    private final ClientWorld world;
    private final Selection sel;
    private final String title;
    private final int slice;
    private final BlockGeometryExtractor extractor = new BlockGeometryExtractor();
    private final MinecraftClient client = MinecraftClient.getInstance();
    private final Map<Key, Integer> index = new HashMap<>();
    /** Block states that print identically share one palette entry (leaves differing only in `distance`, for example). */
    private final Map<String, Integer> byContent = new HashMap<>();
    private final List<PaletteEntry> palette = new ArrayList<>();
    private final char[] voxels;
    private final long total;
    private long cursor;
    private long unloaded;
    private long nonAir;
    private boolean cancelled;

    public PayloadBuilder(ClientWorld world, Selection sel, String title, int sliceBlocks) {
        if (Limits.check(sel.blocks()) == Limits.Verdict.REFUSE) throw new IllegalArgumentException("selection is too large");
        this.world = world;
        this.sel = sel;
        this.title = title;
        this.slice = Math.max(1, sliceBlocks);
        this.total = sel.blocks();
        this.voxels = new char[(int) total];
    }

    public void cancel() { cancelled = true; }
    public boolean cancelled() { return cancelled; }
    public double progress() { return total == 0 ? 1 : (double) cursor / total; }
    public boolean done() { return cursor >= total; }

    /** Scan up to one slice. @return true when the whole selection has been scanned. */
    public boolean step() {
        int sx = sel.sizeX(), sz = sel.sizeZ();
        long end = Math.min(total, cursor + slice);
        BlockPos.Mutable pos = new BlockPos.Mutable();
        for (; cursor < end; cursor++) {
            int x = (int) (cursor % sx);
            int z = (int) ((cursor / sx) % sz);
            int y = (int) (cursor / ((long) sx * sz));
            int wx = sel.x1 + x, wy = sel.y1 + y, wz = sel.z1 + z;
            if (!world.isChunkLoaded(wx >> 4, wz >> 4)) {
                unloaded++;
                continue;
            }
            pos.set(wx, wy, wz);
            BlockState state = world.getBlockState(pos);
            if (state.isAir()) continue;
            BlockGeometryExtractor.StateInfo info = extractor.infoFor(state, world, pos);
            if (info == null) continue;
            int tint = client.getBlockColors().getColor(state, world, pos, 0);
            Key key = new Key(state, tint);
            Integer idx = index.get(key);
            if (idx == null) {
                PaletteEntry entry = entryFor(state, info, tint);
                idx = byContent.get(entry.contentKey());
                if (idx == null) {
                    if (palette.size() + 1 >= Limits.MAX_PALETTE_ENTRIES) throw new IllegalStateException("too many distinct blocks (palette full)");
                    palette.add(entry);
                    idx = palette.size(); // index 0 is air
                    byContent.put(entry.contentKey(), idx);
                }
                index.put(key, idx);
            }
            voxels[(int) cursor] = (char) (int) idx;
            nonAir++;
        }
        return done();
    }

    private PaletteEntry entryFor(BlockState state, BlockGeometryExtractor.StateInfo info, int tint) {
        int rgb = tint == -1 ? info.rgb() : ColorMath.tint(info.rgb(), tint);
        // The web app only reads colour and boxes, never the id; the tint suffix just keeps ids unique.
        String id = BlockArgumentParser.stringifyBlockState(state) + (tint == -1 ? "" : "#tint=" + ColorMath.hex(tint).substring(1));
        String name = state.getBlock().getName().getString();
        return new PaletteEntry(id, name, ColorMath.hex(rgb), info.category() == null ? Category.PARTIAL : info.category(), info.boxes(), info.relief(), info.tags());
    }

    public Result result() {
        if (!done()) throw new IllegalStateException("scan not finished");
        PayloadWriter.Header header = new PayloadWriter.Header(
            title, SharedConstants.getGameVersion().getName(), Instant.now().toString(), sel.x1, sel.y1, sel.z1);
        return new Result(header, sel.sizeX(), sel.sizeY(), sel.sizeZ(), List.copyOf(palette), voxels, unloaded, nonAir);
    }
}
