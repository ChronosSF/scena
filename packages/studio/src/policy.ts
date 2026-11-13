// What the studio needs from the Content Security Policy of the page it runs in, apart from
// its own script. Each app that mounts the studio writes its own policy, because each names
// its scripts in its own way (apps/studio/csp.ts by hash, apps/web/csp.ts by nonce), and both
// take these sources from here, so the two cannot drift apart.
//
// The policy is the layer behind the sanitisers: the studio writes markup that comes from
// documents into its own DOM (the stage, the thumbnails), and nothing in that markup may run.
// Nothing here loosens that: no script source is listed, and nothing is evaluated.
export const STUDIO_SOURCES = {
  /** React and the renderer write style attributes and <style> elements; the typefaces are a stylesheet from Google Fonts. */
  "style-src": ["'unsafe-inline'", "https://fonts.googleapis.com"],
  "font-src": ["https://fonts.gstatic.com"],
  /** Drawings are data: URLs in the documents and blob: URLs on the stage. */
  "img-src": ["data:", "blob:"],
  /** Rasters are read back from their data: URLs to be trimmed and re-encoded. */
  "connect-src": ["data:"],
} as const;

/** The directives above, in the order they are written. */
export const STUDIO_DIRECTIVES = Object.keys(STUDIO_SOURCES) as (keyof typeof STUDIO_SOURCES)[];
