// Last line of defence for documents that arrive from outside the sanitiser
// (imported JSON, hand-edited files). The real sanitiser runs at upload time in
// the studio (apps/studio/src/ingest/svg.ts); these checks run in the pure
// renderer and the validator, where no DOM parser exists.

// Every pattern in this file has to run in linear time: the input is untrusted, and a pattern
// that can split a run of characters in more than one way goes quadratic on a long run.
const BAD_FRAGMENT: RegExp[] = [
  /<[\s/]*(script|foreignobject|iframe|object|embed|image|img|a|style|link|meta|svg|html|body|animate\w*|set|audio|video|canvas|handler|listener)\b/i,
  /\son[a-z]+\s*=/i,
  /javascript\s*:/i,
  /data\s*:\s*text\/html/i,
  /url\(\s*(?:"(?!#)|'(?!#)|(?!["'#]))/i,
  /@import/i,
  /href\s*=\s*(?:"(?!#)|'(?!#)|(?!["'#]))/i,
  /<!\[CDATA\[|<!--|<\?|<!DOCTYPE|<!ENTITY/i,
];

/** Returns the reason a sanitised SVG fragment looks unsafe, or "" when it passes. */
export function fragmentProblem(src: unknown): string {
  if (typeof src !== "string") return "fragment is not a string";
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

/** Ids end up in attributes and url(#...) references. */
export function safeId(id: unknown): string {
  return String(id).replace(/[^A-Za-z0-9_-]/g, "_");
}
