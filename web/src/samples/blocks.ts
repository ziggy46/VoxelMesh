// Shared palette entries for fixtures and the sample castle.
import type { PaletteEntry, SubVoxelBox } from "../types/voxelPayload";
import { BRICKS, COBBLE, DIRT, PLANKS } from "./relief";

const FULL: SubVoxelBox = [0, 0, 0, 16, 16, 16];

function block(id: string, name: string, color: string, category: PaletteEntry["category"], boxes: SubVoxelBox[]): PaletteEntry {
  return { id, name, color, category, boxes };
}

const solid = (id: string, name: string, color: string, relief?: string): PaletteEntry => ({
  ...block(id, name, color, "solid", [FULL]),
  ...(relief ? { relief } : {}),
});

export const B = {
  stone: solid("minecraft:stone_bricks", "Stone Bricks", "#7A797A", BRICKS),
  cobble: solid("minecraft:cobblestone", "Cobblestone", "#6E6E6E", COBBLE),
  planks: solid("minecraft:oak_planks", "Oak Planks", "#A27F49", PLANKS),
  red: solid("minecraft:red_wool", "Red Wool", "#A12722"),
  blue: solid("minecraft:blue_wool", "Blue Wool", "#35399D"),
  grass: solid("minecraft:grass_block", "Grass Block", "#5E9A38", DIRT),
  dirt: solid("minecraft:dirt", "Dirt", "#866043", DIRT),
  gold: solid("minecraft:gold_block", "Block of Gold", "#F9D43E"),

  stoneSlab: block("minecraft:stone_brick_slab[type=bottom]", "Stone Brick Slab", "#7A797A", "partial", [[0, 0, 0, 16, 8, 16]]),
  oakSlab: block("minecraft:oak_slab[type=bottom]", "Oak Slab", "#A27F49", "partial", [[0, 0, 0, 16, 8, 16]]),

  // Stairs named by the side the raised step is on (+z = south in MC).
  stairHiS: block("minecraft:red_nether_brick_stairs[facing=north]", "Red Stairs (high S)", "#6B1E1E", "partial", [[0, 0, 0, 16, 8, 16], [0, 8, 8, 16, 16, 16]]),
  stairHiN: block("minecraft:red_nether_brick_stairs[facing=south]", "Red Stairs (high N)", "#6B1E1E", "partial", [[0, 0, 0, 16, 8, 16], [0, 8, 0, 16, 16, 8]]),
  stairHiE: block("minecraft:red_nether_brick_stairs[facing=west]", "Red Stairs (high E)", "#6B1E1E", "partial", [[0, 0, 0, 16, 8, 16], [8, 8, 0, 16, 16, 16]]),
  stairHiW: block("minecraft:red_nether_brick_stairs[facing=east]", "Red Stairs (high W)", "#6B1E1E", "partial", [[0, 0, 0, 16, 8, 16], [0, 8, 0, 8, 16, 16]]),

  fence: block("minecraft:spruce_fence", "Spruce Fence", "#6B5330", "thin", [[6, 0, 6, 10, 16, 10]]),
  chain: block("minecraft:iron_chain", "Chain", "#4A4F5E", "thin", [[7, 0, 7, 9, 16, 9]]),
  bars: block("minecraft:iron_bars", "Iron Bars", "#9AA0A5", "thin", [[7, 0, 0, 9, 16, 16]]),
  lantern: block("minecraft:lantern", "Lantern", "#C8A04A", "partial", [[5, 0, 5, 11, 7, 11], [6, 7, 6, 10, 9, 10]]),

  water: block("minecraft:water", "Water", "#3F76E4", "fluid", [[0, 0, 0, 16, 14, 16]]),
  poppy: block("minecraft:poppy", "Poppy", "#C41E1E", "foliage", [[4, 0, 4, 12, 10, 12]]),
} as const;
