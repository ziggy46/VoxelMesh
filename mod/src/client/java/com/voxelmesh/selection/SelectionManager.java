package com.voxelmesh.selection;

import com.voxelmesh.core.Selection;
import java.util.Optional;
import net.minecraft.util.math.BlockPos;

/** The two selected corners. Client-thread only. */
public final class SelectionManager {
    private static BlockPos pos1;
    private static BlockPos pos2;

    private SelectionManager() {}

    public static void setPos1(BlockPos p) { pos1 = p.toImmutable(); }
    public static void setPos2(BlockPos p) { pos2 = p.toImmutable(); }
    public static BlockPos pos1() { return pos1; }
    public static BlockPos pos2() { return pos2; }

    public static void clear() {
        pos1 = null;
        pos2 = null;
    }

    public static Optional<Selection> selection() {
        if (pos1 == null || pos2 == null) return Optional.empty();
        return Optional.of(new Selection(pos1.getX(), pos1.getY(), pos1.getZ(), pos2.getX(), pos2.getY(), pos2.getZ()));
    }
}
