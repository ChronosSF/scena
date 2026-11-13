// The stylesheets for the studio's typefaces. They come from Google Fonts until the faces are
// self-hosted (issue 23). An app that mounts the studio links the first one in its document and
// calls showMoreFaces() once the studio is on screen.

/** The studio's own face, and the default face of a page. Linked by the document, ahead of first paint. */
export const FIRST_FACES_HREF = "https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600&family=Shantell+Sans:wght@400;600;800&display=swap";

/** The other curated faces. Only the Typeface cards preview them, so they must not hold up first paint. */
export const MORE_FACES_HREF = "https://fonts.googleapis.com/css2?family=Caveat:wght@400;600;700&family=Patrick+Hand&family=Kalam:wght@400;700&family=Fredoka:wght@400;600;700&family=Instrument+Serif&display=swap";

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
