import { useEffect, useState, type DragEvent } from "react";
import { ExportToolbar } from "./components/ExportToolbar";
import { FilamentSlotMapper } from "./components/FilamentSlotMapper";
import { PrinterModePanel } from "./components/PrinterModePanel";
import { Viewport3D } from "./components/Viewport3D";
import { usePrintStore } from "./store/usePrintStore";
import { bootstrap } from "./ui/bootstrap";
import { loadFile } from "./ui/files";
import { IconUpload } from "./ui/kit";

/** Isometric cube mark: three faces, one emerald gradient. */
function Mark() {
  return (
    <svg viewBox="0 0 32 32" width="34" height="34" aria-hidden="true">
      <defs>
        <linearGradient id="mk-top" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stopColor="#8af2c9" /><stop offset="1" stopColor="#34d399" /></linearGradient>
        <linearGradient id="mk-left" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stopColor="#10b981" /><stop offset="1" stopColor="#047857" /></linearGradient>
        <linearGradient id="mk-right" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stopColor="#059669" /><stop offset="1" stopColor="#064e3b" /></linearGradient>
      </defs>
      <path d="M16 3 28 9.8 16 16.6 4 9.8 16 3Z" fill="url(#mk-top)" />
      <path d="M4 9.8 16 16.6V29L4 22.2V9.8Z" fill="url(#mk-left)" />
      <path d="M28 9.8 16 16.6V29l12-6.8V9.8Z" fill="url(#mk-right)" />
    </svg>
  );
}

export default function App() {
  const sourceName = usePrintStore((s) => s.sourceName);
  const status = usePrintStore((s) => s.status);
  const timings = usePrintStore((s) => s.timings);
  const [dragging, setDragging] = useState(false);

  useEffect(() => {
    void bootstrap();
  }, []);

  const total = timings ? Object.values(timings).reduce((a, b) => a + b, 0) : 0;
  const onDragOver = (e: DragEvent) => {
    if (!e.dataTransfer.types.includes("Files")) return;
    e.preventDefault();
    setDragging(true);
  };
  const onDrop = (e: DragEvent) => {
    e.preventDefault();
    setDragging(false);
    void loadFile(e.dataTransfer.files[0]);
  };

  return (
    <div
      className="stage relative flex min-h-full flex-col gap-3 p-3 lg:block lg:h-full lg:overflow-hidden lg:p-0"
      onDragOver={onDragOver}
      onDragLeave={(e) => { if (e.currentTarget === e.target) setDragging(false); }}
      onDrop={onDrop}
    >
      <main className="relative order-first h-[62vh] min-h-[360px] overflow-hidden rounded-[22px] lg:absolute lg:inset-0 lg:h-auto lg:min-h-0 lg:rounded-none">
        <Viewport3D />
      </main>

      <aside aria-label="Import and print settings" className="glass rise flex min-h-0 flex-col overflow-hidden lg:absolute lg:bottom-4 lg:left-4 lg:top-4 lg:w-[316px] xl:w-[340px]">
        <header className="flex items-center gap-3 border-b border-line px-5 py-4">
          <Mark />
          <div className="min-w-0">
            <h1 className="text-[17px] font-semibold leading-none tracking-tight">VoxelMesh</h1>
            <p className="mt-1 truncate text-xs text-muted" aria-live="polite">
              {status === "running" ? "Meshing…" : status === "ready" ? `${sourceName ?? "Build"} · meshed in ${(total / 1000).toFixed(1)} s` : "Minecraft builds, print-ready"}
            </p>
          </div>
        </header>
        <div className="min-h-0 flex-1 overflow-y-auto"><PrinterModePanel /></div>
      </aside>

      <aside aria-label="Slots and export" className="glass rise flex min-h-0 flex-col overflow-hidden lg:absolute lg:bottom-4 lg:right-4 lg:top-4 lg:w-[332px] xl:w-[356px]">
        <div className="min-h-0 flex-1 overflow-y-auto"><FilamentSlotMapper /></div>
        <ExportToolbar />
      </aside>

      {dragging && (
        <div className="pointer-events-none absolute inset-0 z-50 grid place-items-center bg-scene/70 backdrop-blur-sm">
          <div className="glass flex flex-col items-center gap-3 !rounded-[28px] border-accent/60 px-12 py-10 text-center shadow-[0_0_0_4px_rgba(52,211,153,0.18)]">
            <span className="grid h-14 w-14 place-items-center rounded-2xl bg-accent-soft text-accent"><IconUpload width={28} height={28} /></span>
            <p className="text-lg font-semibold">Drop to load your build</p>
            <p className="text-muted">.vxm.json or .vxm.json.gz</p>
          </div>
        </div>
      )}
    </div>
  );
}
