// Last line of defence for documents that arrive from outside the sanitiser
// (imported JSON, hand-edited files). The real sanitiser runs at upload time in
// the studio (apps/studio/src/ingest/svg.ts); these checks run in the pure
// renderer and the validator, where no DOM parser exists.

// Everything in this file has to run in linear time: the input is untrusted, and a pattern
// that can split a run of characters in more than one way goes quadratic on a long run.

/**
 * The elements a drawing fragment may contain. The studio's upload sanitiser allows the same
 * set (plus the <svg> root, which it unwraps), so anything it writes passes here.
 */
export const FRAGMENT_ELEMENTS = ["g", "path", "rect", "circle", "ellipse", "line", "polyline", "polygon", "defs",
  "clipPath", "mask", "linearGradient", "radialGradient", "stop", "text", "tspan", "use"] as const;

/**
 * The attributes those elements may carry, besides id, class and href (a reference into the
 * same document). The sanitiser copies these and no others, so there is no style attribute
 * and no event handler to look for: a name that is not here is refused.
 */
export const FRAGMENT_ATTRIBUTES = ["transform", "d", "x", "y", "x1", "y1", "x2", "y2", "cx", "cy", "r", "rx", "ry", "fx", "fy", "fr",
  "width", "height", "points", "pathLength", "offset", "dx", "dy", "rotate", "textLength", "lengthAdjust",
  "gradientUnits", "gradientTransform", "spreadMethod", "clipPathUnits", "maskUnits", "maskContentUnits",
  "fill", "fill-opacity", "fill-rule", "stroke", "stroke-width", "stroke-linecap", "stroke-linejoin", "stroke-miterlimit",
  "stroke-dasharray", "stroke-dashoffset", "stroke-opacity", "opacity", "clip-path", "clip-rule", "mask",
  "stop-color", "stop-opacity", "font-size", "font-family", "font-weight", "font-style", "text-anchor",
  "dominant-baseline", "letter-spacing", "display", "visibility", "paint-order", "vector-effect", "preserveAspectRatio"] as const;

// An HTML parser lowercases the ASCII letters of a tag or attribute name before it matches it.
const lower = (s: string): string => s.replace(/[A-Z]/g, (c) => String.fromCharCode(c.charCodeAt(0) + 32));
const ELEMENT_NAMES = new Set<string>(FRAGMENT_ELEMENTS.map(lower));
const ATTRIBUTE_NAMES = new Set<string>(["id", "class", "href", ...FRAGMENT_ATTRIBUTES].map(lower));

// A value may use the five character references the sanitiser writes and no others. Any other
// reference lets a value spell what the checks below look for without matching them:
// "&#117;rl(" and "url&lpar;" are both "url(" once the parser has decoded them.
const OTHER_REFERENCE = /&(?!(?:amp|lt|gt|quot|#39);)/;
const LOCAL_REFERENCE = /^#[^\s"'()<>]+$/;
const NONE_OR_LOCAL_URL = /^(?:none|url\(\s*#[^\s"')]+\s*\))$/;
const BAD_VALUE: RegExp[] = [
  /url\((?!\s*["']?#)/i, // a url() that points outside the document
  /javascript\s*:/i,
  /data\s*:\s*text\/html/i,
  /@import/i,
];

function attributeIsUnsafe(name: string, value: string): boolean {
  if (!ATTRIBUTE_NAMES.has(name)) return true;
  // A backslash starts a CSS escape, and presentation attributes are read as CSS: "\75 rl(" is
  // "url(". A "<" is refused so that every "<" in a fragment starts a tag.
  if (value.includes("\\") || value.includes("<") || OTHER_REFERENCE.test(value)) return true;
  if (name === "href") return !LOCAL_REFERENCE.test(value);
  // mask is the one attribute here that takes an image, and image-set() and its relatives
  // fetch one without a url(), so it has to be exactly a reference to a <mask>
  if (name === "mask") return !NONE_OR_LOCAL_URL.test(value.trim());
  return BAD_VALUE.some((re) => re.test(value));
}

const isSpace = (c: string | undefined): boolean => c === " " || c === "\n" || c === "\t" || c === "\r" || c === "\f";

/**
 * Returns the reason a sanitised SVG fragment looks unsafe, or "" when it passes.
 *
 * The fragment is read the way an HTML parser's tokenizer reads it, one character at a time,
 * so the check and the browser agree on what is a tag, an attribute name and a value. Patterns
 * run over the whole text cannot tell a value from the text around it: they refused ordinary
 * words in a <text>, and a parser sees attributes where a pattern sees none.
 *
 * Elements and attributes are allow-listed: a block list misses whatever nobody thought to add.
 * Text between tags is inert in every element allowed here, so it is not inspected.
 */
export function fragmentProblem(src: unknown): string {
  if (typeof src !== "string") return "fragment is not a string";
  const n = src.length;
  const at = (i: number) => `contains "${src.slice(i, i + 24).trim()}"`;

  for (let open = src.indexOf("<"); open >= 0;) {
    // A tag is "<" or "</" and then a letter. Anything else after "<" is a comment, CDATA, a
    // declaration, or text that should have been written "&lt;".
    let i = open + (src[open + 1] === "/" ? 2 : 1);
    const nameAt = i;
    while (i < n && !isSpace(src[i]) && src[i] !== "/" && src[i] !== ">") i++;
    const element = src.slice(nameAt, i);
    if (!/^[A-Za-z]/.test(element) || !ELEMENT_NAMES.has(lower(element))) return at(open);

    for (;;) {
      while (i < n && (isSpace(src[i]) || src[i] === "/")) i++;
      if (i >= n) return `ends inside a tag: "${src.slice(open, open + 24).trim()}"`;
      if (src[i] === ">") { i++; break; }

      // An attribute name runs to whitespace, "/", ">" or "="; a "=" in first place belongs to it.
      const attrAt = i;
      if (src[i] === "=") i++;
      while (i < n && !isSpace(src[i]) && src[i] !== "/" && src[i] !== ">" && src[i] !== "=") i++;
      const name = lower(src.slice(attrAt, i));

      let value = "", v = i;
      while (isSpace(src[v])) v++;
      if (src[v] === "=") {
        v++;
        while (isSpace(src[v])) v++;
        const quote = src[v];
        if (quote === '"' || quote === "'") {
          const close = src.indexOf(quote, v + 1);
          if (close < 0) return `ends inside a tag: "${src.slice(open, open + 24).trim()}"`;
          value = src.slice(v + 1, close);
          i = close + 1;
        } else {
          // unquoted: to the next whitespace or ">", whatever else it holds
          const from = v;
          while (v < n && !isSpace(src[v]) && src[v] !== ">") v++;
          value = src.slice(from, v);
          i = v;
        }
      }
      if (attributeIsUnsafe(name, value)) return at(attrAt);
    }
    open = src.indexOf("<", i);
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
