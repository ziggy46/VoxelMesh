/// <reference lib="webworker" />
// Mesh worker: load(payload), run(options, overrides), cancel(). Newest run wins; stale results are dropped.
import type { VoxelPayload } from "../types/voxelPayload";
import { runPipeline } from "./pipeline";
import type { FromWorker, RunRequest, ToWorker } from "./protocol";

declare const self: DedicatedWorkerGlobalScope;

let payload: VoxelPayload | null = null;
const pending: Partial<Record<RunRequest["kind"], RunRequest>> = {};
let scheduled = false;
const cancelled = new Set<number>();

const post = (m: FromWorker, transfer: Transferable[] = []) => self.postMessage(m, transfer);

function runOne(req: RunRequest): void {
  if (!payload) return;
  try {
    const r = runPipeline(payload, req.options, {
      maxSlots: req.maxSlots,
      overrides: new Map(req.overrides),
      onProgress: (stage, fraction) => post({ type: "progress", seq: req.seq, stage, fraction }),
    });
    if (cancelled.delete(req.seq)) return;
    const transfer: Transferable[] = [];
    for (const m of r.meshes) transfer.push(m.positions.buffer, m.indices.buffer);
    post(
      {
        type: "result", seq: req.seq, meshes: r.meshes, buckets: r.quantization.buckets, paletteToBucket: r.paletteToBucket,
        reports: r.reports, repair: r.repair, reliefCarved: r.reliefCarved, reliefSkipped: r.reliefSkipped, reliefUsedDepth: r.reliefUsedDepth,
        faceBuckets: r.faceBuckets, faceCells: r.faceCells, facesSkipped: r.facesSkipped,
        modelBuckets: r.modelBuckets, modelBlocks: r.modelBlocks, entityBuckets: r.entityBuckets, entityCells: r.entityCells, entitiesSkipped: r.entitiesSkipped, detail: r.detail, timings: r.timings,
      },
      transfer,
    );
  } catch (e) {
    post({ type: "error", seq: req.seq, message: e instanceof Error ? e.message : String(e) });
  }
}

function process(): void {
  scheduled = false;
  const todo = [pending.export, pending.game, pending.preview];
  pending.export = undefined;
  pending.game = undefined;
  pending.preview = undefined;
  for (const req of todo) if (req) runOne(req);
}

self.onmessage = (ev: MessageEvent<ToWorker>) => {
  const m = ev.data;
  if (m.type === "load") {
    payload = m.payload;
  } else if (m.type === "cancel") {
    cancelled.add(m.seq);
  } else {
    // Only the newest queued run of each kind is executed; earlier ones that never started are dropped.
    const prev = pending[m.kind];
    if (prev) cancelled.delete(prev.seq);
    pending[m.kind] = { seq: m.seq, kind: m.kind, options: m.options, maxSlots: m.maxSlots, overrides: m.overrides };
    if (!scheduled) {
      scheduled = true;
      setTimeout(process, 0);
    }
  }
};
