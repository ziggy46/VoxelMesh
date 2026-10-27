// Build plate + per-bucket meshes (docs/05 §2). Lattice positions are scaled to mm here, on the main thread.
// The model group is rotated -90° about X so slicer Z-up maps to three.js Y-up: (x,y,z) -> (x, z, -y), a pure rotation.
import { OrbitControls } from "@react-three/drei";
import { Canvas } from "@react-three/fiber";
import { useEffect, useMemo, useRef, type ElementRef } from "react";
import * as THREE from "three";
import { usePrintStore, type ViewMode } from "../store/usePrintStore";
import { BEDS, slotHex, type Bed } from "../ui/derive";

const MODES: Array<{ id: ViewMode; label: string }> = [
  { id: "shaded", label: "Shaded" },
  { id: "wireframe", label: "Wireframe" },
  { id: "section", label: "Section cut" },
];

function plateLines(bed: Bed): Float32Array {
  const pts: number[] = [];
  for (let x = 0; x <= bed.x; x += 10) pts.push(x, 0, 0, x, bed.y, 0);
  for (let y = 0; y <= bed.y; y += 10) pts.push(0, y, 0, bed.x, y, 0);
  return Float32Array.from(pts);
}

function Plate({ bed }: { bed: Bed }) {
  const lines = useMemo(() => plateLines(bed), [bed]);
  return (
    <group>
      <mesh position={[bed.x / 2, bed.y / 2, -0.2]}>
        <planeGeometry args={[bed.x, bed.y]} />
        <meshStandardMaterial color="#1b1f24" roughness={1} />
      </mesh>
      <lineSegments position={[0, 0, 0.05]}>
        <bufferGeometry>
          <bufferAttribute attach="attributes-position" args={[lines, 3]} />
        </bufferGeometry>
        <lineBasicMaterial color="#323941" />
      </lineSegments>
      <lineSegments position={[0, 0, 0.06]}>
        <edgesGeometry args={[new THREE.PlaneGeometry(bed.x, bed.y).translate(bed.x / 2, bed.y / 2, 0)]} />
        <lineBasicMaterial color="#ffb020" />
      </lineSegments>
    </group>
  );
}

interface ModelProps {
  geometries: THREE.BufferGeometry[];
  colors: string[];
  offset: [number, number, number];
  mode: ViewMode;
  clipMm: number | null;
}

function Model({ geometries, colors, offset, mode, clipMm }: ModelProps) {
  const planes = useMemo(
    () => (clipMm === null ? [] : [new THREE.Plane(new THREE.Vector3(0, -1, 0), clipMm)]),
    [clipMm],
  );
  return (
    <group position={offset}>
      {geometries.map((g, i) => (
        <mesh key={i} geometry={g}>
          {mode === "wireframe" ? (
            // Unlit, so the greedy-merge triangles read clearly against the dark plate.
            <meshBasicMaterial color={colors[i]} wireframe />
          ) : (
            <meshStandardMaterial
              color={colors[i]}
              flatShading
              roughness={0.75}
              metalness={0}
              side={mode === "section" ? THREE.DoubleSide : THREE.FrontSide}
              clippingPlanes={planes}
            />
          )}
        </mesh>
      ))}
    </group>
  );
}

export function Viewport3D() {
  const meshes = usePrintStore((s) => s.meshes);
  const buckets = usePrintStore((s) => s.buckets);
  const slotColors = usePrintStore((s) => s.slotColors);
  const options = usePrintStore((s) => s.options);
  const mode = usePrintStore((s) => s.viewMode);
  const sectionMm = usePrintStore((s) => s.sectionMm);
  const status = usePrintStore((s) => s.status);
  const progress = usePrintStore((s) => s.progress);
  const error = usePrintStore((s) => s.error);
  const hasPayload = usePrintStore((s) => s.payload !== null);
  const setViewMode = usePrintStore((s) => s.setViewMode);
  const setSectionMm = usePrintStore((s) => s.setSectionMm);

  const bed = BEDS[options.printerMode];
  const reach = Math.max(Math.hypot(bed.x, bed.y), 300); // camera distance: far enough for either plate
  const k = options.scaleMmPerBlock / 16;

  const geometries = useMemo(
    () =>
      meshes.map((m) => {
        const pos = new Float32Array(m.positions.length);
        for (let i = 0; i < pos.length; i++) pos[i] = m.positions[i]! * k;
        const g = new THREE.BufferGeometry();
        g.setAttribute("position", new THREE.BufferAttribute(pos, 3));
        g.setIndex(new THREE.BufferAttribute(m.indices, 1));
        g.computeBoundingBox();
        return g;
      }),
    [meshes, k],
  );
  useEffect(() => () => geometries.forEach((g) => g.dispose()), [geometries]);

  const box = useMemo(() => {
    const b = new THREE.Box3();
    for (const g of geometries) if (g.boundingBox) b.union(g.boundingBox);
    return b;
  }, [geometries]);
  const empty = geometries.length === 0 || box.isEmpty();
  const heightMm = empty ? 0 : box.max.z - box.min.z;
  const offset: [number, number, number] = empty
    ? [0, 0, 0]
    : [bed.x / 2 - (box.min.x + box.max.x) / 2, bed.y / 2 - (box.min.y + box.max.y) / 2, -box.min.z];

  const colors = useMemo(() => {
    const byId = new Map(buckets.map((b) => [b.bucketId, b]));
    return meshes.map((m) => {
      const b = byId.get(m.bucketId);
      return b ? slotHex(b, slotColors) : "#cccccc";
    });
  }, [meshes, buckets, slotColors]);

  const clip = mode === "section" ? Math.min(sectionMm ?? heightMm, heightMm) : null;

  const controls = useRef<ElementRef<typeof OrbitControls>>(null);
  const wrap = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (controls.current && wrap.current) controls.current.listenToKeyEvents(wrap.current);
  }, [empty]);

  return (
    <section aria-label="3D preview" className="relative h-[60vh] min-h-[320px] bg-bg lg:h-full">
      <div ref={wrap} tabIndex={0} role="application" aria-label="3D view. Drag to orbit, scroll to zoom, arrow keys to pan." className="absolute inset-0">
        <Canvas
          key={options.printerMode}
          gl={{ localClippingEnabled: true, antialias: true }}
          camera={{ position: [bed.x / 2, reach * 0.6, -bed.y / 2 + reach * 0.9], fov: 40, near: 1, far: 5000 }}
        >
          <hemisphereLight args={["#ffffff", "#30343a", 1.1]} />
          <directionalLight position={[bed.x, bed.x * 1.5, bed.y]} intensity={1.6} />
          <directionalLight position={[-bed.x, bed.x, -bed.y]} intensity={0.5} />
          <group rotation={[-Math.PI / 2, 0, 0]}>
            <Plate bed={bed} />
            {!empty && <Model geometries={geometries} colors={colors} offset={offset} mode={mode} clipMm={clip} />}
          </group>
          <OrbitControls ref={controls} makeDefault target={[bed.x / 2, 25, -bed.y / 2]} maxPolarAngle={Math.PI * 0.495} />
        </Canvas>
      </div>

      <div role="radiogroup" aria-label="View mode" className="absolute left-3 top-3 flex overflow-hidden rounded border border-line bg-panel/90">
        {MODES.map((m) => (
          <button
            key={m.id}
            type="button"
            role="radio"
            aria-checked={mode === m.id}
            onClick={() => setViewMode(m.id)}
            className={`px-3 py-1.5 text-xs font-medium ${mode === m.id ? "bg-accent text-accent-ink" : "text-ink hover:bg-panel-2"}`}
          >
            {m.label}
          </button>
        ))}
      </div>

      {mode === "section" && !empty && (
        <label className="absolute bottom-3 left-3 right-3 flex items-center gap-3 rounded border border-line bg-panel/90 px-3 py-2 text-xs sm:right-auto sm:w-80">
          <span className="whitespace-nowrap text-muted">Cut height</span>
          <input
            type="range" min={0} max={heightMm} step={0.1} value={clip ?? heightMm}
            onChange={(e) => setSectionMm(Number(e.target.value))}
            className="min-w-0 flex-1"
          />
          <span className="w-16 text-right font-mono">{(clip ?? heightMm).toFixed(1)} mm</span>
        </label>
      )}

      <div className="pointer-events-none absolute inset-x-0 bottom-3 flex justify-center" aria-live="polite">
        {status === "running" && progress && (
          <div className="rounded border border-line bg-panel/95 px-3 py-1.5 text-xs">
            <span className="text-muted">Working: </span>
            <span className="font-mono">{progress.stage}</span>
          </div>
        )}
      </div>

      {!hasPayload && (
        <div className="pointer-events-none absolute inset-0 flex items-center justify-center p-6 text-center">
          <p className="max-w-sm text-muted">Load a build to preview it. Drop a <span className="font-mono">.vxm.json.gz</span> file on the left, or open a sample.</p>
        </div>
      )}
      {status === "error" && error && (
        <div role="alert" className="absolute left-1/2 top-14 w-[min(32rem,90%)] -translate-x-1/2 rounded border border-bad bg-panel p-3 text-sm text-bad">
          <strong className="font-semibold">Meshing failed.</strong> <span className="text-ink">{error}</span>
        </div>
      )}
    </section>
  );
}
