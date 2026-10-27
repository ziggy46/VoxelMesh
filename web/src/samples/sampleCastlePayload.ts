// Sample castle (docs/06 §2 fixture 6): exercises every golden feature in one build.
// 24 x 16 x 24 blocks. Deterministic; no randomness.
import type { VoxelPayload } from "../types/voxelPayload";
import { B } from "./blocks";
import { PayloadBuilder } from "./builder";

export function buildSampleCastle(): VoxelPayload {
  const W = 24, H = 16, D = 24;
  const b = new PayloadBuilder("Sample Castle", [W, H, D]);

  // Ground, gate path and a pond (fluid: dropped unless includeFluids).
  b.fill(0, 0, 0, W, 1, D, B.grass);
  b.fill(11, 0, 15, 13, 1, D, B.cobble);
  b.fill(17, 0, 5, 20, 1, 8, B.water);

  // Curtain wall ring, x/z in [2,21], y 1..5.
  const onRing = (x: number, z: number) => x === 2 || x === 21 || z === 2 || z === 21;
  for (let y = 1; y <= 5; y++)
    for (let z = 2; z <= 21; z++)
      for (let x = 2; x <= 21; x++) if (onRing(x, z)) b.set(x, y, z, B.stone);

  // Gate in the south wall with chains and lanterns hanging from the lintel (y=4).
  b.fill(10, 1, 21, 14, 4, 22, null);
  for (const x of [10, 13]) {
    b.set(x, 3, 21, B.chain);
    b.set(x, 2, 21, B.lantern);
  }

  // Barred windows in the west/east walls (bars run along z).
  for (const z of [6, 11, 16]) {
    b.set(2, 3, z, B.bars);
    b.set(21, 3, z, B.bars);
  }

  // Wall walk: slabs at y=6, alternating merlons at y=7 (diagonal contacts at every corner).
  for (let z = 2; z <= 21; z++)
    for (let x = 2; x <= 21; x++)
      if (onRing(x, z)) {
        b.set(x, 6, z, B.stoneSlab);
        if ((x + z) % 2 === 0) b.set(x, 7, z, B.stone);
      }

  // Four corner towers: solid 5x5 box, hollowed to a 3x3 room (sealed unless a door is cut).
  for (const [tx, tz] of [[0, 0], [19, 0], [0, 19], [19, 19]] as const) {
    b.fill(tx, 1, tz, tx + 5, 11, tz + 5, B.cobble);
    b.fill(tx + 1, 2, tz + 1, tx + 4, 10, tz + 4, null);
    // Stair roof ring (raised step toward the middle) with a red-wool centre.
    for (let x = tx; x < tx + 5; x++) {
      b.set(x, 11, tz, B.stairHiS);
      b.set(x, 11, tz + 4, B.stairHiN);
    }
    for (let z = tz + 1; z < tz + 4; z++) {
      b.set(tx, 11, z, B.stairHiE);
      b.set(tx + 4, 11, z, B.stairHiW);
    }
    b.fill(tx + 1, 11, tz + 1, tx + 4, 12, tz + 4, B.red);
  }
  // Tower at (0,19) gets a door onto the courtyard, so its room is open rather than sealed.
  b.fill(3, 2, 19, 4, 4, 20, null);
  // Flags.
  b.fill(2, 12, 2, 3, 15, 3, B.fence);
  b.fill(3, 13, 2, 5, 15, 3, B.blue);
  b.fill(21, 12, 21, 22, 14, 22, B.fence);
  b.fill(22, 12, 21, 24, 14, 22, B.red);

  // Keep: stone box with a hollow room, planks roof, door facing the gate path.
  b.fill(8, 1, 8, 16, 9, 16, B.stone);
  b.fill(9, 2, 9, 15, 8, 15, null);
  b.fill(11, 2, 15, 13, 4, 16, null);
  for (const z of [11, 12]) {
    b.set(8, 4, z, B.bars);
    b.set(15, 4, z, B.bars);
  }
  b.fill(8, 9, 8, 16, 10, 16, B.planks);
  for (let z = 8; z < 16; z++)
    for (let x = 8; x < 16; x++) if (x === 8 || x === 15 || z === 8 || z === 15) b.set(x, 10, z, B.oakSlab);
  b.set(11, 10, 11, B.gold);
  b.set(12, 10, 12, B.lantern);

  // Courtyard dressing: fenced path with lanterns, flowers (foliage).
  for (let z = 16; z < 21; z++) {
    b.set(10, 1, z, B.fence);
    b.set(13, 1, z, B.fence);
  }
  b.set(10, 2, 16, B.lantern);
  b.set(13, 2, 16, B.lantern);
  b.set(5, 1, 8, B.poppy);
  b.set(6, 1, 8, B.poppy);
  b.set(18, 1, 14, B.poppy);
  b.set(5, 0, 12, B.dirt);

  return b.build();
}

export const sampleCastlePayload: VoxelPayload = buildSampleCastle();
