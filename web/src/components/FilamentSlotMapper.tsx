// Right panel, slots: count, swatches with colour override, member lists with reassignment (docs/05 §2).
import { useId, useMemo, useState } from "react";
import { usePrintStore, type SlotCount } from "../store/usePrintStore";
import { SLOT_COUNTS, slotHex, slotMembers } from "../ui/derive";
import { IconChevron, IconPalette, IconRotate, Section, Segmented } from "../ui/kit";

type Member = { paletteIndex: number; name: string; color: string; count: number; skin?: boolean };

export function FilamentSlotMapper() {
  const { slotCount, setSlotCount, buckets, slotColors, setSlotColor, reassign, paletteToBucket, payload, counts, status, faceBuckets, entityBuckets } = usePrintStore();
  const [open, setOpen] = useState<number | null>(null);
  const idBase = useId();

  const members = useMemo(
    () => (paletteToBucket && payload && counts ? slotMembers(paletteToBucket, payload.palette, counts, faceBuckets, entityBuckets) : new Map<number, Member[]>()),
    [paletteToBucket, payload, counts, faceBuckets, entityBuckets],
  );
  const total = buckets.reduce((s, b) => s + (members.get(b.bucketId)?.reduce((n, m) => n + m.count, 0) ?? b.voxelCount), 0);

  return (
    <Section icon={<IconPalette width={16} height={16} />} title="Filament slots">
      <Segmented<number> label="Number of filament slots" value={slotCount} onChange={(n) => setSlotCount(n as SlotCount)}
        options={SLOT_COUNTS.map((n) => ({ value: n, label: n === 1 ? "Mono" : String(n) }))} />

      {buckets.length === 0 && (
        <p className="mt-3 rounded-xl border border-dashed border-line px-3 py-4 text-center text-xs text-muted">
          {status === "running" ? "Working out slots…" : "Slots appear once a build is loaded."}
        </p>
      )}

      <ul className="mt-3 space-y-1.5">
        {buckets.map((b) => {
          const hex = slotHex(b, slotColors);
          const list = members.get(b.bucketId) ?? [];
          const count = list.reduce((n, m) => n + m.count, 0);
          const pct = total > 0 ? (count / total) * 100 : 0;
          const isOpen = open === b.bucketId;
          const panelId = `${idBase}-slot-${b.bucketId}`;
          return (
            <li key={b.bucketId} className="rounded-2xl border border-line bg-fill transition-colors hover:border-line-strong">
              <div className="flex items-center gap-3 p-2.5">
                <label className="relative block h-10 w-10 flex-none cursor-pointer overflow-hidden rounded-xl shadow-[inset_0_0_0_1px_rgba(255,255,255,0.22),0_4px_10px_-3px_rgba(0,0,0,0.6)] transition-transform hover:scale-105" style={{ background: hex }}>
                  <span className="sr-only">Colour for slot {b.bucketId}</span>
                  <input type="color" value={hex.toLowerCase()} onChange={(e) => setSlotColor(b.bucketId, e.target.value)} className="absolute inset-0 h-full w-full cursor-pointer opacity-0" />
                </label>
                <button type="button" aria-expanded={isOpen} aria-controls={panelId} onClick={() => setOpen(isOpen ? null : b.bucketId)} className="min-w-0 flex-1 text-left">
                  <span className="flex items-baseline gap-2">
                    <span className="font-semibold text-ink">Slot {b.bucketId}</span>
                    <span className="num font-mono text-xs text-muted">{hex}</span>
                  </span>
                  <span className="mt-0.5 block truncate text-xs text-muted">{list.length} block type{list.length === 1 ? "" : "s"} · <span className="num">{pct.toFixed(0)}%</span> of the model</span>
                  <span className="mt-1.5 block h-1 overflow-hidden rounded-full bg-white/10" aria-hidden="true">
                    <span className="block h-full rounded-full transition-[width] duration-500" style={{ width: `${Math.max(2, pct)}%`, background: hex }} />
                  </span>
                </button>
                {slotColors[b.bucketId] && (
                  <button type="button" onClick={() => setSlotColor(b.bucketId, null)} className="ctl grid h-8 w-8 flex-none place-items-center text-muted hover:text-ink" title="Reset to the computed colour" aria-label={`Reset slot ${b.bucketId} colour`}>
                    <IconRotate width={15} height={15} />
                  </button>
                )}
                <IconChevron width={16} height={16} className={`flex-none text-muted transition-transform duration-200 ${isOpen ? "rotate-90" : ""}`} />
              </div>
              {isOpen && (
                <ul id={panelId} className="space-y-1 border-t border-line px-3 py-2.5">
                  {list.map((m) => (
                    <li key={`${m.paletteIndex}${m.skin ? "s" : ""}`} className="flex items-center gap-2.5 text-xs">
                      <span aria-hidden="true" className="h-3.5 w-3.5 flex-none rounded-[5px] shadow-[inset_0_0_0_1px_rgba(255,255,255,0.25)]" style={{ background: m.color }} />
                      <span className="min-w-0 flex-1 truncate text-ink-2">{m.name}</span>
                      <span className="num font-mono text-muted">{m.count.toLocaleString()}</span>
                      {m.skin ? <span className="w-[5.5rem] flex-none text-right text-muted">own colour</span> : (<div className="relative">
                        <select aria-label={`Move ${m.name} to slot`} value={b.bucketId} onChange={(e) => reassign(m.paletteIndex, Number(e.target.value))} className="ctl py-1 pl-2 pr-6 text-xs text-ink">
                          {buckets.map((o) => <option key={o.bucketId} value={o.bucketId} className="bg-[#10161d]">Slot {o.bucketId}</option>)}
                        </select>
                        <IconChevron width={11} height={11} className="pointer-events-none absolute right-2 top-1/2 -translate-y-1/2 rotate-90 text-muted" />
                      </div>)}
                    </li>
                  ))}
                </ul>
              )}
            </li>
          );
        })}
      </ul>
    </Section>
  );
}
