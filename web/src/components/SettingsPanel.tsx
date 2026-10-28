// Left panel content: source, printer target, scale, filters, surface relief (docs/05 §2).
import { useId, useRef, useState } from "react";
import { SAMPLES } from "../samples";
import { usePrintStore } from "../store/usePrintStore";
import { loadFile } from "../ui/files";
import { BED_MAX_MM, BED_MIN_MM, BED_PRESETS, MIN_WALL_MAX_MM, NOZZLE_MM, RELIEF_DEPTH, SCALE_MAX, SCALE_MIN, bedFor, bedLabel, clampBedMm, fitsBed, fmtSize, hasReliefData, minSubVoxels, modelSizeMm, reliefTooFine, texelMm, type BedPreset, type UiOptions } from "../ui/derive";
import { IconChevron, IconFile, IconFilter, IconLayers, IconPlate, IconPrinter, IconRuler, IconUpload, Notice, Section, SwitchRow } from "../ui/kit";

export function SettingsPanel() {
  const { options, setOptions, payload, sourceName, loading, loadError, warnings, loadSample, reliefSkipped, reliefCarved, reliefUsedDepth } = usePrintStore();
  const fileInput = useRef<HTMLInputElement>(null);
  const sampleId = useId();
  const scaleId = useId();
  const [sample, setSample] = useState(SAMPLES[0]!.id);

  const bed = bedFor(options);
  const size = payload ? modelSizeMm(payload, options.scaleMmPerBlock) : null;
  const fits = size ? fitsBed(size, bed) : true;
  const hasRelief = hasReliefData(payload);
  const texel = texelMm(options.scaleMmPerBlock);
  const fineForNozzle = reliefTooFine(texel, options.minWallMm);
  const wallId = useId();
  const reliefOn = options.reliefDepth > 0;
  const set = <K extends keyof UiOptions>(k: K, v: UiOptions[K]) => setOptions({ [k]: v } as Partial<UiOptions>);

  return (
    <>
      <Section icon={<IconUpload width={16} height={16} />} title="Source">
        <button type="button" onClick={() => fileInput.current?.click()}
          className="ctl flex w-full items-center gap-3 border-dashed px-3.5 py-3 text-left">
          <IconFile className="flex-none text-accent" />
          <span className="min-w-0 flex-1">
            <span className="block font-medium text-ink">Choose a build file</span>
            <span className="block text-xs text-muted">or drop a <span className="font-mono">.vxm.json.gz</span> anywhere</span>
          </span>
        </button>
        <input ref={fileInput} type="file" accept=".json,.gz,.vxm" className="sr-only" tabIndex={-1} aria-label="Choose a build file"
          onChange={(e) => { void loadFile(e.target.files?.[0]); e.target.value = ""; }} />

        <div className="mt-3 flex items-end gap-2">
          <div className="min-w-0 flex-1">
            <label htmlFor={sampleId} className="mb-1 block text-xs text-muted">Or open a sample</label>
            <div className="relative">
              <select id={sampleId} value={sample} onChange={(e) => setSample(e.target.value)} className="ctl w-full py-2 pl-3 pr-8 text-ink">
                {SAMPLES.map((s) => <option key={s.id} value={s.id} className="bg-[#10161d]">{s.name}</option>)}
              </select>
              <IconChevron width={14} height={14} className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 rotate-90 text-muted" />
            </div>
          </div>
          <button type="button" onClick={() => loadSample(sample)} className="btn-primary px-4 py-2">Open</button>
        </div>
        <p className="mt-1.5 text-xs leading-snug text-muted">{SAMPLES.find((s) => s.id === sample)?.description}</p>

        <div aria-live="polite">
          {loading && <Notice tone="muted">Reading file…</Notice>}
          {payload && !loading && <Notice tone="ok"><span className="text-ink">{sourceName}</span> loaded: {payload.dimensions.join(" × ")} blocks</Notice>}
          {loadError && <div role="alert"><Notice tone="bad">{loadError}</Notice></div>}
          {warnings.map((w) => <Notice key={w} tone="warn">{w}</Notice>)}
        </div>
      </Section>

      <Section icon={<IconPlate width={16} height={16} />} title="Build plate">
        <div role="radiogroup" aria-label="Build plate size" className="grid grid-cols-3 gap-2">
          {BED_PRESETS.map((b, i) => (
            <button key={i} type="button" role="radio" aria-checked={options.bedPreset === i} onClick={() => set("bedPreset", i as BedPreset)} className="tile num px-1 py-2.5 text-center font-mono text-[12px] text-ink">
              {b.x} × {b.y}
            </button>
          ))}
          <button type="button" role="radio" aria-checked={options.bedPreset === "custom"} onClick={() => set("bedPreset", "custom")} className="tile col-span-3 px-3 py-2.5 text-[13px] font-medium text-ink">
            Custom size
          </button>
        </div>
        {options.bedPreset === "custom" && <CustomBed bed={options.customBed} onChange={(b) => set("customBed", b)} />}
        <p className="num mt-2 font-mono text-xs text-muted" aria-live="polite">{bedLabel(bed)}</p>
      </Section>

      <Section icon={<IconRuler width={16} height={16} />} title="Scale" aside={<span className="num font-mono">{options.scaleMmPerBlock.toFixed(1)} mm / block</span>}>
        <input id={scaleId} type="range" min={SCALE_MIN} max={SCALE_MAX} step={0.5} value={options.scaleMmPerBlock}
          aria-label="Millimetres per block" onChange={(e) => set("scaleMmPerBlock", Number(e.target.value))} />
        <p className="num mt-1 font-mono text-[13px] text-ink" aria-live="polite">{size ? fmtSize(size) : "No build loaded"}</p>
        {size && fits && <p className="text-xs text-muted">Fits the {bedLabel(bed)} plate</p>}
        {!fits && <Notice tone="warn">Larger than the {bedLabel(bed)} plate. Lower the scale or split the model.</Notice>}
      </Section>

      <Section icon={<IconPrinter width={16} height={16} />} title="Printability"
        aside={<span className="num font-mono">{options.minWallMm > 0 ? `${options.minWallMm.toFixed(1)} mm wall` : "Off"}</span>}>
        <label htmlFor={wallId} className="block font-medium text-ink">Thicken thin parts</label>
        <input id={wallId} type="range" min={0} max={MIN_WALL_MAX_MM} step={0.1} value={options.minWallMm}
          aria-label="Minimum wall thickness in millimetres" onChange={(e) => set("minWallMm", Math.round(Number(e.target.value) * 10) / 10)} />
        <p className="text-xs leading-snug text-muted" aria-live="polite">
          {options.minWallMm > 0
            ? `Parts thinner than ${options.minWallMm.toFixed(1)} mm are thickened to it (${minSubVoxels(options.minWallMm, options.scaleMmPerBlock)} sub-voxels at this scale). About 0.8 mm suits FDM; 0.2 to 0.3 mm suits fine resin.`
            : `Every detail is kept exactly as built. Parts finer than your nozzle may not print on FDM.`}
        </p>
        <div className="mt-2">
          <SwitchRow label="Fill hollow interiors" hint="Fills sealed cavities solid. Turn off to keep a hollow model hollow."
            checked={options.solidifyInteriors} onChange={(v) => set("solidifyInteriors", v)} />
        </div>
      </Section>

      <Section icon={<IconFilter width={16} height={16} />} title="Filters">
        <SwitchRow label="Include fluids" hint="Water and lava become solid slabs" checked={options.includeFluids} onChange={(v) => set("includeFluids", v)} />
        <SwitchRow label="Include foliage" hint="Flowers and crops as small stylised boxes" checked={options.includeFoliage} onChange={(v) => set("includeFoliage", v)} />
        <SwitchRow label="Fix non-manifold edges" hint="Adds or recolours single sub-voxels where parts only touch at an edge" checked={options.fixNonManifold} onChange={(v) => set("fixNonManifold", v)} />
      </Section>

      <Section icon={<IconLayers width={16} height={16} />} title="Surface relief">
        <SwitchRow label="Carve the textures" hint={hasRelief ? "Turns each block texture into a depth map: darker areas sit deeper" : "This build has no texture data. Re-export it with the updated mod."}
          checked={reliefOn} disabled={!hasRelief} onChange={(v) => set("reliefDepth", v ? RELIEF_DEPTH : 0)} />
        {reliefOn && hasRelief && (
          <SwitchRow label="Invert" hint="Carve the light areas instead of the dark ones" checked={options.reliefInvert} onChange={(v) => set("reliefInvert", v)} />
        )}
        <p className="num mt-1 font-mono text-xs text-muted" aria-live="polite">1 texel = {texel.toFixed(2)} mm{reliefOn ? ` · depth ${(texel * RELIEF_DEPTH).toFixed(2)} mm` : ""}</p>
        {hasRelief && reliefOn && fineForNozzle && <Notice tone="warn">Finer than a {NOZZLE_MM} mm nozzle, so it will barely show on FDM. Use at least {(NOZZLE_MM * 16).toFixed(1)} mm per block.</Notice>}
        {reliefSkipped && reliefOn && (
          <Notice tone="warn">Relief skipped: it would carve {reliefSkipped.wanted.toLocaleString()} texels (limit {reliefSkipped.limit.toLocaleString()}) and make the mesh too heavy. Use a smaller selection or turn relief off.</Notice>
        )}
        {reliefCarved !== null && reliefOn && (
          <Notice tone="muted">Carved {reliefCarved.toLocaleString()} texels{reliefUsedDepth !== null && reliefUsedDepth < options.reliefDepth ? `, reduced to ${reliefUsedDepth} deep to keep the mesh manageable` : ""}.</Notice>
        )}
      </Section>
    </>
  );
}

/** Width and depth in mm. Keeps what the user is typing while it is incomplete and commits only valid values. */
function CustomBed({ bed, onChange }: { bed: { x: number; y: number }; onChange: (b: { x: number; y: number }) => void }) {
  const [text, setText] = useState({ x: String(bed.x), y: String(bed.y) });
  const idX = useId();
  const idY = useId();
  const commit = (axis: "x" | "y", raw: string) => {
    setText((t) => ({ ...t, [axis]: raw }));
    const n = Number(raw);
    if (raw.trim() !== "" && Number.isFinite(n) && n >= BED_MIN_MM && n <= BED_MAX_MM) onChange({ ...bed, [axis]: Math.round(n) });
  };
  const settle = (axis: "x" | "y") => {
    const v = clampBedMm(Number(text[axis]));
    setText((t) => ({ ...t, [axis]: String(v) }));
    onChange({ ...bed, [axis]: v });
  };
  const field = (axis: "x" | "y", id: string, label: string) => (
    <div className="min-w-0 flex-1">
      <label htmlFor={id} className="mb-1 block text-xs text-muted">{label}</label>
      <div className="ctl flex items-center gap-1 px-3 py-2 focus-within:border-accent">
        <input id={id} type="number" inputMode="numeric" min={BED_MIN_MM} max={BED_MAX_MM} step={1} value={text[axis]}
          onChange={(e) => commit(axis, e.target.value)} onBlur={() => settle(axis)}
          className="num min-w-0 flex-1 bg-transparent font-mono text-[13px] text-ink outline-none [appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none" />
        <span className="text-xs text-muted">mm</span>
      </div>
    </div>
  );
  return (
    <div className="mt-3">
      <div className="flex items-end gap-2">
        {field("x", idX, "Width")}
        <span className="pb-2.5 text-muted" aria-hidden="true">×</span>
        {field("y", idY, "Depth")}
      </div>
      <p className="mt-1.5 text-xs text-muted">{BED_MIN_MM} to {BED_MAX_MM} mm per side</p>
    </div>
  );
}
