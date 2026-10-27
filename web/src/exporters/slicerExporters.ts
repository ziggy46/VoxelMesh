// docs/04 §2-§3: multi-colour .3MF and binary .STL. Output is byte-deterministic (fixed zip timestamps, fixed decimals).
import JSZip from "jszip";
import type { ExportBucket } from "../types/color";
import type { ColorBucketMesh } from "../types/mesh";
import { validateMesh } from "../validate/manifold";

export type { ExportBucket } from "../types/color";

const HEX = /^#[0-9A-Fa-f]{6}$/;
const MATERIALS_ID = 100;
const STL_HEADER = "VoxelMesh Binary STL - Minecraft Build";

const esc = (s: string) =>
  s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&apos;");

/** Lattice units -> millimetres: 16 sub-voxels per block. Multiply first so whole blocks stay exact. */
const mm = (lattice: number, scaleMmPerBlock: number) => (lattice * scaleMmPerBlock) / 16;
const fmt = (v: number) => (v === 0 ? 0 : v).toFixed(4);

function usable(buckets: ExportBucket[]): ExportBucket[] {
  return buckets.filter((b) => b.mesh.indices.length > 0).sort((a, b) => a.bucketId - b.bucketId);
}

function meshXml(m: ColorBucketMesh, scale: number): string {
  const v: string[] = [];
  for (let i = 0; i < m.positions.length; i += 3) {
    v.push(`     <vertex x="${fmt(mm(m.positions[i]!, scale))}" y="${fmt(mm(m.positions[i + 1]!, scale))}" z="${fmt(mm(m.positions[i + 2]!, scale))}"/>`);
  }
  const t: string[] = [];
  for (let i = 0; i < m.indices.length; i += 3) {
    t.push(`     <triangle v1="${m.indices[i]}" v2="${m.indices[i + 1]}" v3="${m.indices[i + 2]}"/>`);
  }
  return `   <mesh>\n    <vertices>\n${v.join("\n")}\n    </vertices>\n    <triangles>\n${t.join("\n")}\n    </triangles>\n   </mesh>\n`;
}

export interface Export3MFOptions {
  /** Skip the manifold gate. Only for the UI's explicit "export anyway" confirmation. */
  skipValidation?: boolean;
}

export async function generateMultiColor3MF(
  buckets: ExportBucket[], buildName: string, scaleMmPerBlock: number, options: Export3MFOptions = {},
): Promise<Blob> {
  const parts = usable(buckets);
  if (parts.length === 0) throw new Error("nothing to export: every bucket mesh is empty");
  const ids = new Set<number>();
  for (const b of parts) {
    if (!Number.isInteger(b.bucketId) || b.bucketId < 1 || ids.has(b.bucketId)) throw new Error(`invalid or duplicate bucket id ${b.bucketId}`);
    if (!HEX.test(b.hexColor)) throw new Error(`bucket ${b.bucketId} has an invalid colour: ${b.hexColor}`);
    ids.add(b.bucketId);
    const r = options.skipValidation ? null : validateMesh(b.mesh);
    if (r && !r.ok) {
      throw new Error(
        `bucket ${b.bucketId} failed manifold validation (open edges ${r.openEdges}, non-manifold edges ${r.nonManifoldEdges}, ` +
        `degenerate triangles ${r.degenerateTriangles}, signed volume ${r.signedVolume})`,
      );
    }
  }
  const parentId = parts[parts.length - 1]!.bucketId + 1;

  const bases = parts.map((b) => `   <base name="${esc(b.name)}" displaycolor="${b.hexColor.toUpperCase()}FF"/>`).join("\n");
  const objects = parts
    .map((b, i) => `  <object id="${b.bucketId}" name="${esc(b.name)}" type="model" pid="${MATERIALS_ID}" pindex="${i}">\n${meshXml(b.mesh, scaleMmPerBlock)}  </object>`)
    .join("\n");
  const components = parts.map((b) => `    <component objectid="${b.bucketId}"/>`).join("\n");
  const model =
    `<?xml version="1.0" encoding="UTF-8"?>\n` +
    `<model unit="millimeter" xml:lang="en-US" xmlns="http://schemas.microsoft.com/3dmanufacturing/core/2015/02">\n` +
    ` <resources>\n  <basematerials id="${MATERIALS_ID}">\n${bases}\n  </basematerials>\n${objects}\n` +
    `  <object id="${parentId}" name="${esc(buildName)}" type="model">\n   <components>\n${components}\n   </components>\n  </object>\n` +
    ` </resources>\n <build>\n  <item objectid="${parentId}"/>\n </build>\n</model>\n`;

  const contentTypes =
    `<?xml version="1.0" encoding="UTF-8"?>\n` +
    `<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">\n` +
    ` <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>\n` +
    ` <Default Extension="model" ContentType="application/vnd.ms-package.3dmanufacturing-3dmodel+xml"/>\n` +
    ` <Default Extension="config" ContentType="text/xml"/>\n` +
    `</Types>\n`;
  const rels =
    `<?xml version="1.0" encoding="UTF-8"?>\n` +
    `<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">\n` +
    ` <Relationship Target="/3D/3dmodel.model" Id="rel0" Type="http://schemas.microsoft.com/3dmanufacturing/2013/01/3dmodel"/>\n` +
    `</Relationships>\n`;
  // Bambu/Orca hint: part id = component object id, extruder = filament slot.
  const partsXml = parts
    .map((b) =>
      `    <part id="${b.bucketId}" subtype="normal_part">\n` +
      `      <metadata key="name" value="${esc(b.name)}"/>\n` +
      `      <metadata key="extruder" value="${b.bucketId}"/>\n` +
      `    </part>`)
    .join("\n");
  const settings =
    `<?xml version="1.0" encoding="UTF-8"?>\n<config>\n` +
    `  <object id="${parentId}">\n    <metadata key="name" value="${esc(buildName)}"/>\n${partsXml}\n  </object>\n</config>\n`;

  const zip = new JSZip();
  const opts = { date: new Date(0), createFolders: false, compression: "DEFLATE" as const, compressionOptions: { level: 6 } };
  zip.file("[Content_Types].xml", contentTypes, opts);
  zip.file("_rels/.rels", rels, opts);
  zip.file("3D/3dmodel.model", model, opts);
  zip.file("Metadata/model_settings.config", settings, opts);
  const bytes = await zip.generateAsync({ type: "uint8array", compression: "DEFLATE", compressionOptions: { level: 6 } });
  return new Blob([bytes as BlobPart], { type: "model/3mf" });
}

export function generateBinarySTL(buckets: ExportBucket[], scaleMmPerBlock: number): ArrayBuffer {
  const meshes = buckets.map((b) => b.mesh);
  const triangles = meshes.reduce((s, m) => s + m.indices.length / 3, 0);
  const buf = new ArrayBuffer(84 + 50 * triangles);
  const u8 = new Uint8Array(buf);
  const dv = new DataView(buf);
  for (let i = 0; i < STL_HEADER.length; i++) u8[i] = STL_HEADER.charCodeAt(i);
  dv.setUint32(80, triangles, true);

  let o = 84;
  for (const m of meshes) {
    const P = m.positions, I = m.indices;
    for (let t = 0; t < I.length; t += 3) {
      const a = I[t]! * 3, b = I[t + 1]! * 3, c = I[t + 2]! * 3;
      const ux = P[b]! - P[a]!, uy = P[b + 1]! - P[a + 1]!, uz = P[b + 2]! - P[a + 2]!;
      const vx = P[c]! - P[a]!, vy = P[c + 1]! - P[a + 1]!, vz = P[c + 2]! - P[a + 2]!;
      const nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
      const len = Math.hypot(nx, ny, nz);
      if (len === 0) throw new Error(`degenerate triangle ${t / 3} in bucket ${m.bucketId}`);
      dv.setFloat32(o, nx / len, true);
      dv.setFloat32(o + 4, ny / len, true);
      dv.setFloat32(o + 8, nz / len, true);
      let p = o + 12;
      for (const v of [a, b, c]) {
        for (let k = 0; k < 3; k++) {
          dv.setFloat32(p, mm(P[v + k]!, scaleMmPerBlock), true);
          p += 4;
        }
      }
      dv.setUint16(o + 48, 0, true);
      o += 50;
    }
  }
  return buf;
}
