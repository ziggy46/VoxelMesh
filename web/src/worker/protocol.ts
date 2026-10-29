// Worker bus (docs/05 §3). The worker is single-threaded and synchronous, so "cancel" means "drop the result":
// the client ignores any result whose sequence number is stale.
import type { FilamentSlotBucket } from "../types/color";
import type { ColorBucketMesh, ManifoldReport, MeshingOptions } from "../types/mesh";
import type { VoxelPayload } from "../types/voxelPayload";
import type { Stage } from "./pipeline";

export interface RunRequest {
  seq: number;
  /** Preview runs supersede older queued previews; export runs (e.g. the mono STL run) and the game-look run queue separately. */
  kind: "preview" | "export" | "game";
  options: MeshingOptions;
  maxSlots: number;
  overrides: Array<[number, number]>;
}

export interface RunResult {
  seq: number;
  meshes: ColorBucketMesh[];
  buckets: FilamentSlotBucket[];
  paletteToBucket: Uint16Array;
  reports: ManifoldReport[];
  repair: { bridgesAdded: number; recolored: number } | null;
  reliefCarved: number | null;
  reliefSkipped: { wanted: number; limit: number } | null;
  reliefUsedDepth: number | null;
  faceBuckets: Map<number, Uint16Array>;
  faceCells: number | null;
  facesSkipped: { wanted: number; limit: number } | null;
  modelBuckets: Map<number, Array<[number, string]>>;
  modelBlocks: number;
  entityBuckets: Map<number, number>;
  entityCells: number | null;
  entitiesSkipped: { wanted: number; limit: number } | null;
  timings: Record<Stage, number>;
}

export type ToWorker =
  | { type: "load"; payload: VoxelPayload }
  | ({ type: "run" } & RunRequest)
  | { type: "cancel"; seq: number };

export type FromWorker =
  | { type: "progress"; seq: number; stage: Stage; fraction: number }
  | ({ type: "result" } & RunResult)
  | { type: "error"; seq: number; message: string };
