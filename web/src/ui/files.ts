import { usePrintStore } from "../store/usePrintStore";

/** Load a dropped or chosen build file (.vxm.json or .vxm.json.gz). */
export async function loadFile(f: File | undefined): Promise<void> {
  if (!f) return;
  await usePrintStore.getState().loadBytes(f.name.replace(/\.vxm(\.json)?(\.gz)?$/i, ""), new Uint8Array(await f.arrayBuffer()));
}
