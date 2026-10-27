// Right sidebar, top: filament slot count, swatches with colour override, member lists with reassignment (docs/05 §2).
import { useId, useMemo, useState } from "react";
import { usePrintStore, type SlotCount } from "../store/usePrintStore";
import { SLOT_COUNTS, slotHex, slotMembers } from "../ui/derive";

const heading = "mb-2 text-[11px] font-semibold uppercase tracking-wider text-muted";

export function FilamentSlotMapper() {
  const { slotCount, setSlotCount, buckets, slotColors, setSlotColor, reassign, paletteToBucket, payload, counts, status } = usePrintStore();
  const [open, setOpen] = useState<number | null>(null);
  const idBase = useId();

  const members = useMemo(
    () => (paletteToBucket && payload && counts ? slotMembers(paletteToBucket, payload.palette, counts) : new Map()),
    [paletteToBucket, payload, counts],
  );
  const total = buckets.reduce((s, b) => s + (members.get(b.bucketId)?.reduce((n: number, m: { count: number }) => n + m.count, 0) ?? b.voxelCount), 0);

  return (
    <section aria-labelledby={`${idBase}-h`} className="p-4">
      <h2 id={`${idBase}-h`} className={heading}>Filament slots</h2>
      <div role="radiogroup" aria-label="Number of filament slots" className="mb-3 flex overflow-hidden rounded border border-line">
        {SLOT_COUNTS.map((n) => (
          <button key={n} type="button" role="radio" aria-checked={slotCount === n} onClick={() => setSlotCount(n as SlotCount)}
            className={`flex-1 px-2 py-1.5 text-xs font-medium ${slotCount === n ? "bg-accent text-accent-ink" : "text-ink hover:bg-panel-2"}`}>
            {n === 1 ? "1 (mono)" : n}
          </button>
        ))}
      </div>

      {buckets.length === 0 && <p className="text-xs text-muted">{status === "running" ? "Working out slots…" : "Slots appear once a build is loaded."}</p>}

      <ul className="space-y-1.5">
        {buckets.map((b) => {
          const hex = slotHex(b, slotColors);
          const list = members.get(b.bucketId) ?? [];
          const count = list.reduce((n: number, m: { count: number }) => n + m.count, 0);
          const isOpen = open === b.bucketId;
          const panelId = `${idBase}-slot-${b.bucketId}`;
          return (
            <li key={b.bucketId} className="rounded border border-line bg-panel-2">
              <div className="flex items-center gap-2 p-2">
                <label className="relative block h-7 w-7 shrink-0 cursor-pointer overflow-hidden rounded border border-line" style={{ background: hex }}>
                  <span className="sr-only">Colour for slot {b.bucketId}</span>
                  <input type="color" value={hex.toLowerCase()} onChange={(e) => setSlotColor(b.bucketId, e.target.value)} className="absolute inset-0 h-full w-full cursor-pointer opacity-0" />
                </label>
                <button type="button" aria-expanded={isOpen} aria-controls={panelId} onClick={() => setOpen(isOpen ? null : b.bucketId)} className="min-w-0 flex-1 text-left">
                  <span className="block truncate font-medium">Slot {b.bucketId}</span>
                  <span className="block truncate text-xs text-muted">{list.length} block type{list.length === 1 ? "" : "s"} · {total > 0 ? ((count / total) * 100).toFixed(0) : 0}% · <span className="font-mono">{hex}</span></span>
                </button>
                {slotColors[b.bucketId] && (
                  <button type="button" onClick={() => setSlotColor(b.bucketId, null)} className="rounded px-2 py-1 text-xs text-muted hover:text-ink" title="Reset to the computed colour">Reset</button>
                )}
                <span aria-hidden="true" className="text-muted">{isOpen ? "▾" : "▸"}</span>
              </div>
              {isOpen && (
                <ul id={panelId} className="space-y-1 border-t border-line p-2">
                  {list.map((m: { paletteIndex: number; name: string; color: string; count: number }) => (
                    <li key={m.paletteIndex} className="flex items-center gap-2 text-xs">
                      <span aria-hidden="true" className="h-3 w-3 shrink-0 rounded-sm border border-line" style={{ background: m.color }} />
                      <span className="min-w-0 flex-1 truncate">{m.name}</span>
                      <span className="font-mono text-muted">{m.count}</span>
                      <select aria-label={`Move ${m.name} to slot`} value={b.bucketId} onChange={(e) => reassign(m.paletteIndex, Number(e.target.value))}
                        className="rounded border border-line bg-panel px-1 py-0.5">
                        {buckets.map((o) => <option key={o.bucketId} value={o.bucketId}>Slot {o.bucketId}</option>)}
                      </select>
                    </li>
                  ))}
                </ul>
              )}
            </li>
          );
        })}
      </ul>
    </section>
  );
}
