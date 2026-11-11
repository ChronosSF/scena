// Last line of defence for documents that arrive from outside the sanitiser
// (imported JSON, hand-edited files). The real sanitiser runs at upload time in
// the studio (apps/studio/src/ingest/svg.ts); these checks run in the pure
// renderer and the validator, where no DOM parser exists.

// Every pattern in this file has to run in linear time: the input is untrusted, and a pattern
// that can split a run of characters in more than one way goes quadratic on a long run.

/**
 * The elements a drawing fragment may contain. The studio's upload sanitiser allows the same
 * set (plus the <svg> root, which it unwraps), so anything it writes passes here.
 */
export const FRAGMENT_ELEMENTS = ["g", "path", "rect", "circle", "ellipse", "line", "polyline", "polygon", "defs",
  "clipPath", "mask", "linearGradient", "radialGradient", "stop", "text", "tspan", "use"] as const;
// An HTML parser lowercases a tag name before it matches it, so the comparison ignores case.
const ELEMENT_NAMES = new Set<string>(FRAGMENT_ELEMENTS.map((n) => n.toLowerCase()));
// Every "<" in a fragment, with the element name after it when there is one.
const TAG = /<[\s/]*([A-Za-z][A-Za-z0-9:_.-]*)?/g;

const BAD_FRAGMENT: RegExp[] = [
  /[\s/"']on[a-z]+\s*=/i, // an event handler, after any character that can end the token before it
  /javascript\s*:/i,
  /data\s*:\s*text\/html/i,
  /url\(\s*(?:"(?!#)|'(?!#)|(?!["'#]))/i,
  /@import/i,
  /href\s*=\s*(?:"(?!#)|'(?!#)|(?!["'#]))/i,
];

/** Returns the reason a sanitised SVG fragment looks unsafe, or "" when it passes. */
export function fragmentProblem(src: unknown): string {
  if (typeof src !== "string") return "fragment is not a string";
  // Elements are allow-listed: a block list misses every element nobody thought to add. A "<"
  // with no name after it (a comment, CDATA, a declaration, or a stray "<") is refused as well.
  for (const m of src.matchAll(TAG)) {
    if (!m[1] || !ELEMENT_NAMES.has(m[1].toLowerCase())) return `contains "${src.slice(m.index, m.index + 24).trim()}"`;
  }
  for (const re of BAD_FRAGMENT) {
    const m = re.exec(src);
    if (m) return `contains "${m[0].trim().slice(0, 24)}"`;
  }
  return "";
}

const RASTER_URL = /^data:image\/(png|webp);base64,[A-Za-z0-9+/=\s]+$/;
export function isSafeRasterUrl(url: unknown): url is string {
  return typeof url === "string" && RASTER_URL.test(url);
}

/** Link URLs: https and mailto only; http is upgraded; bare domains become https; anything else becomes "". */
export function safeHref(url: unknown): string {
  if (typeof url !== "string") return "";
  const u = url.trim();
  if (!u) return "";
  if (/^mailto:[^\s<>"@]+@[^\s<>"]+$/i.test(u)) return u; // the first @ is the only place to split
  if (/^https:\/\/[^\s<>"]+$/i.test(u)) return u;
  if (/^http:\/\/[^\s<>"]+$/i.test(u)) return "https://" + u.slice(7);
  if (/^[a-z0-9-]+(\.[a-z0-9-]+)+(\/[^\s<>"]*)?$/i.test(u)) return "https://" + u;
  return "";
}

// Ids end up in attributes, CSS selectors and url(#...) references, and the studio builds other
// ids from them, so a document may only use characters that mean nothing in any of those.
const ID = /^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$/;
/** What the validator requires of every id in a scene or page. */
export function isSafeId(id: unknown): id is string {
  return typeof id === "string" && ID.test(id);
}

/** For a string that was never validated (a render option, a caller's own prefix): every other character becomes "_". */
export function safeId(id: unknown): string {
  return String(id).replace(/[^A-Za-z0-9_-]/g, "_");
}
