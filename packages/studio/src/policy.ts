// What an app that mounts the studio needs to write its Content Security Policy and to check
// it: the sources the studio needs, apart from its own script, and how to find the scripts of a
// document. Each app writes its own policy, because each names its scripts in its own way
// (apps/studio/csp.ts by hash, apps/web/csp.ts by nonce), and both take these from here, so the
// two cannot drift apart. Nothing here needs a DOM, Node or a bundler.
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

export interface ScriptElement {
  /** Everything between "<script" and the ">" of the start tag. */
  attrs: string;
  /** The text the browser hashes: everything between the start tag and the end tag. */
  body: string;
  /** Where the element starts and ends in the document. */
  start: number;
  end: number;
}

/**
 * The script elements of an HTML document, found the way a browser finds them. A start tag is
 * "<script" followed by whitespace, "/" or ">". The element runs to the next end tag, which is
 * "</script" followed by the same, and may carry whitespace or attributes before its ">". Case
 * does not matter. If this disagreed with the browser about where a script ends, the hash in
 * a policy would be of the wrong text and the script would not run.
 */
export function scriptElements(html: string): ScriptElement[] {
  const found: ScriptElement[] = [];
  const open = /<script(?=[\s/>])([^>]*)>/gi, close = /<\/script(?=[\s/>])[^>]*>/gi;
  for (let tag = open.exec(html); tag; tag = open.exec(html)) {
    const bodyStart = open.lastIndex;
    close.lastIndex = bodyStart;
    const end = close.exec(html);
    if (!end) throw new Error("a <script> is never closed");
    found.push({ attrs: tag[1]!, body: html.slice(bodyStart, end.index), start: tag.index, end: close.lastIndex });
    open.lastIndex = close.lastIndex;
  }
  return found;
}

const attribute = (s: ScriptElement, name: string): string | null => {
  const m = new RegExp(`(?:^|[\\s/"'])${name}(?:\\s*=\\s*(?:"([^"]*)"|'([^']*)'|([^\\s"'>]*)))?(?=[\\s/>]|$)`, "i").exec(s.attrs);
  return m ? m[1] ?? m[2] ?? m[3] ?? "" : null;
};

/** A script the browser fetches instead of reading inline. */
export const isExternal = (s: ScriptElement): boolean => attribute(s, "src") !== null;

/** A data block, such as application/json: the browser never runs it, so a policy need not name it. */
export const isDataBlock = (s: ScriptElement): boolean => /^application\/(?:ld\+)?json$/i.test((attribute(s, "type") || "").trim());
