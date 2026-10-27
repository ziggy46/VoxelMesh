// First-load sources: the localhost relay (?build=<id>) and the URL-fragment transport (#data=<base64url gzip>).
import { usePrintStore } from "../store/usePrintStore";
import { decodeFragmentData } from "./derive";

const BUILD_ID = /^[0-9a-f]{32}$/;

export async function bootstrap(): Promise<void> {
  const { loadBytes } = usePrintStore.getState();
  const id = new URLSearchParams(window.location.search).get("build");
  if (id !== null) {
    if (!BUILD_ID.test(id)) {
      usePrintStore.setState({ loadError: "The build link is malformed." });
      return;
    }
    try {
      const res = await fetch(`/api/builds/${id}`, { cache: "no-store" });
      if (!res.ok) throw new Error(res.status === 404 ? "That build has expired or was never sent. Re-run /vm export in Minecraft." : `The relay answered ${res.status}.`);
      await loadBytes("Minecraft export", new Uint8Array(await res.arrayBuffer()));
    } catch (e) {
      usePrintStore.setState({ loadError: e instanceof Error ? e.message : String(e) });
    }
    return;
  }
  const frag = decodeFragmentData(window.location.hash);
  if (frag) await loadBytes("Shared build", frag);
}
