// Cross-language check: the Fabric mod's PayloadWriter output must load in the web app's validator.
// The file comes from `./gradlew test` in mod/ (PayloadWriterTest.writesInteropSample); skipped when it has not been built.
import { existsSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { loadPayloadBytes } from "../../payload/loader";
import { decodeFragmentData } from "../../ui/derive";

const FILE = "../mod/build/interop/sample.vxm.json.gz";

describe("Java payload interop", () => {
  it.skipIf(!existsSync(FILE))("loads a gzipped payload written by the Java PayloadWriter", async () => {
    const { payload, voxels, warnings } = await loadPayloadBytes(new Uint8Array(readFileSync(FILE)));
    expect(warnings).toEqual([]);
    expect(payload.dimensions).toEqual([4, 3, 5]);
    expect(payload.metadata).toMatchObject({ title: "Test", mcVersion: "1.21.1", origin: [10, 64, -5] });
    expect(payload.palette.map((p) => p.category)).toEqual(["air", "solid", "partial"]);
    expect(payload.palette[0]).toMatchObject({ id: "minecraft:air", color: null, boxes: [] });
    expect(payload.voxelsCrc32).toMatch(/^[0-9a-f]{8}$/);
    // index = x + z*sx + y*sx*sz, value = (x+y+z) % 3
    for (let y = 0; y < 3; y++)
      for (let z = 0; z < 5; z++)
        for (let x = 0; x < 4; x++) expect(voxels[x + z * 4 + y * 20]).toBe((x + y + z) % 3);
  });

  const LINK = "../mod/build/interop/link.txt";
  it.skipIf(!existsSync(LINK))("decodes the #data= link the mod emits for the hosted site", async () => {
    const hash = readFileSync(LINK, "utf8");
    expect(hash.startsWith("#data=")).toBe(true);
    const bytes = decodeFragmentData(hash);
    expect(bytes).not.toBeNull();
    const { payload, voxels } = await loadPayloadBytes(bytes!);
    expect(payload.metadata.title).toBe("Link");
    expect(payload.dimensions).toEqual([2, 2, 2]);
    expect(voxels[0]).toBe(1);
    expect(voxels[7]).toBe(2);
  });
});
