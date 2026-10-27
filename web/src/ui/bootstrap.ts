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
      const res = await fetch(`${import.meta.env.BASE_URL}api/builds/${id}`, { cache: "no-store" });
      const noRelay = "That build is not on this server. It may have expired, or the hosted site has no relay: run the app locally, or drop the saved .vxm.json.gz file here.";
      // A static host answers unknown paths with its HTML page, not 404, so check the content type too.
      if (res.ok && (res.headers.get("content-type") ?? "").includes("text/html")) throw new Error(noRelay);
      if (!res.ok) throw new Error(res.status === 404 ? noRelay : `The relay answered ${res.status}.`);
      await loadBytes("Minecraft export", new Uint8Array(await res.arrayBuffer()));
    } catch (e) {
      usePrintStore.setState({ loadError: e instanceof Error ? e.message : String(e) });
    }
    return;
  }
  const frag = decodeFragmentData(window.location.hash);
  if (frag) await loadBytes("Shared build", frag);
}
