// The Content Security Policy of the built studio: the parts that read and write the HTML,
// kept free of Node and Vite so they can be tested (test/csp.test.ts). vite.config.ts runs
// them on dist/index.html once the app's script has been inlined. The web app serves the same
// studio under a policy of its own (apps/web/csp.ts); what the studio needs from either is in
// @scena/studio/policy.
import { STUDIO_DIRECTIVES, STUDIO_SOURCES } from "@scena/studio/policy";

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
 * the policy would be of the wrong text and the script would not run.
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

/** A script the browser fetches instead of reading inline. The policy names scripts by hash, so there must be none. */
export const isExternal = (s: ScriptElement): boolean => attribute(s, "src") !== null;

/** A data block, such as application/json: the browser never runs it, so it needs no hash. */
export const isDataBlock = (s: ScriptElement): boolean => /^application\/(?:ld\+)?json$/i.test((attribute(s, "type") || "").trim());

/**
 * The first inline event handler in the markup outside the scripts, or "" when there is none.
 * The policy blocks every one of them, so finding one at build time beats finding it broken.
 */
export function inlineHandler(html: string, scripts: ScriptElement[]): string {
  let outside = "", from = 0;
  for (const s of scripts) { outside += html.slice(from, s.start); from = s.end; }
  outside += html.slice(from);
  // tag by tag, so each pattern reads its input once: a handler is an attribute, and an
  // attribute name starts after whitespace, a slash or the quote that closed the one before
  for (const tag of outside.matchAll(/<[^<>]*>/g)) {
    if (/[\s/"']on[a-z]+\s*=/i.test(tag[0])) return tag[0].slice(0, 100);
  }
  return "";
}

/**
 * The policy, given the base64 SHA-256 of every script that may run. Only those run: no inline
 * handlers, no javascript: URLs, no eval. Nothing loads from anywhere but the places listed.
 */
export function policyFor(scriptHashes: string[]): string {
  if (!scriptHashes.length) throw new Error("no script to allow");
  return [
    "default-src 'none'",
    `script-src ${scriptHashes.map((h) => `'sha256-${h}'`).join(" ")}`,
    // styles, typefaces, images and data: reads, as the studio needs them and no wider
    ...STUDIO_DIRECTIVES.map((d) => `${d} ${STUDIO_SOURCES[d].join(" ")}`),
    "base-uri 'none'",
    "form-action 'none'",
  ].join("; ");
}

/** The document with the policy right after its charset, which has to be ahead of every script. */
export function withPolicy(html: string, policy: string): string {
  const anchor = '<meta charset="utf-8">';
  const at = html.indexOf(anchor);
  if (at < 0) throw new Error(`no ${anchor} to put the policy after`);
  const first = scriptElements(html)[0];
  if (first && first.start < at) throw new Error("a script comes before the charset, so the policy would not cover it");
  if (policy.includes('"')) throw new Error("the policy must not contain a double quote");
  const end = at + anchor.length;
  return `${html.slice(0, end)}\n<meta http-equiv="Content-Security-Policy" content="${policy}">${html.slice(end)}`;
}
