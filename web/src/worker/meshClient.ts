// Main-thread wrapper around the mesh worker: promise-per-run with progress callbacks.
import type { VoxelPayload } from "../types/voxelPayload";
import type { Stage } from "./pipeline";
import type { FromWorker, RunRequest, RunResult, ToWorker } from "./protocol";

interface Waiter {
  resolve: (r: RunResult) => void;
  reject: (e: Error) => void;
  onProgress?: (stage: Stage, fraction: number) => void;
}

export class MeshClient {
  private readonly worker = new Worker(new URL("./meshWorker.ts", import.meta.url), { type: "module" });
  private readonly waiters = new Map<number, Waiter>();

  constructor() {
    this.worker.onmessage = (ev: MessageEvent<FromWorker>) => {
      const m = ev.data;
      const w = this.waiters.get(m.seq);
      if (!w) return;
      if (m.type === "progress") w.onProgress?.(m.stage, m.fraction);
      else {
        this.waiters.delete(m.seq);
        if (m.type === "result") w.resolve(m);
        else w.reject(new Error(m.message));
      }
    };
    this.worker.onerror = (ev) => {
      const err = new Error(ev.message || "mesh worker crashed");
      for (const w of this.waiters.values()) w.reject(err);
      this.waiters.clear();
    };
  }

  private send(m: ToWorker): void {
    this.worker.postMessage(m);
  }

  load(payload: VoxelPayload): void {
    this.send({ type: "load", payload });
  }

  run(req: RunRequest, onProgress?: Waiter["onProgress"]): Promise<RunResult> {
    return new Promise<RunResult>((resolve, reject) => {
      this.waiters.set(req.seq, { resolve, reject, onProgress });
      this.send({ type: "run", ...req });
    });
  }

  cancel(seq: number): void {
    this.waiters.delete(seq);
    this.send({ type: "cancel", seq });
  }

  terminate(): void {
    this.worker.terminate();
  }
}
