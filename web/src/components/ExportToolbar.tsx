// Right sidebar, bottom: telemetry and validator-gated export (docs/05 §2). Never a silent bad export (CLAUDE.md §1).
import { useMemo, useState } from "react";
import { generateBinarySTL, generateMultiColor3MF } from "../exporters/slicerExporters";
import { usePrintStore } from "../store/usePrintStore";
import type { ExportBucket } from "../types/color";
import type { ColorBucketMesh } from "../types/mesh";
import { estimate, safeFileName, slotHex, slotName, totalIssues } from "../ui/derive";
import { validateAll } from "../validate/manifold";

const heading = "mb-2 text-[11px] font-semibold uppercase tracking-wider text-muted";

function save(data: Blob | ArrayBuffer, name: string): void {
  const blob = data instanceof Blob ? data : new Blob([data], { type: "model/stl" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}

type Kind = "3mf" | "stl";
interface Pending { kind: Kind; issues: number; stl?: ColorBucketMesh[] }

export function ExportToolbar() {
  const { meshes, buckets, reports, options, slotColors, payload, status, slotCount, runMono } = usePrintStore();
  const [busy, setBusy] = useState<Kind | null>(null);
  const [pending, setPending] = useState<Pending | null>(null);
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);

  const ready = status === "ready" && meshes.length > 0;
  const issues = totalIssues(reports);
  const verts = meshes.reduce((n, m) => n + m.positions.length / 3, 0);
  const tris = reports.reduce((n, r) => n + r.triangles, 0);
  const est = estimate(reports, options.scaleMmPerBlock);
  const title = payload?.metadata.title ?? "VoxelMesh";

  const exportBuckets = useMemo<ExportBucket[]>(() => {
    const byId = new Map(buckets.map((b) => [b.bucketId, b]));
    return meshes.flatMap((m) => {
      const b = byId.get(m.bucketId);
      if (!b) return [];
      const hex = slotHex(b, slotColors);
      return [{ bucketId: m.bucketId, name: slotName(b, hex), hexColor: hex, mesh: m }];
    });
  }, [meshes, buckets, slotColors]);

  const finish = (ok: boolean, text: string) => {
    setBusy(null);
    setPending(null);
    setMessage({ ok, text });
  };

  const do3mf = async (skipValidation: boolean) => {
    setBusy("3mf");
    try {
      const blob = await generateMultiColor3MF(exportBuckets, title, options.scaleMmPerBlock, { skipValidation });
      save(blob, `${safeFileName(title)}.3mf`);
      finish(true, `Exported ${safeFileName(title)}.3mf (${(blob.size / 1024).toFixed(0)} KB).`);
    } catch (e) {
      finish(false, e instanceof Error ? e.message : String(e));
    }
  };

  const doStl = async (confirmedMeshes?: ColorBucketMesh[]) => {
    setBusy("stl");
    try {
      // Single material: re-run with every colour in one slot so internal colour boundaries disappear (docs/04 §3).
      const mono = confirmedMeshes ?? (slotCount === 1 || buckets.length <= 1 ? meshes : await runMono());
      if (!confirmedMeshes) {
        const n = totalIssues(validateAll(mono));
        if (n > 0) {
          setBusy(null);
          setPending({ kind: "stl", issues: n, stl: mono });
          return;
        }
      }
      const out: ExportBucket[] = mono.map((m) => ({ bucketId: m.bucketId, name: "Model", hexColor: "#808080", mesh: m }));
      const buf = generateBinarySTL(out, options.scaleMmPerBlock);
      save(buf, `${safeFileName(title)}.stl`);
      finish(true, `Exported ${safeFileName(title)}.stl (${(buf.byteLength / 1024).toFixed(0)} KB).`);
    } catch (e) {
      finish(false, e instanceof Error ? e.message : String(e));
    }
  };

  const click = (kind: Kind) => {
    setMessage(null);
    if (kind === "3mf") {
      if (issues > 0) setPending({ kind, issues });
      else void do3mf(false);
    } else void doStl();
  };

  return (
    <section aria-labelledby="exp-h" className="border-t border-line p-4">
      <h2 id="exp-h" className={heading}>Model and export</h2>

      <dl className="mb-3 grid grid-cols-2 gap-x-3 gap-y-1 text-xs">
        <dt className="text-muted">Vertices</dt><dd className="text-right font-mono">{ready ? verts.toLocaleString() : "–"}</dd>
        <dt className="text-muted">Triangles</dt><dd className="text-right font-mono">{ready ? tris.toLocaleString() : "–"}</dd>
        <dt className="text-muted">Volume</dt><dd className="text-right font-mono">{ready ? `${est.volumeCm3.toFixed(1)} cm³` : "–"}</dd>
        <dt className="text-muted">PLA (solid)</dt><dd className="text-right font-mono">{ready ? `${est.grams.toFixed(0)} g` : "–"}</dd>
      </dl>

      <div role="status" className={`mb-3 rounded border px-3 py-2 text-xs ${!ready ? "border-line text-muted" : issues === 0 ? "border-ok text-ok" : "border-bad text-bad"}`}>
        {!ready && <span>Manifold check pending</span>}
        {ready && issues === 0 && <span><span aria-hidden="true">✓ </span>Watertight: every bucket is a closed manifold</span>}
        {ready && issues > 0 && (
          <span>
            <span aria-hidden="true">✕ </span>{issues} manifold problem{issues === 1 ? "" : "s"}:{" "}
            {reports.filter((r) => !r.ok).map((r) => `slot ${r.bucketId} (open ${r.openEdges}, non-manifold ${r.nonManifoldEdges}, degenerate ${r.degenerateTriangles}${r.signedVolume > 0 ? "" : ", bad volume"})`).join("; ")}
          </span>
        )}
      </div>

      <div className="grid gap-2">
        <button type="button" disabled={!ready || busy !== null} onClick={() => click("3mf")}
          className="rounded bg-accent px-3 py-2 font-medium text-accent-ink hover:brightness-110 disabled:cursor-not-allowed disabled:opacity-40">
          {busy === "3mf" ? "Building .3MF…" : issues > 0 && ready ? `Download multi-colour .3MF (${issues} problem${issues === 1 ? "" : "s"})` : "Download multi-colour .3MF"}
        </button>
        <button type="button" disabled={!ready || busy !== null} onClick={() => click("stl")}
          className="rounded border border-line bg-panel-2 px-3 py-2 font-medium hover:border-accent disabled:cursor-not-allowed disabled:opacity-40">
          {busy === "stl" ? "Building .STL…" : "Download binary .STL (single colour)"}
        </button>
      </div>

      {pending && (
        <div role="alertdialog" aria-label="Export with validation errors" className="mt-3 rounded border border-bad bg-panel-2 p-3 text-xs">
          <p className="mb-2"><strong className="text-bad">{pending.issues} validation problem{pending.issues === 1 ? "" : "s"}.</strong> The slicer may report open edges or need repair. Export anyway?</p>
          <div className="flex gap-2">
            <button type="button" autoFocus onClick={() => (pending.kind === "3mf" ? void do3mf(true) : void doStl(pending.stl))} className="rounded bg-bad px-3 py-1.5 font-medium text-accent-ink">Export anyway</button>
            <button type="button" onClick={() => setPending(null)} className="rounded border border-line px-3 py-1.5">Cancel</button>
          </div>
        </div>
      )}
      <p aria-live="polite" className={`mt-3 text-xs ${message ? (message.ok ? "text-ok" : "text-bad") : "sr-only"}`}>{message?.text}</p>
    </section>
  );
}
