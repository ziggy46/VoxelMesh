// Left sidebar: source, printer target, scale, filters (docs/05 §2).
import { useId, useRef, useState, type DragEvent } from "react";
import { SAMPLES } from "../samples";
import { usePrintStore } from "../store/usePrintStore";
import { BEDS, SCALE_MAX, SCALE_MIN, fitsBed, fmtSize, modelSizeMm, type PrinterMode, type UiOptions } from "../ui/derive";

const heading = "mb-2 text-[11px] font-semibold uppercase tracking-wider text-muted";
const card = "rounded border border-line bg-panel-2 p-3";

function Check({ label, hint, checked, disabled, onChange }: { label: string; hint?: string; checked: boolean; disabled?: boolean; onChange: (v: boolean) => void }) {
  const id = useId();
  return (
    <div className={`flex items-start gap-2 py-1 ${disabled ? "opacity-60" : ""}`}>
      <input id={id} type="checkbox" className="mt-0.5 h-4 w-4" checked={checked} disabled={disabled} onChange={(e) => onChange(e.target.checked)} />
      <label htmlFor={id} className="flex-1">
        <span className="block">{label}</span>
        {hint && <span className="block text-xs text-muted">{hint}</span>}
      </label>
    </div>
  );
}

const TARGETS: Array<{ id: PrinterMode; title: string; detail: string }> = [
  { id: "fdm", title: "FDM multi-colour (0.4 mm)", detail: "0.8 mm minimum wall, fills sealed cavities" },
  { id: "resin", title: "Resin (MSLA)", detail: "Native detail, no fill, no thickening" },
];

export function PrinterModePanel() {
  const { options, setOptions, payload, sourceName, loading, loadError, warnings, loadBytes, loadSample } = usePrintStore();
  const [dragging, setDragging] = useState(false);
  const fileInput = useRef<HTMLInputElement>(null);
  const sampleId = useId();
  const scaleId = useId();
  const [sample, setSample] = useState(SAMPLES[0]!.id);

  const bed = BEDS[options.printerMode];
  const size = payload ? modelSizeMm(payload, options.scaleMmPerBlock) : null;
  const fits = size ? fitsBed(size, bed) : true;

  const readFile = async (f: File | undefined) => {
    if (f) await loadBytes(f.name.replace(/\.vxm(\.json)?(\.gz)?$/i, ""), new Uint8Array(await f.arrayBuffer()));
  };
  const onDrop = (e: DragEvent) => {
    e.preventDefault();
    setDragging(false);
    void readFile(e.dataTransfer.files[0]);
  };
  const set = <K extends keyof UiOptions>(k: K, v: UiOptions[K]) => setOptions({ [k]: v } as Partial<UiOptions>);

  return (
    <aside aria-label="Import and print settings" className="flex flex-col gap-5 overflow-y-auto border-line bg-panel p-4 lg:border-r">
      <section aria-labelledby="src-h">
        <h2 id="src-h" className={heading}>Source</h2>
        <div
          onDragOver={(e) => { e.preventDefault(); setDragging(true); }}
          onDragLeave={() => setDragging(false)}
          onDrop={onDrop}
          className={`rounded border border-dashed p-4 text-center ${dragging ? "border-accent bg-panel-2" : "border-line"}`}
        >
          <p className="mb-2 text-muted">Drop a <span className="font-mono">.vxm.json</span> or <span className="font-mono">.vxm.json.gz</span> here</p>
          <button type="button" onClick={() => fileInput.current?.click()} className="rounded border border-line bg-panel-2 px-3 py-1.5 hover:border-accent">
            Choose file…
          </button>
          <input ref={fileInput} type="file" accept=".json,.gz,.vxm" className="sr-only" tabIndex={-1} aria-label="Choose a build file"
            onChange={(e) => { void readFile(e.target.files?.[0]); e.target.value = ""; }} />
        </div>
        <div className="mt-3 flex items-end gap-2">
          <div className="flex-1">
            <label htmlFor={sampleId} className="mb-1 block text-xs text-muted">Sample</label>
            <select id={sampleId} value={sample} onChange={(e) => setSample(e.target.value)} className="w-full rounded border border-line bg-panel-2 px-2 py-1.5">
              {SAMPLES.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
            </select>
          </div>
          <button type="button" onClick={() => loadSample(sample)} className="rounded bg-accent px-3 py-1.5 font-medium text-accent-ink hover:brightness-110">Open</button>
        </div>
        <p className="mt-1 text-xs text-muted">{SAMPLES.find((s) => s.id === sample)?.description}</p>
        <div aria-live="polite" className="mt-2 space-y-1 text-xs">
          {loading && <p className="text-muted">Reading file…</p>}
          {payload && !loading && <p className="text-muted">Loaded <span className="text-ink">{sourceName}</span>: {payload.dimensions.join(" × ")} blocks</p>}
          {loadError && <p role="alert" className="text-bad"><span aria-hidden="true">✕ </span>{loadError}</p>}
          {warnings.map((w) => <p key={w} className="text-warn"><span aria-hidden="true">⚠ </span>{w}</p>)}
        </div>
      </section>

      <fieldset>
        <legend className={heading}>Printer target</legend>
        <div className="space-y-2">
          {TARGETS.map((t) => (
            <label key={t.id} className={`${card} flex cursor-pointer items-start gap-2 ${options.printerMode === t.id ? "border-accent" : ""}`}>
              <input type="radio" name="printer" className="mt-0.5 h-4 w-4" checked={options.printerMode === t.id} onChange={() => set("printerMode", t.id)} />
              <span><span className="block font-medium">{t.title}</span><span className="block text-xs text-muted">{t.detail}</span></span>
            </label>
          ))}
        </div>
      </fieldset>

      <section aria-labelledby="scale-h">
        <h2 id="scale-h" className={heading}>Scale</h2>
        <div className="flex items-center gap-3">
          <input id={scaleId} type="range" min={SCALE_MIN} max={SCALE_MAX} step={0.5} value={options.scaleMmPerBlock}
            aria-label="Millimetres per block" onChange={(e) => set("scaleMmPerBlock", Number(e.target.value))} className="min-w-0 flex-1" />
          <span className="whitespace-nowrap text-right font-mono text-xs">{options.scaleMmPerBlock.toFixed(1)} mm/blk</span>
        </div>
        <p className="mt-2 font-mono text-sm" aria-live="polite">{size ? fmtSize(size) : "No build loaded"}</p>
        <p className="text-xs text-muted">Plate: {bed.name}</p>
        {!fits && <p role="status" className="mt-1 text-xs text-warn"><span aria-hidden="true">⚠ </span>Larger than the plate. Lower the scale or split the model.</p>}
      </section>

      <fieldset>
        <legend className={heading}>Filters</legend>
        <Check label="Include fluids" hint="Water and lava become solid slabs" checked={options.includeFluids} onChange={(v) => set("includeFluids", v)} />
        <Check label="Include foliage" hint="Flowers and crops as small stylised boxes" checked={options.includeFoliage} onChange={(v) => set("includeFoliage", v)} />
        <Check label="Solidify interiors" hint={options.printerMode === "resin" ? "FDM only: Resin keeps native detail" : "Fill sealed cavities"}
          checked={options.printerMode === "fdm" && options.solidifyInteriors} disabled={options.printerMode === "resin"} onChange={(v) => set("solidifyInteriors", v)} />
        <Check label="Fix non-manifold edges" hint="Adds or recolours single sub-voxels where parts only touch at an edge" checked={options.fixNonManifold} onChange={(v) => set("fixNonManifold", v)} />
      </fieldset>
    </aside>
  );
}
