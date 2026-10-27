// docs/00 §4 performance budgets (worker kernels only; run on a desktop CPU). Memory is recorded by hand in BUILD_STATUS.
import { describe, expect, it } from "vitest";
import { runMeshingPipeline } from "../../worker/meshingKernel";
import { validateAll } from "../../validate/manifold";
import { fixtureBucketMap, generateTerrain } from "../../samples/fixtures";
import { DEFAULT_FDM_OPTIONS, DEFAULT_RESIN_OPTIONS } from "../../types/mesh";

function timed(n: number, o: typeof DEFAULT_FDM_OPTIONS) {
  const f = generateTerrain(n);
  const map = fixtureBucketMap(f.payload, f.buckets);
  const t0 = performance.now();
  const meshes = runMeshingPipeline(f.payload, o, map);
  const reports = validateAll(meshes);
  const ms = performance.now() - t0;
  console.log(`[perf] ${n}^3 ${o.printerMode}: ${ms.toFixed(0)} ms, ${meshes.reduce((s, m) => s + m.indices.length / 3, 0)} triangles`);
  return { ms, reports };
}

// The budgets are for a desktop CPU (docs/00 §4). Shared CI runners are 2-3x slower, so they are skipped there and run locally.
const itLocal = process.env.CI ? it.skip : it;

describe("performance budgets", () => {
  itLocal("24^3 blocks FDM in < 3 s and valid", () => {
    const { ms, reports } = timed(24, DEFAULT_FDM_OPTIONS);
    expect(reports.every((r) => r.ok)).toBe(true);
    expect(ms).toBeLessThan(3000);
  }, 60000);

  itLocal("48^3 blocks Resin in < 12 s and valid", () => {
    const { ms, reports } = timed(48, DEFAULT_RESIN_OPTIONS);
    expect(reports.every((r) => r.ok)).toBe(true);
    expect(ms).toBeLessThan(12000);
  }, 120000);
});
