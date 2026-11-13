import { MORE_FACES_HREF } from "./fonts.ts";

/**
 * Brings in the faces that only the Typeface cards preview, without holding up first paint.
 * A document may already carry the link as <link id="more-faces" media="print">, which loads
 * without blocking; it is switched to the screen once it has loaded. (An inline onload would
 * do the same, and a Content Security Policy that names scripts would block it.) Where the
 * document has no such link, one is added.
 */
export function showMoreFaces(): void {
  const there = document.getElementById("more-faces") as HTMLLinkElement | null;
  if (!there) {
    const link = document.createElement("link");
    link.id = "more-faces";
    link.rel = "stylesheet";
    link.href = MORE_FACES_HREF;
    document.head.append(link);
    return;
  }
  const apply = () => { there.media = "all"; };
  if (there.sheet) apply(); else there.addEventListener("load", apply, { once: true });
}
