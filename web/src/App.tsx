import { useEffect } from "react";
import { ExportToolbar } from "./components/ExportToolbar";
import { FilamentSlotMapper } from "./components/FilamentSlotMapper";
import { PrinterModePanel } from "./components/PrinterModePanel";
import { Viewport3D } from "./components/Viewport3D";
import { usePrintStore } from "./store/usePrintStore";
import { bootstrap } from "./ui/bootstrap";

export default function App() {
  const sourceName = usePrintStore((s) => s.sourceName);
  const status = usePrintStore((s) => s.status);
  const timings = usePrintStore((s) => s.timings);

  useEffect(() => {
    void bootstrap();
  }, []);

  const total = timings ? Object.values(timings).reduce((a, b) => a + b, 0) : 0;
  return (
    <div className="flex min-h-full flex-col lg:h-full">
      <header className="flex items-center gap-3 border-b border-line bg-panel px-4 py-2">
        <h1 className="text-sm font-semibold tracking-wide"><span className="text-accent">Voxel</span>Mesh</h1>
        <span className="text-xs text-muted">{sourceName ?? "No build loaded"}</span>
        <span className="ml-auto text-xs text-muted" aria-live="polite">
          {status === "running" && "Meshing…"}
          {status === "ready" && `Done in ${(total / 1000).toFixed(1)} s · processed in your browser, nothing uploaded`}
        </span>
      </header>
      <div className="grid min-h-0 flex-1 grid-cols-1 lg:grid-cols-[300px_minmax(0,1fr)_340px]">
        <PrinterModePanel />
        <main className="order-first min-h-0 lg:order-none"><Viewport3D /></main>
        <aside aria-label="Slots and export" className="overflow-y-auto border-line bg-panel lg:border-l">
          <FilamentSlotMapper />
          <ExportToolbar />
        </aside>
      </div>
    </div>
  );
}
