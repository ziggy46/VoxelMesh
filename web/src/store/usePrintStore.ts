// App state and the worker bus (docs/05 §3). Option changes are debounced 250 ms; a newer run supersedes an older one
// and stale results are dropped by sequence number.
import { create } from "zustand";
import { loadPayloadBytes, parsePayload, type LoadedPayload } from "../payload/loader";
import { SAMPLES } from "../samples";
import type { FilamentSlotBucket } from "../types/color";
import type { ColorBucketMesh, ManifoldReport } from "../types/mesh";
import type { VoxelPayload } from "../types/voxelPayload";
import { DEFAULT_UI_OPTIONS, needsRerun, toMeshingOptions, type UiOptions } from "../ui/derive";
import { MeshClient } from "../worker/meshClient";
import type { Stage } from "../worker/pipeline";

export type ViewMode = "shaded" | "wireframe" | "section";
export type SlotCount = 1 | 4 | 8 | 16;
export type Status = "idle" | "running" | "ready" | "error";

const DEBOUNCE_MS = 250;
const EXPORT_SEQ_BASE = 1_000_000_000;

interface PrintState {
  sourceName: string | null;
  payload: VoxelPayload | null;
  counts: Uint32Array | null;
  warnings: string[];
  loading: boolean;
  loadError: string | null;

  options: UiOptions;
  slotCount: SlotCount;
  /** Manual block -> slot reassignments (palette index -> bucket id). */
  overrides: Record<number, number>;
  /** Manual slot colour overrides (bucket id -> "#RRGGBB"); display and export only, no re-mesh. */
  slotColors: Record<number, string>;

  status: Status;
  progress: { stage: Stage; fraction: number } | null;
  error: string | null;
  meshes: ColorBucketMesh[];
  buckets: FilamentSlotBucket[];
  paletteToBucket: Uint16Array | null;
  reports: ManifoldReport[];
  repair: { bridgesAdded: number; recolored: number } | null;
  /** Surface relief outcome of the last run: cells carved, or why it was skipped. */
  reliefCarved: number | null;
  reliefSkipped: { wanted: number; limit: number } | null;
  reliefUsedDepth: number | null;
  /** Face-colour outcome of the last run: palette index -> face buckets, cells recoloured, or why skins were skipped. */
  faceBuckets: Map<number, Uint16Array>;
  faceCells: number | null;
  facesSkipped: { wanted: number; limit: number } | null;
  timings: Record<string, number> | null;

  viewMode: ViewMode;
  /** Section cut height in mm above the plate; null = no cut. */
  sectionMm: number | null;

  loadBytes: (name: string, bytes: Uint8Array) => Promise<void>;
  loadSample: (id: string) => void;
  setOptions: (patch: Partial<UiOptions>) => void;
  setSlotCount: (n: SlotCount) => void;
  reassign: (paletteIndex: number, bucket: number) => void;
  setSlotColor: (bucket: number, hex: string | null) => void;
  setViewMode: (m: ViewMode) => void;
  setSectionMm: (mm: number | null) => void;
  /** Re-run with every colour in one slot, for the single-material STL (docs/04 §3). */
  runMono: () => Promise<ColorBucketMesh[]>;
}

let client: MeshClient | null = null;
const getClient = (): MeshClient => (client ??= new MeshClient());
let seq = 0;
let exportSeq = EXPORT_SEQ_BASE;
let timer: ReturnType<typeof setTimeout> | null = null;

export const usePrintStore = create<PrintState>()((set, get) => {
  const run = () => {
    const s = get();
    if (!s.payload) return;
    const mySeq = ++seq;
    getClient().cancel(mySeq - 1);
    set({ status: "running", progress: { stage: "decode", fraction: 0 }, error: null });
    getClient()
      .run(
        { seq: mySeq, kind: "preview", options: toMeshingOptions(s.options), maxSlots: s.slotCount, overrides: Object.entries(s.overrides).map(([k, v]) => [Number(k), v]) },
        (stage, fraction) => {
          if (mySeq === seq) set({ progress: { stage, fraction } });
        },
      )
      .then((r) => {
        if (mySeq !== seq) return; // stale
        set({
          status: "ready", progress: null, meshes: r.meshes, buckets: r.buckets, paletteToBucket: r.paletteToBucket,
          reports: r.reports, repair: r.repair, reliefCarved: r.reliefCarved, reliefSkipped: r.reliefSkipped, reliefUsedDepth: r.reliefUsedDepth,
          faceBuckets: r.faceBuckets, faceCells: r.faceCells, facesSkipped: r.facesSkipped, timings: r.timings,
        });
      })
      .catch((e: unknown) => {
        if (mySeq === seq) set({ status: "error", progress: null, error: e instanceof Error ? e.message : String(e) });
      });
  };

  const schedule = (immediate = false) => {
    if (timer) clearTimeout(timer);
    timer = setTimeout(run, immediate ? 0 : DEBOUNCE_MS);
  };

  const install = (name: string, loaded: LoadedPayload) => {
    const counts = new Uint32Array(loaded.payload.palette.length);
    for (let i = 0; i < loaded.voxels.length; i++) counts[loaded.voxels[i]!]!++;
    getClient().load(loaded.payload);
    set({
      sourceName: name, payload: loaded.payload, counts, warnings: loaded.warnings, loading: false, loadError: null,
      overrides: {}, slotColors: {}, meshes: [], buckets: [], paletteToBucket: null, reports: [], repair: null, reliefCarved: null, reliefSkipped: null, reliefUsedDepth: null, faceBuckets: new Map(), faceCells: null, facesSkipped: null, timings: null,
      sectionMm: null,
    });
    schedule(true);
  };

  return {
    sourceName: null, payload: null, counts: null, warnings: [], loading: false, loadError: null,
    options: DEFAULT_UI_OPTIONS, slotCount: 4, overrides: {}, slotColors: {},
    status: "idle", progress: null, error: null, meshes: [], buckets: [], paletteToBucket: null, reports: [], repair: null, reliefCarved: null, reliefSkipped: null, reliefUsedDepth: null, faceBuckets: new Map(), faceCells: null, facesSkipped: null, timings: null,
    viewMode: "shaded", sectionMm: null,

    loadBytes: async (name, bytes) => {
      set({ loading: true, loadError: null });
      try {
        install(name, await loadPayloadBytes(bytes));
      } catch (e) {
        set({ loading: false, loadError: e instanceof Error ? e.message : String(e) });
      }
    },

    loadSample: (id) => {
      const sample = SAMPLES.find((x) => x.id === id);
      if (!sample) return;
      try {
        install(sample.name, parsePayload(sample.build()));
      } catch (e) {
        set({ loadError: e instanceof Error ? e.message : String(e) });
      }
    },

    setOptions: (patch) => {
      const prev = get().options;
      const next = { ...prev, ...patch };
      set({ options: next });
      if (needsRerun(prev, next)) schedule();
    },

    setSlotCount: (n) => {
      if (n === get().slotCount) return;
      set({ slotCount: n, overrides: {}, slotColors: {} });
      schedule();
    },

    reassign: (paletteIndex, bucket) => {
      set({ overrides: { ...get().overrides, [paletteIndex]: bucket } });
      schedule();
    },

    setSlotColor: (bucket, hex) => {
      const next = { ...get().slotColors };
      if (hex === null) delete next[bucket];
      else next[bucket] = hex.toUpperCase();
      set({ slotColors: next });
    },

    setViewMode: (m) => set({ viewMode: m }),
    setSectionMm: (mm) => set({ sectionMm: mm }),

    runMono: async () => {
      const s = get();
      if (!s.payload) throw new Error("no build loaded");
      const r = await getClient().run({ seq: ++exportSeq, kind: "export", options: toMeshingOptions(s.options), maxSlots: 1, overrides: [] });
      return r.meshes;
    },
  };
});
