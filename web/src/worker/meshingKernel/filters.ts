// One place that decides whether a palette entry is part of the print. The grid, the relief stage and the colour-count step
// all use it, so a filtered block can never claim a filament slot or be carved while being absent from the model.
import type { MeshingOptions } from "../../types/mesh";
import type { PaletteEntry } from "../../types/voxelPayload";

export function isIncluded(e: PaletteEntry, o: MeshingOptions): boolean {
  if (e.category === "air") return false;
  if (e.category === "fluid" && !o.includeFluids) return false;
  if (e.category === "foliage" && !o.includeFoliage) return false;
  // Glass and leaves are on by default (undefined counts as included), so older callers and payloads behave as before.
  if (o.includeGlass === false && e.tags?.includes("glass")) return false;
  if (o.includeLeaves === false && e.tags?.includes("leaves")) return false;
  return true;
}
